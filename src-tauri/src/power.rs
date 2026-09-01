//! Keeps the Mac from sleeping while it's on AC power — the same
//! `caffeinate -s` trick `process.rs`'s per-server keep-awake already uses
//! (`-s` is specifically "prevent system sleep, but only while on AC
//! power" per `man caffeinate` — a laptop on battery still sleeps
//! normally, no extra logic needed to respect that).
//!
//! This one isn't tied to any single server's lifetime (`process.rs`'s
//! version dies with `-w <pid>` when that server stops) — it's what makes
//! a *scheduled start* on a server that isn't running yet actually able to
//! fire: without this, the Mac could be asleep at the scheduled time with
//! nothing there to wake it and run the check.

use std::process::Child;
use std::sync::Mutex;

pub struct PowerKeeper {
    child: Mutex<Option<Child>>,
}

impl PowerKeeper {
    pub fn new() -> Self {
        Self { child: Mutex::new(None) }
    }

    pub fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        let mut slot = self.child.lock().unwrap();
        if enabled {
            if slot.is_some() {
                return Ok(()); // already running
            }
            #[cfg(target_os = "macos")]
            {
                let child = std::process::Command::new("caffeinate")
                    .args(["-i", "-s"])
                    .spawn()
                    .map_err(|e| e.to_string())?;
                *slot = Some(child);
            }
            #[cfg(not(target_os = "macos"))]
            {
                return Err("Staying awake on power is only implemented on macOS so far.".into());
            }
        } else if let Some(mut child) = slot.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        Ok(())
    }
}

impl Drop for PowerKeeper {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
}
