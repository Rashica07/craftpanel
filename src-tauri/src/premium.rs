//! CraftPanel Premium: license-key activation against the licensing API
//! (see `/licensing` at the repo root — a small Cloudflare Worker in front
//! of Stripe) plus the "rarely, not naggily" upsell-popup bookkeeping.
//!
//! Deliberately thin: this module only tracks *whether* a key is active.
//! It does not gate any feature itself — each Premium feature checks
//! `premium_status_get().active` for itself as it's built, so a feature
//! that doesn't exist yet never shows a "Premium" lock on nothing.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::Db;

fn licensing_base() -> String {
    // Overridable for local testing against `wrangler dev` (see
    // /licensing/README.md) without rebuilding the app.
    std::env::var("CRAFTPANEL_LICENSING_URL")
        .unwrap_or_else(|_| "https://craftpanel-licensing.kristiangjergji20.workers.dev".to_string())
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Not cryptographically random and doesn't need to be — this only paces
/// how often an upsell popup *might* appear, not anything security-sensitive.
/// Avoids pulling in the `rand` crate for one coin-flip.
fn pseudo_random_unit() -> f64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    (nanos % 1000) as f64 / 1000.0
}

const PREMIUM_STATUS_KEY: &str = "premium.status";
const UPSELL_MIN_GAP_MS: i64 = 4 * 24 * 60 * 60 * 1000; // 4 days
const UPSELL_SHOW_CHANCE: f64 = 0.3;

/// A standing lifetime key that activates Premium without ever touching
/// the licensing API — for the developer's own install, so it works today
/// with no Stripe/Cloudflare deployment live yet. This repo is public, so
/// the key itself is never in source, only its Argon2 hash (same KDF
/// `lock.rs` uses for the app-lock PIN) — reading this file gets you the
/// hash, not the key, same as a leaked password database shouldn't hand
/// out plaintext passwords.
const FOUNDER_KEY_HASH: &str =
    "$argon2id$v=19$m=19456,t=2,p=1$QH0w9o9u7xJCsqqfAmUVSg$XZnDAo/JbQGlyjohVBtmbxhqlChulLdlUTEdOMJYHVg";

fn verify_key_against_hash(key: &str, hash: &str) -> bool {
    use argon2::password_hash::{PasswordHash, PasswordVerifier};
    let Ok(parsed) = PasswordHash::new(hash) else { return false };
    argon2::Argon2::default().verify_password(key.as_bytes(), &parsed).is_ok()
}

fn is_founder_key(key: &str) -> bool {
    verify_key_against_hash(key, FOUNDER_KEY_HASH)
}

#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PremiumStatus {
    /// Empty = never activated on this install.
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub active: bool,
    /// "monthly" | "yearly" | "lifetime"
    #[serde(default)]
    pub plan: Option<String>,
    /// "active" | "canceled" | "past_due" — as last reported by the server.
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub current_period_end: Option<i64>,
    /// When `active` was last *confirmed* against the server — a stale
    /// value (server unreachable) doesn't demote `active`, so this is
    /// what tells the UI "confirmed just now" from "assumed, last checked
    /// a while ago" if it ever wants to say so.
    #[serde(default)]
    pub last_checked: i64,
    #[serde(default)]
    pub upsell_dismissed_forever: bool,
    #[serde(default)]
    pub upsell_last_shown: i64,
}

fn read_status(db: &Db) -> PremiumStatus {
    db.get_setting(PREMIUM_STATUS_KEY)
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_status(db: &Db, status: &PremiumStatus) -> Result<(), String> {
    let json = serde_json::to_string(status).map_err(|e| e.to_string())?;
    db.set_setting(PREMIUM_STATUS_KEY, &json).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct ValidateResponse {
    valid: bool,
    #[serde(default)]
    plan: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    #[serde(rename = "currentPeriodEnd")]
    current_period_end: Option<i64>,
}

fn validate_remote(key: &str) -> Result<ValidateResponse, String> {
    ureq::get(&format!("{}/api/license/validate", licensing_base()))
        .query("key", key)
        .timeout(std::time::Duration::from_secs(10))
        .call()
        .map_err(|e| format!("Couldn't reach the licensing server: {e}"))?
        .into_json()
        .map_err(|e| format!("Licensing server returned bad JSON: {e}"))
}

/// For gating a Premium-only capability from other modules — reads the
/// locally-cached status (fast, no network), same as the UI does via
/// `premium_status_get`. Anything that fires in the background on a timer
/// (the scheduler) or from a plain command should call this rather than
/// re-implementing the "read the settings row" dance itself.
pub fn is_active(db: &Db) -> bool {
    read_status(db).active
}

/// Pure so it's testable without a real clock or a real coin flip.
fn should_show_upsell(status: &PremiumStatus, now: i64, roll: f64) -> bool {
    if status.active || status.upsell_dismissed_forever {
        return false;
    }
    if status.upsell_last_shown != 0 && now - status.upsell_last_shown < UPSELL_MIN_GAP_MS {
        return false;
    }
    roll < UPSELL_SHOW_CHANCE
}

#[tauri::command]
pub fn premium_status_get(db: State<Db>) -> PremiumStatus {
    read_status(&db)
}

#[tauri::command]
pub fn premium_activate(db: State<Db>, key: String) -> Result<PremiumStatus, String> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("Enter a license key.".to_string());
    }

    let mut status = read_status(&db);
    status.key = key.clone();
    status.active = true;
    status.last_checked = now_ms();

    if is_founder_key(&key) {
        status.plan = Some("lifetime".to_string());
        status.status = Some("active".to_string());
        status.current_period_end = None;
    } else {
        let resp = validate_remote(&key)?;
        if !resp.valid {
            return Err("That key isn't active — check for typos, or it may have expired.".to_string());
        }
        status.plan = resp.plan;
        status.status = resp.status;
        status.current_period_end = resp.current_period_end;
    }

    write_status(&db, &status)?;
    Ok(status)
}

