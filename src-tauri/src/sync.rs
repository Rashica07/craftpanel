//! Cloud sync for shared servers: the world + config live in an R2 bucket under
//! a per-server `<code>/` prefix; an advisory lease object stops two devices
//! running it at once. CraftPanel does all the transfer — no synced folder.
//!
//! Object layout:
//!   <code>/manifest.json  { name, loader, mcVersion, worldHash, updatedBy, updatedAt }
//!   <code>/lease.json      { holder, hostname, claimedAt, expiresAt }
//!   <code>/world.zip       zip of the server folder (volatile dirs excluded)

use std::collections::BTreeMap;
use std::io::{Cursor, Read, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::adapter::ServerType;

/// Lease is refreshed every ~60 s while running; 5 min gives lots of slack for a
/// slow upload or a transient R2 error before another device could take over.
pub const LEASE_TTL_SECS: i64 = 300;

/// Anything that can hold the sync objects. `R2` in production, an in-memory map
/// in tests.
pub trait Blob {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>, String>;
    fn put(&self, key: &str, data: &[u8]) -> Result<(), String>;
    fn delete(&self, key: &str) -> Result<(), String>;
}

impl Blob for crate::r2::R2 {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>, String> {
        Ok(crate::r2::R2::get(self, key)?.map(|o| o.bytes))
    }
    fn put(&self, key: &str, data: &[u8]) -> Result<(), String> {
        crate::r2::R2::put(self, key, data, "application/octet-stream")
    }
    fn delete(&self, key: &str) -> Result<(), String> {
        crate::r2::R2::delete(self, key)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub name: String,
    pub loader: ServerType,
    pub mc_version: Option<String>,
    pub launch_target: String,
    pub world_hash: String,
    pub updated_by: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lease {
    pub holder: String,
    pub hostname: String,
    pub claimed_at: i64,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStatus {
    pub exists: bool,
    pub locked: bool,
    pub held_by_us: bool,
    pub holder_name: Option<String>,
    pub expires_in: Option<i64>,
    /// local world differs from the cloud copy
    pub local_ahead: bool,
    /// cloud copy is newer than what we have
    pub cloud_ahead: bool,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn k(code: &str, name: &str) -> String {
    format!("{code}/{name}")
}

// --- world hashing --------------------------------------------------------

/// Fast change-detector: path + size + mtime of everything we'd sync. Not a
/// content hash — good enough to answer "did the world change?".
pub fn world_hash(dir: &Path) -> String {
    let mut entries: BTreeMap<String, (u64, i64)> = BTreeMap::new();
    for e in walkdir::WalkDir::new(dir).into_iter().flatten() {
        if !e.file_type().is_file() {
            continue;
        }
        let rel = match e.path().strip_prefix(dir) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };
        if is_excluded(&rel) {
            continue;
        }
        if let Ok(m) = e.metadata() {
            let mtime = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            entries.insert(rel, (m.len(), mtime));
        }
    }
    let mut h = Sha256::new();
    for (path, (len, mtime)) in &entries {
        h.update(path.as_bytes());
        h.update(len.to_le_bytes());
        h.update(mtime.to_le_bytes());
    }
    hex(&h.finalize())
}

fn is_excluded(rel: &str) -> bool {
    let l = rel.to_ascii_lowercase();
    l.starts_with("logs/")
        || l.starts_with("crash-reports/")
        || l.starts_with(".craftpanel-trash/")
        || l.starts_with(".craftpanel-pre-restore-")
        || l == ".craftpanel-session.json"
        || l.ends_with(".lock")
        || l.starts_with("craftpanel-")
        || l == "eula.txt".to_string() // re-written locally on every start
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

// --- zip / unzip --------------------------------------------------------

pub fn zip_dir(dir: &Path) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    {
        let mut zip = zip::ZipWriter::new(Cursor::new(&mut buf));
        let opts: zip::write::FileOptions<'_, ()> =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for e in walkdir::WalkDir::new(dir).into_iter().flatten() {
            let rel = match e.path().strip_prefix(dir) {
                Ok(r) => r.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };
            if rel.is_empty() || is_excluded(&rel) {
                continue;
            }
            if e.file_type().is_dir() {
                zip.add_directory(&rel, opts).map_err(|e| e.to_string())?;
            } else if e.file_type().is_file() {
                zip.start_file(&rel, opts).map_err(|e| e.to_string())?;
                let mut f = std::fs::File::open(e.path()).map_err(|e| e.to_string())?;
                let mut b = Vec::new();
                f.read_to_end(&mut b).map_err(|e| e.to_string())?;
                zip.write_all(&b).map_err(|e| e.to_string())?;
            }
        }
        zip.finish().map_err(|e| e.to_string())?;
    }
    Ok(buf)
}

/// Extract into `dir`. Existing world folders are moved aside first so a bad
/// pull never eats local data.
pub fn unzip_into(data: &[u8], dir: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(data)).map_err(|e| e.to_string())?;

    // move current world(s) aside
    if let Ok(rd) = std::fs::read_dir(dir) {
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if entry.path().is_dir()
                && (name == "world" || name.starts_with("world_") || name.starts_with("DIM"))
            {
                let aside = dir.join(format!("{name}.conflict-{}", now()));
                let _ = std::fs::rename(entry.path(), aside);
            }
        }
    }

    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = f.enclosed_name() else { continue };
        let out = dir.join(&rel);
        if f.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(p) = out.parent() {
            std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        let mut w = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut f, &mut w).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// --- the sync operations ------------------------------------------------

pub struct Sync<'a> {
    pub blob: &'a dyn Blob,
    pub code: String,
    pub device_id: String,
    pub hostname: String,
}

impl<'a> Sync<'a> {
    pub fn manifest(&self) -> Result<Option<Manifest>, String> {
        match self.blob.get(&k(&self.code, "manifest.json"))? {
            Some(b) => serde_json::from_slice(&b).map(Some).map_err(|e| e.to_string()),
            None => Ok(None),
        }
    }

    fn lease(&self) -> Result<Option<Lease>, String> {
        match self.blob.get(&k(&self.code, "lease.json"))? {
            Some(b) => serde_json::from_slice(&b).map(Some).map_err(|e| e.to_string()),
            None => Ok(None),
        }
    }

    /// First upload: zip the folder, write world.zip + manifest.
    pub fn create(&self, dir: &Path, name: &str, loader: ServerType, mc_version: Option<String>, launch_target: &str) -> Result<(), String> {
        if self.manifest()?.is_some() {
            return Err("A server already exists under this code.".into());
        }
        let zipped = zip_dir(dir)?;
        self.blob.put(&k(&self.code, "world.zip"), &zipped)?;
        let m = Manifest {
            name: name.to_string(),
            loader,
            mc_version,
            launch_target: launch_target.to_string(),
            world_hash: world_hash(dir),
            updated_by: self.hostname.clone(),
            updated_at: now(),
        };
        self.put_manifest(&m)
    }

    fn put_manifest(&self, m: &Manifest) -> Result<(), String> {
        let b = serde_json::to_vec(m).map_err(|e| e.to_string())?;
        self.blob.put(&k(&self.code, "manifest.json"), &b)
    }

    /// Download world.zip into an (empty) local folder.
    pub fn pull(&self, dir: &Path) -> Result<Manifest, String> {
        let m = self
            .manifest()?
            .ok_or("No shared server found for that code.")?;
        let data = self
            .blob
            .get(&k(&self.code, "world.zip"))?
            .ok_or("The shared server's world is missing from storage.")?;
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        unzip_into(&data, dir)?;
        Ok(m)
    }

    /// Take the lease. Weak CAS: put, then read back and confirm it's ours.
    pub fn claim(&self, force: bool) -> Result<(), String> {
        if let Some(existing) = self.lease()? {
            let live = existing.expires_at > now();
            if existing.holder != self.device_id && live && !force {
                let mins = ((existing.expires_at - now()) / 60).max(0);
                return Err(format!(
                    "In use on \"{}\" — lease has ~{mins} min left. Start anyway only if that device is off.",
                    existing.hostname
                ));
            }
        }
        let lease = Lease {
            holder: self.device_id.clone(),
            hostname: self.hostname.clone(),
            claimed_at: now(),
            expires_at: now() + LEASE_TTL_SECS,
        };
        let b = serde_json::to_vec(&lease).map_err(|e| e.to_string())?;
        self.blob.put(&k(&self.code, "lease.json"), &b)?;
        // read-back: if someone raced us, back off
        std::thread::sleep(std::time::Duration::from_millis(400));
        match self.lease()? {
            Some(l) if l.holder == self.device_id => Ok(()),
            Some(l) => Err(format!("Lost a race for the lease to \"{}\".", l.hostname)),
            None => Ok(()),
        }
    }

    pub fn heartbeat(&self) {
        if let Ok(Some(mut l)) = self.lease() {
            if l.holder == self.device_id {
                l.expires_at = now() + LEASE_TTL_SECS;
                if let Ok(b) = serde_json::to_vec(&l) {
                    let _ = self.blob.put(&k(&self.code, "lease.json"), &b);
                }
            }
        }
    }

    pub fn release(&self) {
        if let Ok(Some(l)) = self.lease() {
            if l.holder == self.device_id {
                let _ = self.blob.delete(&k(&self.code, "lease.json"));
            }
        }
    }

    /// If the local world moved past the cloud copy, upload it + bump manifest.
    /// Only does anything if **we hold the lease** — otherwise we might be the
    /// stale device and would clobber a newer world.
    pub fn push_if_changed(&self, dir: &Path) -> Result<bool, String> {
        let we_hold = self
            .lease()?
            .map(|l| l.holder == self.device_id && l.expires_at > now())
            .unwrap_or(false);
        if !we_hold {
            return Ok(false);
        }
        let Some(mut m) = self.manifest()? else {
            return Ok(false);
        };
        let local = world_hash(dir);
        if local == m.world_hash {
            return Ok(false);
        }
        let zipped = zip_dir(dir)?;
        self.blob.put(&k(&self.code, "world.zip"), &zipped)?;
        m.world_hash = local;
        m.updated_by = self.hostname.clone();
        m.updated_at = now();
        self.put_manifest(&m)?;
        Ok(true)
    }

    /// If the cloud copy is newer than local, pull it.
    pub fn pull_if_stale(&self, dir: &Path) -> Result<bool, String> {
        let Some(m) = self.manifest()? else {
            return Ok(false);
        };
        if world_hash(dir) == m.world_hash {
            return Ok(false);
        }
        let data = self
            .blob
            .get(&k(&self.code, "world.zip"))?
            .ok_or("world.zip missing from storage")?;
        unzip_into(&data, dir)?;
        Ok(true)
    }

    pub fn status(&self, dir: &Path) -> Result<CloudStatus, String> {
        let manifest = self.manifest()?;
        let lease = self.lease().ok().flatten();
        let local = world_hash(dir);
        let (local_ahead, cloud_ahead) = match &manifest {
            Some(m) if m.world_hash != local => {
                // we can't tell direction perfectly without timestamps of the
                // local change; treat "differs" as cloud_ahead unless we hold
                // the lease (then we're the ones who changed it).
                let we_hold = lease
                    .as_ref()
                    .map(|l| l.holder == self.device_id)
                    .unwrap_or(false);
                (we_hold, !we_hold)
            }
            _ => (false, false),
        };
        Ok(CloudStatus {
            exists: manifest.is_some(),
            locked: lease.as_ref().map(|l| l.expires_at > now()).unwrap_or(false),
            held_by_us: lease.as_ref().map(|l| l.holder == self.device_id).unwrap_or(false),
            holder_name: lease.as_ref().map(|l| l.hostname.clone()),
            expires_in: lease.as_ref().map(|l| l.expires_at - now()),
            local_ahead,
            cloud_ahead,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemBlob(Mutex<HashMap<String, Vec<u8>>>);
    impl Blob for MemBlob {
        fn get(&self, key: &str) -> Result<Option<Vec<u8>>, String> {
            Ok(self.0.lock().unwrap().get(key).cloned())
        }
        fn put(&self, key: &str, data: &[u8]) -> Result<(), String> {
            self.0.lock().unwrap().insert(key.into(), data.to_vec());
            Ok(())
        }
        fn delete(&self, key: &str) -> Result<(), String> {
            self.0.lock().unwrap().remove(key);
            Ok(())
        }
    }

    fn server(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("cp-sync-{tag}-{:?}", std::thread::current().id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("world")).unwrap();
        std::fs::write(d.join("server.properties"), "level-name=world\n").unwrap();
        std::fs::write(d.join("world/level.dat"), b"hello").unwrap();
        std::fs::write(d.join("logs/latest.log"), b"noise").unwrap_or_else(|_| {
            std::fs::create_dir_all(d.join("logs")).unwrap();
            std::fs::write(d.join("logs/latest.log"), b"noise").unwrap();
        });
        d
    }

    fn sync<'a>(blob: &'a MemBlob, dev: &str) -> Sync<'a> {
        Sync { blob, code: "TESTCODE".into(), device_id: dev.into(), hostname: format!("host-{dev}") }
    }

    #[test]
    fn zip_roundtrip_excludes_logs() {
        let d = server("zip");
        let z = zip_dir(&d).unwrap();
        let out = server("zip-out");
        let _ = std::fs::remove_dir_all(&out);
        std::fs::create_dir_all(&out).unwrap();
        unzip_into(&z, &out).unwrap();
        assert!(out.join("world/level.dat").is_file());
        assert!(out.join("server.properties").is_file());
        assert!(!out.join("logs/latest.log").exists(), "logs should be excluded");
    }

    #[test]
    fn hash_ignores_excluded_and_tracks_world() {
        let d = server("hash");
        let h1 = world_hash(&d);
        std::fs::write(d.join("logs/latest.log"), b"more noise").unwrap();
        assert_eq!(h1, world_hash(&d), "log churn must not change the hash");
        std::fs::write(d.join("world/level.dat"), b"changed").unwrap();
        assert_ne!(h1, world_hash(&d), "world change must change the hash");
    }

    #[test]
    fn create_pull_and_lease_handoff() {
        let blob = MemBlob::default();
        let a_dir = server("A");

        // A shares
        let a = sync(&blob, "A");
        a.create(&a_dir, "Shared", ServerType::Paper, Some("1.21.1".into()), "paper.jar").unwrap();

        // B joins into a fresh dir
        let b_dir = server("B-empty");
        let _ = std::fs::remove_dir_all(&b_dir);
        let b = sync(&blob, "B");
        let m = b.pull(&b_dir).unwrap();
        assert_eq!(m.name, "Shared");
        assert!(b_dir.join("world/level.dat").is_file());

        // A claims, B is blocked
        a.claim(false).unwrap();
        assert!(b.claim(false).unwrap_err().contains("In use"));

        // A plays (world changes), stops -> push + release
        std::fs::write(a_dir.join("world/level.dat"), b"progress").unwrap();
        assert!(a.push_if_changed(&a_dir).unwrap());
        a.release();

        // B claims, pulls the newer world
        b.claim(false).unwrap();
        assert!(b.pull_if_stale(&b_dir).unwrap());
        assert_eq!(std::fs::read(b_dir.join("world/level.dat")).unwrap(), b"progress");
    }

    #[test]
    fn stale_lease_is_takeable() {
        let blob = MemBlob::default();
        let d = server("stale");
        let a = sync(&blob, "A");
        a.create(&d, "S", ServerType::Vanilla, None, "server.jar").unwrap();
        let stale = Lease { holder: "ghost".into(), hostname: "old".into(), claimed_at: 0, expires_at: 1 };
        blob.put("TESTCODE/lease.json", &serde_json::to_vec(&stale).unwrap()).unwrap();
        sync(&blob, "B").claim(false).unwrap();
    }
}
