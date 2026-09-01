//! "Time Machine" world snapshots — cheap, frequent, hardlink-based rollback
//! points, stored under `<server>/craftpanel-snapshots/<id>/`.
//!
//! Unlike `backups.rs`'s zip `Backup`s (one self-contained archive per copy,
//! good for cloud upload / moving elsewhere), a `Snapshot` is a real mirror
//! of the server folder on disk: files unchanged since the previous snapshot
//! are hard-linked (same inode, ~0 extra disk), only files that actually
//! changed get a fresh copy. This is exactly how `rsync --link-dest` and
//! macOS Time Machine itself keep frequent snapshots cheap — no chunking or
//! content-addressed store needed, and it costs nothing extra to delete an
//! old snapshot: the OS only frees a file's data once its last hard link
//! (from any snapshot, or none) is gone, so removing snapshot N never
//! touches file data still linked from snapshot N+1.
//!
//! Zip `Backup`s remain the durable, portable, cloud-syncable format —
//! snapshots are a fast, local-only, high-frequency complement to them, not
//! a replacement. A restore still takes a full zip safety-net backup first,
//! same as `backups::restore` does.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::backups::{self, Progress, BACKUP_DIR, PRE_RESTORE_PREFIX};

pub const SNAPSHOT_DIR: &str = "craftpanel-snapshots";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub created_at: i64,
    /// "manual" | "scheduled"
    pub trigger: String,
    /// Bytes actually written fresh this snapshot (hard-linked files don't
    /// count) — the real marginal disk cost, not the tree's full logical
    /// size. Lets the UI honestly show "this snapshot cost you 4 KB", the
    /// whole point of the feature.
    pub new_bytes: u64,
    pub file_count: u64,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn short_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..6].to_string()
}

fn snapshot_root(dir: &Path) -> PathBuf {
    dir.join(SNAPSHOT_DIR)
}

/// A file is reused (hard-linked) instead of copied fresh only if its size
/// *and* mtime match the previous snapshot's copy exactly — the same cheap
/// "did this change" heuristic `sync.rs::world_hash` uses per-file, just
/// without hashing file contents (hashing every file on every snapshot
/// would defeat the point of a *cheap, frequent* snapshot).
fn unchanged(cur: &fs::Metadata, prev: &fs::Metadata) -> bool {
    cur.len() == prev.len() && cur.modified().ok() == prev.modified().ok()
}

// --- create -------------------------------------------------------------------

/// Take a snapshot: hard-link whatever didn't change since the previous
/// snapshot, copy fresh whatever did (or everything, for the first one).
/// `trigger` is "manual" or "scheduled".
pub fn snapshot_now(dir: &Path, trigger: &str, progress: &Progress<'_>) -> Result<Snapshot, String> {
    if !dir.is_dir() {
        return Err(format!("Server folder is missing: {}", dir.display()));
    }
    let root = snapshot_root(dir);
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;

    let prev_id = list(dir).into_iter().next().map(|s| s.id);
    let prev_dir = prev_id.map(|id| root.join(id));

    let ts = now();
    let id = format!("{ts}-{}", short_id());
    let new_dir = root.join(&id);
    fs::create_dir_all(&new_dir).map_err(|e| e.to_string())?;

    progress("Collecting files…");
    let files = backups::collect_files(dir);
    progress(&format!("Snapshotting {} files…", files.len()));

    let mut new_bytes = 0u64;
    for (i, (abs, rel)) in files.iter().enumerate() {
        if i % 200 == 0 && i > 0 {
            progress(&format!("Snapshotting… {i}/{}", files.len()));
        }
        let dest = new_dir.join(rel);
        if let Some(p) = dest.parent() {
            fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }

        let mut linked = false;
        if let Some(pd) = &prev_dir {
            let prev_file = pd.join(rel);
            if let (Ok(cur_meta), Ok(prev_meta)) = (fs::metadata(abs), fs::metadata(&prev_file)) {
                if unchanged(&cur_meta, &prev_meta) && fs::hard_link(&prev_file, &dest).is_ok() {
                    linked = true;
                }
            }
        }
        if !linked {
            let n = fs::copy(abs, &dest).map_err(|e| format!("couldn't copy {rel}: {e}"))?;
            new_bytes += n;
        }
    }

    let meta = Snapshot {
        id: id.clone(),
        created_at: ts,
        trigger: trigger.to_string(),
        new_bytes,
        file_count: files.len() as u64,
    };
    write_sidecar(&root, &meta)?;
    progress("Done.");
    Ok(meta)
}

fn write_sidecar(root: &Path, meta: &Snapshot) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(meta).map_err(|e| e.to_string())?;
    fs::write(root.join(format!("{}.json", meta.id)), json).map_err(|e| e.to_string())
}

// --- list / delete ----------------------------------------------------------

