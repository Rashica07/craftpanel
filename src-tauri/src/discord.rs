//! Discord webhook notifications — server start/stop/crash, scheduled
//! backups. Fire-and-forget: a webhook post never blocks or fails the
//! action that triggered it, and a bad/missing URL is just silently a
//! no-op (checked once by the caller before spawning the post).

use serde_json::json;

/// POSTs a plain-text message to a Discord webhook URL. Real network call,
/// meant to be run on its own thread — callers should spawn this, not call
/// it inline on a hot path (server start/stop, scheduler tick).
pub fn post(webhook_url: &str, content: &str) -> Result<(), String> {
    ureq::post(webhook_url)
        .set("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(8))
        .send_json(json!({ "content": content }))
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Fires `post` on a background thread so the caller never blocks on
/// Discord's response time. Errors are swallowed on purpose — a failed
/// notification shouldn't surface as an app error to someone just trying
/// to start a server.
pub fn notify(webhook_url: &str, content: String) {
    let url = webhook_url.to_string();
    std::thread::spawn(move || {
        if let Err(e) = post(&url, &content) {
            eprintln!("discord webhook: {e}");
        }
    });
}
