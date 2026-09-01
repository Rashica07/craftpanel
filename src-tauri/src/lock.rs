//! A local PIN/password lock on the app window itself — not network auth,
//! not encryption of the servers on disk, just "don't let someone who
//! picks up this computer poke around your servers without a PIN."
//!
//! Stored in its own small file (`lock.json`, next to `r2.json` in the
//! app's config dir) rather than in the main SQLite database, specifically
//! so "I forgot my PIN" has an honest, low-cost recovery path: delete this
//! one file by hand, not the whole app database (which would also forget
//! every server CraftPanel knows about).
//!
//! Hashed with Argon2 (real salted KDF, not a bare SHA-256) — this is
//! genuinely a password, worth doing properly even though the threat model
//! here is "someone with your laptop open," not a network attacker.

use std::path::{Path, PathBuf};

use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use serde::{Deserialize, Serialize};

const MIN_LEN: usize = 4;

#[derive(Serialize, Deserialize)]
struct LockFile {
    hash: String,
}

pub struct Lock {
    path: PathBuf,
}

impl Lock {
    pub fn new(config_dir: &Path) -> Self {
        Self { path: config_dir.join("lock.json") }
    }

    pub fn is_set(&self) -> bool {
        self.path.is_file()
    }

    /// Set (or replace) the PIN. No "confirm old PIN" here — the caller
    /// (the Settings UI) only ever offers this once you're already past
    /// the lock screen, same as changing any other setting.
    pub fn set(&self, pin: &str) -> Result<(), String> {
        let pin = pin.trim();
        if pin.chars().count() < MIN_LEN {
            return Err(format!("Use at least {MIN_LEN} characters."));
        }
        let salt = SaltString::generate(&mut OsRng);
        let hash = Argon2::default()
            .hash_password(pin.as_bytes(), &salt)
            .map_err(|e| e.to_string())?
            .to_string();
        let json = serde_json::to_string(&LockFile { hash }).map_err(|e| e.to_string())?;
        std::fs::write(&self.path, json).map_err(|e| e.to_string())
    }

    pub fn check(&self, pin: &str) -> bool {
        let Ok(text) = std::fs::read_to_string(&self.path) else { return false };
        let Ok(lf) = serde_json::from_str::<LockFile>(&text) else { return false };
        let Ok(parsed) = PasswordHash::new(&lf.hash) else { return false };
        Argon2::default().verify_password(pin.as_bytes(), &parsed).is_ok()
    }

    /// Requires the current PIN — this removes the lock entirely, so it's
    /// not something a forgotten-PIN dialog should be able to trigger.
    pub fn clear(&self, current_pin: &str) -> Result<(), String> {
        if !self.check(current_pin) {
            return Err("That PIN isn't right.".into());
        }
        if self.path.is_file() {
            std::fs::remove_file(&self.path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_lock(tag: &str) -> Lock {
        let d = std::env::temp_dir().join(format!("cp-lock-{tag}-{:?}", std::thread::current().id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        Lock::new(&d)
    }

    #[test]
    fn not_set_until_a_pin_is_saved() {
        let l = temp_lock("unset");
        assert!(!l.is_set());
        l.set("1234").unwrap();
        assert!(l.is_set());
    }

    #[test]
    fn rejects_pins_shorter_than_minimum() {
        let l = temp_lock("short");
        assert!(l.set("12").is_err());
        assert!(!l.is_set(), "a rejected PIN shouldn't leave a lock file behind");
    }

    #[test]
    fn correct_pin_checks_true_wrong_pin_checks_false() {
        let l = temp_lock("check");
        l.set("hunter2").unwrap();
        assert!(l.check("hunter2"));
        assert!(!l.check("wrong"));
        assert!(!l.check(""));
    }

    #[test]
    fn checking_before_a_pin_exists_is_false_not_a_panic() {
        let l = temp_lock("nofile");
        assert!(!l.check("anything"));
    }

    #[test]
    fn clear_requires_the_right_pin() {
        let l = temp_lock("clear");
        l.set("correct-horse").unwrap();
        assert!(l.clear("wrong-guess").is_err());
        assert!(l.is_set(), "a failed clear must not remove the lock");
        assert!(l.clear("correct-horse").is_ok());
        assert!(!l.is_set());
    }

    #[test]
    fn hashes_are_salted_not_reused_across_pins() {
        // same PIN set twice on two different Locks should not produce the
        // same stored hash — proves a real per-hash salt is in play, not a
        // bare/deterministic digest.
        let a = temp_lock("salt-a");
        let b = temp_lock("salt-b");
        a.set("samepin").unwrap();
        b.set("samepin").unwrap();
        let ha = std::fs::read_to_string(a.path.clone()).unwrap();
        let hb = std::fs::read_to_string(b.path.clone()).unwrap();
        assert_ne!(ha, hb);
    }
}
