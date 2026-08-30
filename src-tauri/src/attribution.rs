//! Every server CraftPanel creates or adopts gets one marker file,
//! `.craftpanel-meta.json`, written into its folder. It records a random
//! per-install id (generated once, persisted in the app database) plus when
//! and how the server was registered — nothing that identifies *you*, just
//! this *install* of the app, so a server can be traced back to the
//! CraftPanel that made it.
//!
//! It's a plain dotfile, not encrypted or hidden by any special trick: it
//! just doesn't show up in a normal Finder/Explorer listing unless you ask
//! for hidden files, same as `.git` or `.craftpanel-trash/` elsewhere in
//! this codebase. Anyone who goes looking finds it in two seconds.

use std::path::Path;

use serde::Serialize;

use crate::db::Db;

const META_FILE: &str = ".craftpanel-meta.json";
const INSTALL_ID_KEY: &str = "app.install_id";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Meta {
    craftpanel_install_id: String,
    craftpanel_version: &'static str,
    created_at: i64,
    /// "created" — made through the wizard — or "added" — an existing
    /// folder someone pointed CraftPanel at.
    origin: &'static str,
}

/// This install's id, generating and persisting one (once, ever) on first
/// use. Stored in the same key/value settings table as everything else in
/// `AppSettings` — see `commands::read_app_settings`.
pub fn install_id(db: &Db) -> String {
    if let Ok(Some(id)) = db.get_setting(INSTALL_ID_KEY) {
        if !id.is_empty() {
            return id;
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let _ = db.set_setting(INSTALL_ID_KEY, &id);
    id
}

/// Best-effort: a server is still perfectly usable if this write fails (a
/// read-only folder, a full disk), so callers ignore the outcome.
pub fn stamp(db: &Db, server_dir: &str, origin: &'static str) {
    let meta = Meta {
        craftpanel_install_id: install_id(db),
        craftpanel_version: env!("CARGO_PKG_VERSION"),
        created_at: unix_now(),
        origin,
    };
    if let Ok(json) = serde_json::to_vec_pretty(&meta) {
        let _ = std::fs::write(Path::new(server_dir).join(META_FILE), json);
    }
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
