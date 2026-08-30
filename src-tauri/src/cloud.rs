//! Ties R2 + the sync protocol into the server lifecycle. One `CloudManager`
//! lives in Tauri state; it holds the R2 credentials and implements
//! `ServerLifecycle` so `ProcessManager` calls it around start/stop.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::db::ServerRecord;
use crate::process::ServerLifecycle;
use crate::r2::{R2Config, R2};
use crate::share;
use crate::sync::{CloudStatus, Sync};

pub struct CloudManager {
    app: AppHandle,
    config_path: PathBuf,
    config: Mutex<Option<R2Config>>,
    device_id: String,
    hostname: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncProgress<'a> {
    server_id: &'a str,
    message: &'a str,
}

impl CloudManager {
    pub fn new(app: AppHandle, config_dir: &Path, device_id: String) -> Self {
        let config_path = config_dir.join("r2.json");
        let config = std::fs::read_to_string(&config_path)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok());
        CloudManager {
            app,
            config_path,
            config: Mutex::new(config),
            device_id,
            hostname: share::hostname(),
        }
    }

    pub fn is_configured(&self) -> bool {
        self.config.lock().unwrap().is_some()
    }

    /// Config with the secret blanked, for display.
    pub fn config_redacted(&self) -> Option<R2Config> {
        self.config.lock().unwrap().clone().map(|mut c| {
            c.secret_access_key = if c.secret_access_key.is_empty() {
                String::new()
            } else {
                "••••••••".into()
            };
            c
        })
    }

    pub fn set_config(&self, cfg: R2Config) -> Result<(), String> {
        R2::new(&cfg)?.check()?;
        std::fs::write(
            &self.config_path,
            serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        *self.config.lock().unwrap() = Some(cfg);
        Ok(())
    }

    pub fn clear_config(&self) {
        let _ = std::fs::remove_file(&self.config_path);
        *self.config.lock().unwrap() = None;
    }

    fn r2(&self) -> Result<R2, String> {
        let cfg = self
            .config
            .lock()
            .unwrap()
            .clone()
            .ok_or("Cloud sync isn't set up. Add your R2 details in Settings first.")?;
        R2::new(&cfg)
    }

    /// The same cheap round-trip `r2()` would do internally, exposed for the
    /// doctor pre-flight check — without handing the raw credentials out.
    pub fn check(&self) -> Result<(), String> {
        self.r2()?.check()
    }

    fn sync_for<'a>(&self, r2: &'a R2, code: &str) -> Sync<'a> {
        Sync {
            blob: r2,
            code: code.to_string(),
            device_id: self.device_id.clone(),
            hostname: self.hostname.clone(),
        }
    }

    fn progress(&self, server_id: &str, message: &str) {
        let _ = self.app.emit(
            "sync:progress",
            SyncProgress { server_id, message },
        );
    }

    // --- operations invoked by commands -----------------------------------

    /// First upload of an existing local server. Returns the generated code.
    pub fn share(&self, rec: &ServerRecord) -> Result<String, String> {
        let r2 = self.r2()?;
        let code = share::gen_code();
        self.progress(&rec.id, "Zipping the world…");
        let s = self.sync_for(&r2, &code);
        s.create(
            Path::new(&rec.path),
            &rec.name,
            rec.server_type,
            rec.mc_version.clone(),
            &rec.launch_target,
        )?;
        self.progress(&rec.id, "Uploaded.");
        Ok(code)
    }

    /// Download a shared server's world into `dest` (must be empty). Returns the
    /// manifest so the caller can build the DB row.
    pub fn join(&self, code: &str, dest: &Path) -> Result<crate::sync::Manifest, String> {
        let r2 = self.r2()?;
        self.progress("", "Downloading the world…");
        let s = self.sync_for(&r2, code);
        let m = s.pull(dest)?;
        self.progress("", "Done.");
        Ok(m)
    }

    pub fn status(&self, rec: &ServerRecord) -> Result<Option<CloudStatus>, String> {
        let Some(code) = &rec.sync_code else {
            return Ok(None);
        };
        let r2 = self.r2()?;
        Ok(Some(self.sync_for(&r2, code).status(Path::new(&rec.path))?))
    }

    /// Explicit "sync now" after a stop: push the world + release the lease.
    pub fn finish(&self, rec: &ServerRecord) -> Result<(), String> {
        let Some(code) = &rec.sync_code else {
            return Ok(());
        };
        let r2 = self.r2()?;
        let s = self.sync_for(&r2, code);
        self.progress(&rec.id, "Uploading changes…");
        let pushed = s.push_if_changed(Path::new(&rec.path))?;
        s.release();
        self.progress(&rec.id, if pushed { "Synced." } else { "Nothing to sync." });
        Ok(())
    }

    pub fn unshare(&self, rec: &ServerRecord) -> Result<(), String> {
        // local only — leave the objects in R2 (other devices may still use them)
        let _ = rec;
        Ok(())
    }

    // --- scheduled backups off-machine (Schedule.cloud_backup) ------------
    //
    // Deliberately no `ListObjectsV2` XML parsing — same "no AWS SDK, keep it
    // minimal" spirit as the rest of r2.rs. Each server keeps a single
    // `index.json` object listing its cloud backups; push/prune read-modify-
    // write that index instead of listing the bucket.

    fn backup_key(server_id: &str, backup_id: &str) -> String {
        format!("backups/{server_id}/{backup_id}.zip")
    }

    fn backup_index_key(server_id: &str) -> String {
        format!("backups/{server_id}/index.json")
    }

    /// Upload one backup's zip and fold it into that server's remote index,
    /// pruning to `keep` (0 = unlimited) the same way local backups do.
    pub fn push_backup(
        &self,
        server_id: &str,
        backup: &crate::backups::Backup,
        zip_bytes: &[u8],
        keep: usize,
    ) -> Result<(), String> {
        let r2 = self.r2()?;
        r2.put(&Self::backup_key(server_id, &backup.id), zip_bytes, "application/zip")?;

        let index = r2
            .get_json(&Self::backup_index_key(server_id))?
            .unwrap_or_default();
        let (kept, dropped) = merge_and_prune(index, backup.clone(), keep);
        r2.put_json(&Self::backup_index_key(server_id), &kept)?;
        for d in dropped {
            let _ = r2.delete(&Self::backup_key(server_id, &d.id));
        }
        Ok(())
    }

    /// This server's cloud backup listing — reads the index only, no zips.
    pub fn cloud_backups(&self, server_id: &str) -> Result<Vec<crate::backups::Backup>, String> {
        let r2 = self.r2()?;
        Ok(r2
            .get_json(&Self::backup_index_key(server_id))?
            .unwrap_or_default())
    }
}

