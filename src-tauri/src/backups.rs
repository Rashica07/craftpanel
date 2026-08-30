//! Server backups — a zip of the whole server folder minus regenerable junk,
//! stored under `<server>/craftpanel-backups/`.
//!
//! Restore never deletes: the current folder contents are moved aside to
//! `.craftpanel-pre-restore-<ts>/` and a fresh `pre-restore` backup is taken
//! first, so a restore is always reversible.

use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub const BACKUP_DIR: &str = "craftpanel-backups";
const PRE_RESTORE_PREFIX: &str = ".craftpanel-pre-restore-";

pub type Progress<'a> = dyn Fn(&str) + Send + Sync + 'a;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub id: String,
    pub created_at: i64,
    pub size_bytes: u64,
    #[serde(default)]
    pub label: Option<String>,
    /// "manual" | "pre-restore" | "scheduled"
    pub trigger: String,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn backup_root(dir: &Path) -> PathBuf {
    dir.join(BACKUP_DIR)
}

fn excluded(rel: &str) -> bool {
    let l = rel.to_ascii_lowercase();
    l == BACKUP_DIR
        || l.starts_with(&format!("{BACKUP_DIR}/"))
        || l.starts_with(PRE_RESTORE_PREFIX)
        || l == "logs"
        || l.starts_with("logs/")
        || l == "crash-reports"
        || l.starts_with("crash-reports/")
        || l.starts_with(".craftpanel-trash/")
        || l == ".craftpanel-session.json"
        || l.ends_with(".lock")
        || l == ".ds_store"
        || l.ends_with("/.ds_store")
}

fn short_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..6].to_string()
}

fn is_precompressed(rel: &str) -> bool {
    let ext = rel.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "jar" | "zip" | "gz" | "tgz" | "xz" | "zst" | "bz2" | "7z" | "rar"
            | "png" | "jpg" | "jpeg" | "webp" | "gif" | "ogg" | "mp3" | "aac"
    )
}

// --- create -------------------------------------------------------------------

/// Zip the server folder and record a sidecar. `trigger` is one of
/// `manual` / `pre-restore` / `scheduled`.
pub fn backup_now(
    dir: &Path,
    label: Option<&str>,
    trigger: &str,
    progress: &Progress<'_>,
) -> Result<Backup, String> {
    if !dir.is_dir() {
        return Err(format!("Server folder is missing: {}", dir.display()));
    }
    let root = backup_root(dir);
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;

    let ts = now();
    let id = format!("{ts}-{}", short_id());

    progress("Collecting files…");
    let files = collect_files(dir);
    progress(&format!("Compressing {} files…", files.len()));

    let mut buf = Vec::new();
    {
        let mut zip = zip::ZipWriter::new(Cursor::new(&mut buf));
        // already-compressed files (jars, images, archives) go in uncompressed —
        // deflating them wastes a lot of CPU for ~0 gain. Worlds/configs deflate
        // at the fastest level, which is plenty.
        let stored: zip::write::FileOptions<'_, ()> =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Stored);
        let deflate: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(1));
        for (i, (abs, rel)) in files.iter().enumerate() {
            if i % 200 == 0 && i > 0 {
                progress(&format!("Compressing… {i}/{}", files.len()));
            }
            let opts = if is_precompressed(rel) { stored } else { deflate };
            zip.start_file(rel, opts).map_err(|e| e.to_string())?;
            let mut f = fs::File::open(abs).map_err(|e| e.to_string())?;
            let mut b = Vec::new();
            f.read_to_end(&mut b).map_err(|e| e.to_string())?;
            zip.write_all(&b).map_err(|e| e.to_string())?;
        }
        zip.finish().map_err(|e| e.to_string())?;
    }

    let zip_path = root.join(format!("{id}.zip"));
    fs::write(&zip_path, &buf).map_err(|e| e.to_string())?;

    let meta = Backup {
        id: id.clone(),
        created_at: ts,
        size_bytes: buf.len() as u64,
        label: label.map(str::to_string).filter(|s| !s.trim().is_empty()),
        trigger: trigger.to_string(),
    };
    write_sidecar(&root, &meta)?;
    progress("Done.");
    Ok(meta)
}

fn collect_files(dir: &Path) -> Vec<(PathBuf, String)> {
    let mut out = Vec::new();
    for e in walkdir::WalkDir::new(dir).into_iter().flatten() {
        if !e.file_type().is_file() {
            continue;
        }
        let rel = match e.path().strip_prefix(dir) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };
        if rel.is_empty() || excluded(&rel) {
            continue;
        }
        out.push((e.path().to_path_buf(), rel));
    }
    out
}

fn write_sidecar(root: &Path, meta: &Backup) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(meta).map_err(|e| e.to_string())?;
    fs::write(root.join(format!("{}.json", meta.id)), json).map_err(|e| e.to_string())
}

// --- list / delete ----------------------------------------------------------

