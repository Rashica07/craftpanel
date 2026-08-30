//! Multi-device sharing, MVP: a server folder that lives in a synced location
//! (iCloud Drive / Dropbox / SMB) is claimed by exactly one device at a time via
//! an advisory lease file. The sync provider moves the world; the lease stops
//! two devices running it at once and corrupting the save.
//!
//! Files written into the server folder:
//!   craftpanel-share.json  — { code, name, created_by }        (static)
//!   craftpanel-lease.json  — { holder, hostname, claimed, exp } (mutable)

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub const SHARE_FILE: &str = "craftpanel-share.json";
pub const LEASE_FILE: &str = "craftpanel-lease.json";
/// A running device refreshes its lease well inside this window.
pub const LEASE_TTL_SECS: i64 = 120;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareInfo {
    pub code: String,
    pub name: String,
    pub created_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lease {
    /// stable per-device id
    pub holder: String,
    /// human name of the holding machine
    pub hostname: String,
    pub claimed_at: i64,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareView {
    pub shared: bool,
    pub code: Option<String>,
    /// lease held by anyone right now (and not expired)
    pub locked: bool,
    /// the current device holds it
    pub held_by_us: bool,
    pub holder_name: Option<String>,
    /// seconds until the current lease expires (negative if stale)
    pub expires_in: Option<i64>,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn hostname() -> String {
    // no std API; shell out, then fall back
    for (bin, args) in [
        ("scutil", &["--get", "ComputerName"][..]),
        ("hostname", &[][..]),
    ] {
        if let Ok(out) = std::process::Command::new(bin).args(args).output() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() {
                return s;
            }
        }
    }
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "this device".into())
}

/// Generate a share code: 8 chars, no vowels or look-alikes (0/O, 1/I).
pub fn gen_code() -> String {
    const ALPHABET: &[u8] = b"23456789BCDFGHJKMNPQRSTVWXZ";
    let mut out = String::with_capacity(9);
    for (i, byte) in uuid::Uuid::new_v4().as_bytes().iter().take(8).enumerate() {
        if i == 4 {
            out.push('-');
        }
        out.push(ALPHABET[(*byte as usize) % ALPHABET.len()] as char);
    }
    out
}

pub fn read_share(dir: &Path) -> Option<ShareInfo> {
    let text = fs::read_to_string(dir.join(SHARE_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn read_lease(dir: &Path) -> Option<Lease> {
    let text = fs::read_to_string(dir.join(LEASE_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

/// Write the share marker. Errors if the folder is already shared.
pub fn create_share(dir: &Path, name: &str) -> Result<ShareInfo, String> {
    if dir.join(SHARE_FILE).exists() {
        return Err("This server is already shared.".into());
    }
    let info = ShareInfo {
        code: gen_code(),
        name: name.to_string(),
        created_by: hostname(),
    };
    write_json(&dir.join(SHARE_FILE), &info)?;
    Ok(info)
}

pub fn view(dir: &Path, device_id: &str) -> ShareView {
    let Some(info) = read_share(dir) else {
        return ShareView {
            shared: false,
            code: None,
            locked: false,
            held_by_us: false,
            holder_name: None,
            expires_in: None,
        };
    };
    match read_lease(dir) {
        Some(l) => {
            let remaining = l.expires_at - now();
            ShareView {
                shared: true,
                code: Some(info.code),
                locked: remaining > 0,
                held_by_us: l.holder == device_id,
                holder_name: Some(l.hostname),
                expires_in: Some(remaining),
            }
        }
        None => ShareView {
            shared: true,
            code: Some(info.code),
            locked: false,
            held_by_us: false,
            holder_name: None,
            expires_in: None,
        },
    }
}

/// Try to take the lease. `force` overrides a stale-but-present or (with an
/// explicit user OK) a live lease.
pub fn claim(dir: &Path, device_id: &str, force: bool) -> Result<Lease, String> {
    if read_share(dir).is_none() {
        // not a shared server — nothing to claim
        return Ok(Lease {
            holder: device_id.to_string(),
            hostname: hostname(),
            claimed_at: now(),
            expires_at: now() + LEASE_TTL_SECS,
        });
    }
    if let Some(existing) = read_lease(dir) {
        let live = existing.expires_at > now();
        if existing.holder != device_id && live && !force {
            let mins = ((existing.expires_at - now()) / 60).max(0);
            return Err(format!(
                "In use on \"{}\" — its lease has ~{mins} min left. Start anyway only if that device is actually off.",
                existing.hostname
            ));
        }
    }
    let lease = Lease {
        holder: device_id.to_string(),
        hostname: hostname(),
        claimed_at: now(),
        expires_at: now() + LEASE_TTL_SECS,
    };
    write_json(&dir.join(LEASE_FILE), &lease)?;
    Ok(lease)
}

/// Extend our lease. No-op if we no longer hold it.
pub fn heartbeat(dir: &Path, device_id: &str) {
    if read_share(dir).is_none() {
        return;
    }
    if let Some(mut l) = read_lease(dir) {
        if l.holder == device_id {
            l.expires_at = now() + LEASE_TTL_SECS;
            let _ = write_json(&dir.join(LEASE_FILE), &l);
        }
    }
}

pub fn release(dir: &Path, device_id: &str) {
    if let Some(l) = read_lease(dir) {
        if l.holder == device_id {
            let _ = fs::remove_file(dir.join(LEASE_FILE));
        }
    }
}

fn write_json<T: Serialize>(path: &PathBuf, value: &T) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

/// Stable per-device id, persisted in the app config dir.
pub fn device_id(config_dir: &Path) -> String {
    let path = config_dir.join("device-id");
    if let Ok(existing) = fs::read_to_string(&path) {
        let t = existing.trim();
        if !t.is_empty() {
            return t.to_string();
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let _ = fs::write(&path, &id);
    id
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("cp-share-{:?}", std::thread::current().id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn code_has_no_lookalikes() {
        let c = gen_code();
        assert_eq!(c.len(), 9); // XXXX-XXXX
        assert!(!c.contains('0') && !c.contains('O') && !c.contains('1') && !c.contains('I'));
    }

    #[test]
    fn lease_lifecycle_and_conflict() {
        let d = tmp();
        create_share(&d, "Test").unwrap();

        // device A claims
        claim(&d, "A", false).unwrap();
        let v = view(&d, "A");
        assert!(v.shared && v.locked && v.held_by_us);

        // device B is refused while A's lease is live
        let err = claim(&d, "B", false).unwrap_err();
        assert!(err.contains("In use"));

        // B can force
        claim(&d, "B", true).unwrap();
        assert!(view(&d, "A").held_by_us == false);
        assert!(view(&d, "B").held_by_us);

        // B releases; now A can claim freely
        release(&d, "B");
        assert!(!view(&d, "A").locked);
        claim(&d, "A", false).unwrap();
    }

    #[test]
    fn stale_lease_is_takeable() {
        let d = tmp();
        create_share(&d, "Test").unwrap();
        let stale = Lease {
            holder: "ghost".into(),
            hostname: "old-laptop".into(),
            claimed_at: now() - 10_000,
            expires_at: now() - 5_000,
        };
        write_json(&d.join(LEASE_FILE), &stale).unwrap();
        // not forced, but it's expired -> allowed
        claim(&d, "me", false).unwrap();
        assert!(view(&d, "me").held_by_us);
    }

    #[test]
    fn double_share_is_rejected() {
        let d = tmp();
        create_share(&d, "Test").unwrap();
        assert!(create_share(&d, "Test").is_err());
    }
}
