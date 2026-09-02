//! Server resource pack — a URL + SHA-1 pushed to every joining client via
//! `server.properties` (`resource-pack` / `resource-pack-sha1` /
//! `resource-pack-prompt` / `require-resource-pack`).
//!
//! CraftPanel doesn't host the pack itself — nothing here turns this
//! machine into a public file server. You host the `.zip` somewhere
//! reachable (Dropbox, GitHub, any static host) and paste the direct link;
//! CraftPanel downloads it once, purely to compute the SHA-1 the client
//! needs to verify the download, and never stores the bytes.
//!
//! Java-edition only — Bedrock's resource packs are a completely different,
//! folder-based system (`resource_packs/` next to the world), not a URL —
//! the frontend hides this section entirely for Bedrock servers.

use std::io::Read;
use std::path::Path;

use serde::Serialize;
use sha1::{Digest, Sha1};

use crate::properties::Properties;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourcePackConfig {
    pub url: String,
    pub sha1: String,
    pub prompt: String,
    pub required: bool,
}

pub fn read(dir: &Path) -> ResourcePackConfig {
    let props = Properties::load(dir);
    ResourcePackConfig {
        url: props.get_or("resource-pack", ""),
        sha1: props.get_or("resource-pack-sha1", ""),
        prompt: props.get_or("resource-pack-prompt", ""),
        required: props.get_or("require-resource-pack", "false") == "true",
    }
}

/// Downloads the pack once just to hash it, then writes all four
/// properties in one line-preserving pass. `url` must be a direct,
/// publicly-reachable link to the `.zip` — not a webpage that links to one.
pub fn set_from_url(
    dir: &Path,
    url: &str,
    prompt: &str,
    required: bool,
) -> Result<ResourcePackConfig, String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("Paste a resource pack URL first.".into());
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("That doesn't look like a URL — it should start with http:// or https://".into());
    }

    let mut bytes = Vec::new();
    ureq::get(url)
        .set("User-Agent", "CraftPanel")
        .timeout(std::time::Duration::from_secs(60))
        .call()
        .map_err(|e| format!("Couldn't download that URL: {e}"))?
        .into_reader()
        .take(200 * 1024 * 1024) // 200 MB sanity cap — a resource pack this big is almost certainly a mistake
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;

    // a real zip starts "PK" (local file header signature) — catches the
    // common mistake of pasting a webpage's URL instead of the file's
    if bytes.len() < 4 || &bytes[0..2] != b"PK" {
        return Err("That doesn't look like a .zip file — resource packs need to be zipped, and the link needs to point straight at the file.".into());
    }

    let mut h = Sha1::new();
    h.update(&bytes);
    let sha1 = h.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>();

    write(dir, url, &sha1, prompt, required)
}

/// Same as `set_from_url`, but for a source that already published its own
/// SHA-1 (Modrinth's version API does, for every file) — skips downloading
/// the whole zip a second time just to re-hash it.
pub fn set_known(
    dir: &Path,
    url: &str,
    sha1: &str,
    prompt: &str,
    required: bool,
) -> Result<ResourcePackConfig, String> {
    write(dir, url, sha1, prompt, required)
}

fn write(
    dir: &Path,
    url: &str,
    sha1: &str,
    prompt: &str,
    required: bool,
) -> Result<ResourcePackConfig, String> {
    let mut props = Properties::load(dir);
    props.set("resource-pack", url);
    props.set("resource-pack-sha1", sha1);
    props.set("resource-pack-prompt", prompt);
    props.set("require-resource-pack", if required { "true" } else { "false" });
    props.save().map_err(|e| e.to_string())?;

    Ok(ResourcePackConfig {
        url: url.to_string(),
        sha1: sha1.to_string(),
        prompt: prompt.to_string(),
        required,
    })
}

pub fn clear(dir: &Path) -> Result<(), String> {
    let mut props = Properties::load(dir);
    props.set("resource-pack", "");
    props.set("resource-pack-sha1", "");
    props.set("resource-pack-prompt", "");
    props.set("require-resource-pack", "false");
    props.save().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn server(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("cp-rp-{tag}-{:?}", std::thread::current().id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("server.properties"), "level-name=world\nmotd=hi\n").unwrap();
        d
    }

    #[test]
    fn read_defaults_when_nothing_set() {
        let d = server("defaults");
        let c = read(&d);
        assert_eq!(c.url, "");
        assert!(!c.required);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn rejects_empty_and_non_url_input() {
        let d = server("reject");
        assert!(set_from_url(&d, "", "", false).is_err());
        assert!(set_from_url(&d, "not-a-url", "", false).is_err());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn clear_resets_all_four_properties_and_preserves_the_rest() {
        let d = server("clear");
        let mut props = Properties::load(&d);
        props.set("resource-pack", "https://example.com/pack.zip");
        props.set("resource-pack-sha1", "deadbeef");
        props.set("require-resource-pack", "true");
        props.save().unwrap();

        clear(&d).unwrap();
        let c = read(&d);
        assert_eq!(c.url, "");
        assert_eq!(c.sha1, "");
        assert!(!c.required);
        // untouched
        assert_eq!(Properties::load(&d).get_or("motd", ""), "hi");
        let _ = fs::remove_dir_all(&d);
    }

    /// End-to-end against a real, small, real zip URL — confirms the
    /// download + zip-signature + SHA-1 path actually works, not just the
    /// property-writing plumbing around it.
    /// `cargo test real_zip_hashes_correctly -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_zip_hashes_correctly() {
        let d = server("real");
        // a tiny, stable, public .zip — GitHub's own codeload for an empty-ish repo
        let c = set_from_url(
            &d,
            "https://github.com/octocat/Hello-World/archive/refs/heads/master.zip",
            "Optional pack",
            true,
        )
        .unwrap();
        assert_eq!(c.sha1.len(), 40);
        assert!(c.required);
        let saved = read(&d);
        assert_eq!(saved.sha1, c.sha1);
        let _ = fs::remove_dir_all(&d);
    }
}