pub fn list(dir: &Path) -> Vec<Backup> {
    let root = backup_root(dir);
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(&root) {
        for entry in rd.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let Ok(raw) = fs::read(&path) else { continue };
            let Ok(mut meta) = serde_json::from_slice::<Backup>(&raw) else {
                continue;
            };
            // trust the zip on disk for the real size
            if let Ok(m) = fs::metadata(root.join(format!("{}.zip", meta.id))) {
                meta.size_bytes = m.len();
                out.push(meta);
            }
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    out
}

/// Read a backup's zip bytes off disk — used when pushing it to cloud
/// storage (`cloud.rs::push_backup`). Local backups are the source of
/// truth; the cloud copy is only ever made from one that already exists.
pub fn read_zip(dir: &Path, id: &str) -> Result<Vec<u8>, String> {
    let id = sanitize_id(id)?;
    fs::read(backup_root(dir).join(format!("{id}.zip"))).map_err(|e| e.to_string())
}

pub fn delete(dir: &Path, id: &str) -> Result<(), String> {
    let id = sanitize_id(id)?;
    let root = backup_root(dir);
    let zip = root.join(format!("{id}.zip"));
    if !zip.exists() {
        return Err("That backup no longer exists.".into());
    }
    fs::remove_file(&zip).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(root.join(format!("{id}.json")));
    Ok(())
}

/// Keep the newest `keep` `manual`/`scheduled` backups, delete the rest.
/// `pre-restore` backups are left alone. `keep == 0` means unlimited.
pub fn prune(dir: &Path, keep: usize) {
    if keep == 0 {
        return;
    }
    let prunable: Vec<Backup> = list(dir)
        .into_iter()
        .filter(|b| b.trigger != "pre-restore")
        .collect();
    for old in prunable.into_iter().skip(keep) {
        let _ = delete(dir, &old.id);
    }
}

// --- restore ---------------------------------------------------------------

/// Restore a backup over the server folder. The caller MUST ensure the server
/// is stopped. Always takes a fresh `pre-restore` backup and moves the current
/// contents aside first — nothing is deleted.
pub fn restore(dir: &Path, id: &str, progress: &Progress<'_>) -> Result<(), String> {
    let id = sanitize_id(id)?;
    let root = backup_root(dir);
    let zip_path = root.join(format!("{id}.zip"));
    if !zip_path.exists() {
        return Err("That backup no longer exists.".into());
    }

    progress("Backing up the current state first…");
    backup_now(dir, Some("before restore"), "pre-restore", progress)?;

    progress("Moving the current folder aside…");
    let aside = dir.join(format!("{PRE_RESTORE_PREFIX}{}", now()));
    fs::create_dir_all(&aside).map_err(|e| e.to_string())?;
    if let Ok(rd) = fs::read_dir(dir) {
        for entry in rd.flatten() {
            let name = entry.file_name();
            let n = name.to_string_lossy();
            if n == BACKUP_DIR || n.starts_with(PRE_RESTORE_PREFIX) {
                continue;
            }
            fs::rename(entry.path(), aside.join(&*n))
                .map_err(|e| format!("couldn't move {n} aside: {e}"))?;
        }
    }

    progress("Extracting the backup…");
    let data = fs::read(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(Cursor::new(data)).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut f = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = f.enclosed_name() else { continue };
        let out = dir.join(&rel);
        if f.is_dir() {
            fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(p) = out.parent() {
            fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        let mut w = fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut f, &mut w).map_err(|e| e.to_string())?;
    }
    progress(&format!(
        "Restored. The previous state is in {}",
        aside.file_name().unwrap().to_string_lossy()
    ));
    Ok(())
}

fn sanitize_id(id: &str) -> Result<String, String> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("Bad backup id.".into());
    }
    Ok(id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("cp-bak-{tag}-{:?}", std::thread::current().id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("world")).unwrap();
        fs::create_dir_all(d.join("logs")).unwrap();
        fs::create_dir_all(d.join("mods")).unwrap();
        fs::write(d.join("server.properties"), "level-name=world\nonline-mode=false\n").unwrap();
        fs::write(d.join("world/level.dat"), b"v1").unwrap();
        fs::write(d.join("mods/cool.jar"), b"jar").unwrap();
        fs::write(d.join("logs/latest.log"), b"noise").unwrap();
        d
    }

    fn noop(_: &str) {}

    #[test]
    fn backup_excludes_logs_keeps_mods_and_lists() {
        let d = server("mk");
        let b = backup_now(&d, Some("first"), "manual", &noop).unwrap();
        assert!(b.size_bytes > 0);
        assert_eq!(b.label.as_deref(), Some("first"));

        let listed = list(&d);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, b.id);

        // peek inside
        let zip_bytes =
            fs::read(d.join(BACKUP_DIR).join(format!("{}.zip", b.id))).unwrap();
        let mut a = zip::ZipArchive::new(Cursor::new(zip_bytes)).unwrap();
        let names: Vec<String> = (0..a.len())
            .map(|i| a.by_index(i).unwrap().name().to_string())
            .collect();
        assert!(names.iter().any(|n| n == "world/level.dat"));
        assert!(names.iter().any(|n| n == "mods/cool.jar"));
        assert!(!names.iter().any(|n| n.starts_with("logs/")));
        assert!(!names.iter().any(|n| n.starts_with(BACKUP_DIR)));
    }

    #[test]
    fn restore_rolls_back_world_and_keeps_previous_state() {
        let d = server("restore");
        let b = backup_now(&d, None, "manual", &noop).unwrap();

        // progress the world, then restore
        fs::write(d.join("world/level.dat"), b"v2-griefed").unwrap();
        fs::write(d.join("newfile.txt"), b"added later").unwrap();
        restore(&d, &b.id, &noop).unwrap();

        assert_eq!(fs::read(d.join("world/level.dat")).unwrap(), b"v1");

        // the v2 state was moved aside, not deleted
        let aside: Vec<_> = fs::read_dir(&d)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().starts_with(PRE_RESTORE_PREFIX))
            .collect();
        assert_eq!(aside.len(), 1);
        assert_eq!(
            fs::read(aside[0].path().join("world/level.dat")).unwrap(),
            b"v2-griefed"
        );
        assert!(aside[0].path().join("newfile.txt").is_file());

        // restore also made a pre-restore backup
        assert!(list(&d).iter().any(|x| x.trigger == "pre-restore"));
    }

    /// End-to-end against a real server folder:
    /// `CP_TEST_SERVER=~/Documents/MCServ cargo test real_server_backup_roundtrip -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_server_backup_roundtrip() {
        let src = std::env::var("CP_TEST_SERVER").expect("set CP_TEST_SERVER");
        let src = Path::new(&src);
        let work = std::env::temp_dir().join("cp-bak-real");
        let _ = fs::remove_dir_all(&work);
        copy_dir(src, &work);

        let before = fs::read(work.join("server.properties")).unwrap();
        let b = backup_now(&work, Some("e2e"), "manual", &|m| println!("  {m}")).unwrap();
        println!("backup {} = {} bytes", b.id, b.size_bytes);
        assert!(b.size_bytes > 0);

        // a backup must not contain logs/ or the backups dir
        let zip_bytes = fs::read(work.join(BACKUP_DIR).join(format!("{}.zip", b.id))).unwrap();
        let mut a = zip::ZipArchive::new(Cursor::new(zip_bytes)).unwrap();
        for i in 0..a.len() {
            let n = a.by_index(i).unwrap().name().to_string();
            assert!(!n.starts_with("logs/"), "leaked {n}");
            assert!(!n.starts_with(BACKUP_DIR), "leaked {n}");
        }

        // mutate, restore, verify rollback + move-aside
        fs::write(work.join("server.properties"), b"WRECKED").unwrap();
        restore(&work, &b.id, &|m| println!("  {m}")).unwrap();
        assert_eq!(fs::read(work.join("server.properties")).unwrap(), before);
        assert!(list(&work).iter().any(|x| x.trigger == "pre-restore"));

        let _ = fs::remove_dir_all(&work);
    }

    #[cfg(test)]
    fn copy_dir(from: &Path, to: &Path) {
        fs::create_dir_all(to).unwrap();
        for e in walkdir::WalkDir::new(from).into_iter().flatten() {
            let rel = e.path().strip_prefix(from).unwrap();
            if rel.as_os_str().is_empty() {
                continue;
            }
            let dst = to.join(rel);
            if e.file_type().is_dir() {
                let _ = fs::create_dir_all(&dst);
            } else if e.file_type().is_file() {
                if let Some(p) = dst.parent() {
                    let _ = fs::create_dir_all(p);
                }
                let _ = fs::copy(e.path(), &dst);
            }
        }
    }

    #[test]
    fn prune_keeps_newest_and_spares_pre_restore() {
        let d = server("prune");
        let mut ids = Vec::new();
        for i in 0..5 {
            let b = backup_now(&d, Some(&format!("b{i}")), "manual", &noop).unwrap();
            ids.push(b.id.clone());
            // force distinct createdAt ordering
            let root = backup_root(&d);
            let mut meta: Backup =
                serde_json::from_slice(&fs::read(root.join(format!("{}.json", b.id))).unwrap())
                    .unwrap();
            meta.created_at = 1000 + i;
            write_sidecar(&root, &meta).unwrap();
        }
        // a pre-restore one that must survive pruning
        let pr = backup_now(&d, None, "pre-restore", &noop).unwrap();

        prune(&d, 2);
        let left = list(&d);
        let manual_left = left.iter().filter(|b| b.trigger == "manual").count();
        assert_eq!(manual_left, 2);
        assert!(left.iter().any(|b| b.id == pr.id), "pre-restore must be kept");

        let _ = fs::remove_dir_all(&d);
    }
}
