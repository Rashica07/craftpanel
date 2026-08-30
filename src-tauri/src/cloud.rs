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