/// Re-checks an already-activated key. Called at app start and
/// periodically — a subscription can lapse without the app being told.
/// A network failure keeps the last-known-good state rather than
/// deactivating Premium just because the licensing server was briefly
/// unreachable.
#[tauri::command]
pub fn premium_refresh(db: State<Db>) -> PremiumStatus {
    let mut status = read_status(&db);
    if status.key.is_empty() || is_founder_key(&status.key) {
        return status;
    }
    if let Ok(resp) = validate_remote(&status.key) {
        status.active = resp.valid;
        status.plan = resp.plan.or(status.plan);
        status.status = resp.status;
        status.current_period_end = resp.current_period_end;
        status.last_checked = now_ms();
        let _ = write_status(&db, &status);
    }
    status
}

#[tauri::command]
pub fn premium_deactivate(db: State<Db>) -> Result<(), String> {
    write_status(&db, &PremiumStatus::default())
}

/// Decides, and records the attempt either way (so a "no" this time
/// doesn't get re-rolled again five seconds later on next launch — the
/// 4-day gate applies whether or not this particular roll shows it).
#[tauri::command]
pub fn premium_maybe_show_upsell(db: State<Db>) -> bool {
    let mut status = read_status(&db);
    let now = now_ms();
    let gate_open = status.upsell_last_shown == 0 || now - status.upsell_last_shown >= UPSELL_MIN_GAP_MS;
    let show = should_show_upsell(&status, now, pseudo_random_unit());
    if gate_open && !status.active && !status.upsell_dismissed_forever {
        status.upsell_last_shown = now;
        let _ = write_status(&db, &status);
    }
    show
}

#[tauri::command]
pub fn premium_dismiss_upsell_forever(db: State<Db>) -> Result<(), String> {
    let mut status = read_status(&db);
    status.upsell_dismissed_forever = true;
    write_status(&db, &status)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> PremiumStatus {
        PremiumStatus::default()
    }

    /// Exercises `verify_key_against_hash` — the same function
    /// `is_founder_key` calls — against a throwaway key/hash pair
    /// generated fresh in the test itself. Deliberately never asserts on
    /// the real `FOUNDER_KEY_HASH` constant or its plaintext key: this
    /// file is public, so nothing that would let a reader confirm a
    /// guessed key belongs in a test any more than in the source itself.
    #[test]
    fn key_verification_accepts_a_match_and_rejects_lookalikes() {
        use argon2::password_hash::rand_core::OsRng;
        use argon2::password_hash::{PasswordHasher, SaltString};
        use argon2::Argon2;

        let key = "CP-TEST-0000-0000-0000-0000";
        let salt = SaltString::generate(&mut OsRng);
        let hash = Argon2::default().hash_password(key.as_bytes(), &salt).unwrap().to_string();

        assert!(verify_key_against_hash(key, &hash));
        assert!(!verify_key_against_hash("CP-TEST-0000-0000-0000-0001", &hash));
        assert!(!verify_key_against_hash("", &hash));
        assert!(!is_founder_key("definitely not the real key"));
    }

    #[test]
    fn is_active_reads_a_real_db_not_just_the_in_memory_struct() {
        // Same real-temp-file-Db pattern as schedule.rs's own tests —
        // this is what schedule::tick() actually calls to decide whether
        // a scheduled Time Machine snapshot is allowed to run.
        let file = std::env::temp_dir()
            .join(format!("cp-premium-{:?}.db", std::thread::current().id()));
        let _ = std::fs::remove_file(&file);
        let db = Db::open(&file).unwrap();

        assert!(!is_active(&db), "a fresh install has no premium status at all");

        let mut status = read_status(&db);
        status.active = true;
        write_status(&db, &status).unwrap();
        assert!(is_active(&db));

        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn never_shows_once_active() {
        let mut s = base();
        s.active = true;
        assert!(!should_show_upsell(&s, 1_000_000_000, 0.0));
    }

    #[test]
    fn never_shows_after_dismissed_forever() {
        let mut s = base();
        s.upsell_dismissed_forever = true;
        assert!(!should_show_upsell(&s, 1_000_000_000, 0.0));
    }

    #[test]
    fn respects_the_minimum_gap_since_last_shown() {
        let mut s = base();
        s.upsell_last_shown = 1_000_000_000;
        let one_hour_later = 1_000_000_000 + 60 * 60 * 1000;
        assert!(!should_show_upsell(&s, one_hour_later, 0.0));

        let five_days_later = 1_000_000_000 + 5 * 24 * 60 * 60 * 1000;
        assert!(should_show_upsell(&s, five_days_later, 0.0));
    }

    #[test]
    fn is_gated_by_the_random_roll_not_just_the_timer() {
        let s = base(); // never shown before -> gate is open
        assert!(should_show_upsell(&s, 1_000_000_000, 0.0));
        assert!(!should_show_upsell(&s, 1_000_000_000, 0.99));
    }
}