pub fn list(dir: &Path) -> Vec<Snapshot> {
    let root = snapshot_root(dir);
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(&root) {
        for entry in rd.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let Ok(raw) = fs::read(&path) else { continue };
            let Ok(meta) = serde_json::from_slice::<Snapshot>(&raw) else { continue };
            // a snapshot whose directory got deleted out from under us (disk
            // tampering, a crash mid-write) doesn't get listed as if it were
            // still restorable
            if root.join(&meta.id).is_dir() {
                out.push(meta);
            }
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    out
}

pub fn delete(dir: &Path, id: &str) -> Result<(), String> {
    let id = backups::sanitize_id(id)?;
    let root = snapshot_root(dir);
    let target = root.join(&id);
    if !target.is_dir() {
        return Err("That snapshot no longer exists.".into());
    }
    // safe regardless of hard-link fan-out: removing this directory's links
    // only drops each file's link count by one — data backing a file still
    // linked from another snapshot is untouched.
    fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(root.join(format!("{id}.json")));
    Ok(())
}

/// Tiered retention, Time-Machine style: every snapshot from the last
/// `keep_recent_hours` is kept outright; beyond that, thin to the newest
/// snapshot per calendar day for up to `keep_daily_days` days; anything
/// older than that is dropped. Bucketing is by UTC day, which is precise
/// enough for a retention *heuristic* (unlike the HH:MM schedule matching
/// in `schedule.rs`, which does need the user's local day).
pub fn prune(dir: &Path, keep_recent_hours: u32, keep_daily_days: u32) {
    let all = list(dir);
    if all.is_empty() {
        return;
    }
    let now = now();
    let recent_cutoff = now - keep_recent_hours as i64 * 3600;
    let now_day = now.div_euclid(86400);

    let mut keep_ids: HashSet<String> = HashSet::new();
    let mut best_per_day: HashMap<i64, &Snapshot> = HashMap::new();

    for s in &all {
        if s.created_at >= recent_cutoff {
            keep_ids.insert(s.id.clone());
            continue;
        }
        let day = s.created_at.div_euclid(86400);
        let age_days = now_day - day;
        if age_days > keep_daily_days as i64 {
            continue; // past the retention window entirely
        }
        let better = best_per_day.get(&day).is_none_or(|cur| s.created_at > cur.created_at);
        if better {
            best_per_day.insert(day, s);
        }
    }
    keep_ids.extend(best_per_day.values().map(|s| s.id.clone()));

    for s in &all {
        if !keep_ids.contains(&s.id) {
            let _ = delete(dir, &s.id);
        }
    }
}

// --- restore ---------------------------------------------------------------

/// Restore a snapshot over the server folder. Caller MUST ensure the server
/// is stopped. Same "never delete, move aside" contract as
/// `backups::restore`, plus a fresh zip safety-net backup first — belt and
/// suspenders, since a snapshot restore is new/less battle-tested than the
/// zip path.
pub fn restore(dir: &Path, id: &str, progress: &Progress<'_>) -> Result<(), String> {
    let id = backups::sanitize_id(id)?;
    let src = snapshot_root(dir).join(&id);
    if !src.is_dir() {
        return Err("That snapshot no longer exists.".into());
    }

    progress("Backing up the current state first…");
    backups::backup_now(dir, Some("before restore"), "pre-restore", progress)?;

    progress("Moving the current folder aside…");
    let aside = dir.join(format!("{PRE_RESTORE_PREFIX}{}", now()));
    fs::create_dir_all(&aside).map_err(|e| e.to_string())?;
    if let Ok(rd) = fs::read_dir(dir) {
        for entry in rd.flatten() {
            let name = entry.file_name();
            let n = name.to_string_lossy();
            if n == BACKUP_DIR || n == SNAPSHOT_DIR || n.starts_with(PRE_RESTORE_PREFIX) {
                continue;
            }
            fs::rename(entry.path(), aside.join(&*n))
                .map_err(|e| format!("couldn't move {n} aside: {e}"))?;
        }
    }

    progress("Copying the snapshot back…");
    for e in walkdir::WalkDir::new(&src).into_iter().flatten() {
        if !e.file_type().is_file() {
            continue;
        }
        let Ok(rel) = e.path().strip_prefix(&src) else { continue };
        let out = dir.join(rel);
        if let Some(p) = out.parent() {
            fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        // a fresh copy, deliberately not another hard link — restored files
        // should be independent of the snapshot store from this point on.
        fs::copy(e.path(), &out).map_err(|e| e.to_string())?;
    }
    progress(&format!(
        "Restored. The previous state is in {}",
        aside.file_name().unwrap().to_string_lossy()
    ));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("cp-snap-{tag}-{:?}", std::thread::current().id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("world")).unwrap();
        fs::create_dir_all(d.join("mods")).unwrap();
        fs::write(d.join("server.properties"), "level-name=world\n").unwrap();
        fs::write(d.join("world/level.dat"), b"v1").unwrap();
        fs::write(d.join("mods/cool.jar"), b"jar-bytes").unwrap();
        d
    }

    fn noop(_: &str) {}

    #[test]
    fn first_snapshot_copies_everything() {
        let d = server("first");
        let s = snapshot_now(&d, "manual", &noop).unwrap();
        assert_eq!(s.file_count, 3);
        assert!(s.new_bytes > 0);
        assert_eq!(list(&d).len(), 1);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn unchanged_files_are_hardlinked_not_copied() {
        let d = server("hardlink");
        let s1 = snapshot_now(&d, "manual", &noop).unwrap();
        // nothing changed on disk at all
        let s2 = snapshot_now(&d, "manual", &noop).unwrap();
        assert_eq!(s2.new_bytes, 0, "nothing changed, so nothing should be freshly copied");

        // and it's a *real* hard link, not just identical content
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let a = fs::metadata(snapshot_root(&d).join(&s1.id).join("world/level.dat")).unwrap();
            let b = fs::metadata(snapshot_root(&d).join(&s2.id).join("world/level.dat")).unwrap();
            assert_eq!(a.ino(), b.ino(), "expected the same inode across snapshots");
        }
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn changed_file_gets_a_fresh_copy_others_stay_linked() {
        let d = server("changed");
        snapshot_now(&d, "manual", &noop).unwrap();
        fs::write(d.join("world/level.dat"), b"v2-longer-than-before").unwrap();
        let s2 = snapshot_now(&d, "manual", &noop).unwrap();
        assert_eq!(s2.new_bytes, b"v2-longer-than-before".len() as u64);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn deleting_an_older_snapshot_does_not_corrupt_a_newer_one_sharing_hardlinks() {
        let d = server("delsafe");
        let s1 = snapshot_now(&d, "manual", &noop).unwrap();
        let s2 = snapshot_now(&d, "manual", &noop).unwrap(); // fully hardlinked to s1

        delete(&d, &s1.id).unwrap();

        // s2's copy of the unchanged file must still read back correctly —
        // proves deleting s1 only dropped a link, not the underlying data
        let content = fs::read(snapshot_root(&d).join(&s2.id).join("world/level.dat")).unwrap();
        assert_eq!(content, b"v1");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn restore_copies_files_back_and_preserves_current_state_aside() {
        let d = server("restore");
        let s1 = snapshot_now(&d, "manual", &noop).unwrap();

        fs::write(d.join("world/level.dat"), b"griefed").unwrap();
        fs::write(d.join("newfile.txt"), b"added later").unwrap();
        restore(&d, &s1.id, &noop).unwrap();

        assert_eq!(fs::read(d.join("world/level.dat")).unwrap(), b"v1");

        let aside: Vec<_> = fs::read_dir(&d)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().starts_with(PRE_RESTORE_PREFIX))
            .collect();
        assert_eq!(aside.len(), 1);
        assert_eq!(fs::read(aside[0].path().join("world/level.dat")).unwrap(), b"griefed");
        assert!(aside[0].path().join("newfile.txt").is_file());

        // restore also took a real zip safety-net backup
        assert!(backups::list(&d).iter().any(|b| b.trigger == "pre-restore"));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn prune_keeps_recent_window_and_thins_older_to_one_per_day() {
        let d = server("prune");
        let root = snapshot_root(&d);
        let now = now();

        // 3 snapshots today (well within a 24h recent window)
        let mut today_ids = Vec::new();
        for i in 0..3 {
            let s = snapshot_now(&d, "scheduled", &noop).unwrap();
            let mut meta = s.clone();
            meta.created_at = now - i * 60; // minutes apart, still "today"/"recent"
            write_sidecar(&root, &meta).unwrap();
            today_ids.push(meta.id);
        }

        // 2 snapshots each on two older days (5 and 6 days ago) — should thin to 1/day
        let mut older_kept = Vec::new();
        for day_offset in [5i64, 6i64] {
            let mut best = None;
            for j in 0..2 {
                let s = snapshot_now(&d, "scheduled", &noop).unwrap();
                let mut meta = s.clone();
                meta.created_at = now - day_offset * 86400 - j * 3600;
                write_sidecar(&root, &meta).unwrap();
                if j == 0 {
                    best = Some(meta.id.clone()); // j=0 is the newer (larger created_at) of the pair
                }
            }
            older_kept.push(best.unwrap());
        }

        // 1 snapshot far outside the daily window (60 days ago) — must be dropped entirely
        let ancient = snapshot_now(&d, "scheduled", &noop).unwrap();
        let mut meta = ancient.clone();
        meta.created_at = now - 60 * 86400;
        write_sidecar(&root, &meta).unwrap();

        prune(&d, 24, 30);
        let left: HashSet<String> = list(&d).into_iter().map(|s| s.id).collect();

        for id in &today_ids {
            assert!(left.contains(id), "recent snapshot {id} should survive");
        }
        for id in &older_kept {
            assert!(left.contains(id), "newest-of-the-day {id} should survive thinning");
        }
        assert_eq!(left.len(), today_ids.len() + older_kept.len(), "one-per-older-day, ancient one dropped");
        assert!(!left.contains(&ancient.id), "60-day-old snapshot must be pruned outright");

        let _ = fs::remove_dir_all(&d);
    }
}