impl ServerLifecycle for CloudManager {
    fn before_start(&self, rec: &ServerRecord, force: bool) -> Result<(), String> {
        let Some(code) = &rec.sync_code else {
            return Ok(());
        };
        let r2 = self.r2()?;
        let s = self.sync_for(&r2, code);
        self.progress(&rec.id, "Claiming the sync lease…");
        s.claim(force)?;
        self.progress(&rec.id, "Checking for a newer world…");
        if s.pull_if_stale(Path::new(&rec.path))? {
            self.progress(&rec.id, "Pulled the latest world.");
        }
        Ok(())
    }

    fn heartbeat(&self, rec: &ServerRecord) {
        let Some(code) = rec.sync_code.as_deref() else {
            return;
        };
        if let Ok(r2) = self.r2() {
            self.sync_for(&r2, code).heartbeat();
        }
    }

    fn after_exit(&self, rec: &ServerRecord) {
        // best-effort; the explicit `finish` command is the reliable path
        if rec.sync_code.is_none() {
            return;
        }
        if let Ok(r2) = self.r2() {
            let s = self.sync_for(&r2, rec.sync_code.as_deref().unwrap());
            let _ = s.push_if_changed(Path::new(&rec.path));
            s.release();
        }
    }
}

/// The pure part of `push_backup`: fold `new` into `index` (replacing any
/// existing entry with the same id), sort newest-first, and split off
/// anything past `keep` (0 = unlimited). Pulled out of `push_backup` itself
/// so it's testable without a real R2 connection — everything else in that
/// function is a network call this codebase has no live credentials to
/// exercise yet (see the R2 status note in project memory).
fn merge_and_prune(
    mut index: Vec<crate::backups::Backup>,
    new: crate::backups::Backup,
    keep: usize,
) -> (Vec<crate::backups::Backup>, Vec<crate::backups::Backup>) {
    index.retain(|b| b.id != new.id);
    index.push(new);
    index.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    let dropped = if keep > 0 && index.len() > keep {
        index.split_off(keep)
    } else {
        Vec::new()
    };
    (index, dropped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backups::Backup;

    fn bk(id: &str, created_at: i64) -> Backup {
        Backup {
            id: id.to_string(),
            created_at,
            size_bytes: 100,
            label: None,
            trigger: "scheduled".to_string(),
        }
    }

    #[test]
    fn merge_sorts_newest_first_and_prunes_the_oldest() {
        let index = vec![bk("a", 100), bk("b", 300), bk("c", 200)];
        let (kept, dropped) = merge_and_prune(index, bk("d", 400), 2);
        assert_eq!(
            kept.iter().map(|b| b.id.as_str()).collect::<Vec<_>>(),
            vec!["d", "b"]
        );
        assert_eq!(
            dropped.iter().map(|b| b.id.as_str()).collect::<Vec<_>>(),
            vec!["c", "a"]
        );
    }

    #[test]
    fn zero_keep_means_unlimited() {
        let index = vec![bk("a", 100), bk("b", 200)];
        let (kept, dropped) = merge_and_prune(index, bk("c", 300), 0);
        assert_eq!(kept.len(), 3);
        assert!(dropped.is_empty());
    }

    #[test]
    fn re_pushing_the_same_backup_id_replaces_it_not_duplicates_it() {
        let index = vec![bk("a", 100)];
        let (kept, dropped) = merge_and_prune(index, bk("a", 999), 10);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].created_at, 999);
        assert!(dropped.is_empty());
    }
}
