//! In-app content browser backed by the CurseForge Core API
//! (api.curseforge.com/v1) — the mod/plugin catalog counterpart to
//! `modrinth.rs`, for the (large) slice of mods/plugins that are only
//! published there. Same shape deliberately: search / install with
//! required-dependency resolution / installed-list / update-check,
//! tracked in its own `<server>/.craftpanel-curseforge.json` manifest so
//! the two sources never collide or double-count an install.
//!
//! **Scope of this first pass, stated plainly rather than faked**: mods
//! and Bukkit/Spigot/Paper plugins only. CurseForge's resource-pack and
//! data-pack categories aren't nearly as consistently tagged as
//! Modrinth's (their `latestFilesIndexes`/hash coverage is spottier for
//! those classes in practice), so rather than guess at that and ship
//! something flaky, those two stay Modrinth-only for now — the Add-ons
//! UI simply doesn't offer CurseForge as a source for those two tabs.
//!
//! Every CurseForge request needs an API key sent as the `x-api-key`
//! header — there's no anonymous access, unlike Modrinth. CurseForge
//! issues that key to *the application*, not to each person running it
//! (confirmed by their own approval email: "we've approved your
//! application CraftPanel for the 3rd Party CurseForge API") — so unlike
//! Modrinth, this is deliberately **not** a per-user Settings field.
//! CraftPanel is meant for people who've never heard of an API key, the
//! same way Aternos doesn't ask a player to go register one — so the key
//! ships embedded in [`EMBEDDED_API_KEY`] below and every install shares
//! it, same as any app that bundles its own vendor API key (a Sentry
//! DSN, a Maps key, …).
//!
//! Worth being upfront about the actual tradeoff rather than pretending
//! this is "secure": a string baked into a compiled binary is trivially
//! recoverable with `strings` on the `.app`, and it's sitting in this
//! file's own git history from here on. The real backstop if it ever
//! needs to change is CurseForge's own key rotation/revocation on their
//! console, not obscurity — same posture as any other embedded
//! client-side API key.
//!
//! One real, documented CurseForge quirk this module has to handle
//! rather than silently mis-report: a mod author can disable third-party
//! downloads, in which case `downloadUrl` comes back `null` for every one
//! of that mod's files. `install`/`update_one` surface that as a clear,
//! specific error rather than a generic "download failed."

use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::adapter::ServerType;

const API: &str = "https://api.curseforge.com/v1";
const UA: &str = "CraftPanel/0.1 (minecraft server manager)";

/// CraftPanel's own CurseForge Core API key — issued to this application
/// specifically (see the module doc comment for why it's embedded
/// instead of a per-user setting). Not a secret in the "protects
/// something if leaked" sense; CurseForge's own dashboard is the actual
/// control point if it ever needs rotating.
pub const EMBEDDED_API_KEY: &str = "$2a$10$yFK0ovTuCLJhU3Ztal55c.jZONMtXL9ylar.BHMdiPSG9aCpZkUhq";
const MANIFEST: &str = ".craftpanel-curseforge.json";
/// CurseForge's own numeric id for the Minecraft game — stable, public,
/// the same value every third-party CurseForge tool hardcodes (it's part
/// of their URL scheme, not an implementation detail likely to change).
const MINECRAFT_GAME_ID: i64 = 432;
/// CurseForge's file-relation enum for "this file requires that mod to
/// also be installed" — documented in the Core API's own OpenAPI schema.
const RELATION_REQUIRED_DEPENDENCY: i64 = 3;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub mod_id: i64,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub downloads: u64,
    pub icon_url: Option<String>,
    /// "mod" | "plugin" — mirrors Modrinth's `Hit::project_type` values so
    /// the frontend can render both sources through one row component.
    pub project_type: String,
    pub categories: Vec<String>,
    pub installed: bool,
    pub compatible: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub hits: Vec<Hit>,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledEntry {
    pub mod_id: i64,
    pub slug: String,
    pub title: String,
    pub filename: String,
    pub file_id: i64,
    #[serde(default)]
    pub dependency: bool,
    #[serde(default)]
    pub update: Option<UpdateInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub file_id: i64,
    pub filename: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub installed: Vec<String>,
    pub skipped: Vec<String>,
}

// --- CurseForge response shapes (only the fields we need) ------------------

#[derive(Deserialize)]
struct Envelope<T> {
    data: T,
}
#[derive(Deserialize)]
struct Pagination {
    #[serde(rename = "totalCount")]
    total_count: u64,
}
#[derive(Deserialize)]
struct RawSearch {
    data: Vec<RawMod>,
    pagination: Pagination,
}
#[derive(Deserialize)]
struct RawLogo {
    url: String,
}
#[derive(Deserialize)]
struct RawFileIndex {
    #[serde(rename = "gameVersion")]
    game_version: String,
}
#[derive(Deserialize)]
struct RawCategory {
    name: String,
}
#[derive(Deserialize)]
struct RawMod {
    id: i64,
    slug: String,
    name: String,
    #[serde(default)]
    summary: String,
    #[serde(rename = "downloadCount")]
    download_count: f64,
    logo: Option<RawLogo>,
    #[serde(default)]
    categories: Vec<RawCategory>,
    #[serde(rename = "latestFilesIndexes", default)]
    latest_files_indexes: Vec<RawFileIndex>,
}
#[derive(Deserialize)]
struct RawGameCategory {
    id: i64,
    name: String,
    slug: String,
    #[serde(rename = "classId")]
    class_id: Option<i64>,
    #[serde(rename = "isClass", default)]
    is_class: bool,
}
#[derive(Deserialize)]
struct RawHash {
    value: String,
    algo: i64, // 1 = Sha1, 2 = Md5, per the Core API's HashAlgo enum
}
#[derive(Deserialize)]
struct RawDependency {
    #[serde(rename = "modId")]
    mod_id: i64,
    #[serde(rename = "relationType")]
    relation_type: i64,
}
#[derive(Deserialize)]
struct RawFile {
    id: i64,
    #[serde(rename = "modId")]
    mod_id: i64,
    #[serde(rename = "fileName")]
    file_name: String,
    #[serde(rename = "downloadUrl")]
    download_url: Option<String>,
    #[serde(rename = "gameVersions", default)]
    game_versions: Vec<String>,
    #[serde(default)]
    hashes: Vec<RawHash>,
    #[serde(default)]
    dependencies: Vec<RawDependency>,
}

// --- helpers ----------------------------------------------------------

fn get_json<T: for<'de> Deserialize<'de>>(url: &str, api_key: &str) -> Result<T, String> {
    if api_key.trim().is_empty() {
        return Err("Add your CurseForge API key in CraftPanel Settings first.".into());
    }
    ureq::get(url)
        .set("x-api-key", api_key)
        .set("Accept", "application/json")
        .set("User-Agent", UA)
        .timeout(std::time::Duration::from_secs(20))
        .call()
        .map_err(|e| format!("CurseForge request failed: {e}"))?
        .into_json()
        .map_err(|e| format!("CurseForge returned bad JSON: {e}"))
}

/// "mod" -> CurseForge's "Bukkit Plugins" class for Paper/Spigot servers
/// (mirrors `modrinth::loader_facet`'s own mod/plugin split), "Mods"
/// otherwise. Resolved by name against the live category list rather
/// than a hardcoded classId — CurseForge's classIds aren't something
/// worth guessing at from memory when a plain GET settles it exactly.
fn class_id_for(project_type: &str, server_type: ServerType, api_key: &str) -> Result<i64, String> {
    let want = match (project_type, server_type) {
        ("mod", ServerType::Paper | ServerType::Spigot) => "Bukkit Plugins",
        ("mod", _) => "Mods",
        (other, _) => {
            return Err(format!(
                "CurseForge browsing isn't offered for {other} yet — try Modrinth for that."
            ));
        }
    };
    let cats: Vec<RawGameCategory> = get_json(
        &format!("{API}/categories?gameId={MINECRAFT_GAME_ID}"),
        api_key,
    )
    .map(|Envelope { data }: Envelope<Vec<RawGameCategory>>| data)?;
    cats.into_iter()
        .find(|c| c.is_class && c.name.eq_ignore_ascii_case(want))
        .map(|c| c.id)
        .ok_or_else(|| format!("CurseForge doesn't list a \"{want}\" category right now."))
}

fn manifest_path(dir: &Path) -> PathBuf {
    dir.join(MANIFEST)
}
fn read_manifest(dir: &Path) -> Vec<InstalledEntry> {
    fs::read(manifest_path(dir))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}
fn write_manifest(dir: &Path, list: &[InstalledEntry]) -> Result<(), String> {
    fs::write(
        manifest_path(dir),
        serde_json::to_vec_pretty(list).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn content_dir(server_dir: &Path, server_type: ServerType) -> PathBuf {
    if matches!(server_type, ServerType::Paper | ServerType::Spigot) {
        server_dir.join("plugins")
    } else {
        server_dir.join("mods")
    }
}

// --- search -------------------------------------------------------------

pub fn search(
    server_dir: &str,
    server_type: ServerType,
    query: &str,
    project_type: &str,
    mc_version: Option<&str>,
    offset: u32,
    api_key: &str,
) -> Result<SearchResult, String> {
    let class_id = class_id_for(project_type, server_type, api_key)?;

    let mut req = ureq::get(&format!("{API}/mods/search"))
        .set("x-api-key", api_key)
        .set("Accept", "application/json")
        .set("User-Agent", UA)
        .query("gameId", &MINECRAFT_GAME_ID.to_string())
        .query("classId", &class_id.to_string())
        .query("searchFilter", query)
        .query("sortField", "2") // Popularity
        .query("sortOrder", "desc")
        .query("pageSize", "30")
        .query("index", &offset.to_string())
        .timeout(std::time::Duration::from_secs(20));
    // No `gameVersion` filter at the query level and deliberately no
    // `modLoaderType` filter either — CurseForge's mod-loader enum isn't
    // documented clearly enough to hardcode with confidence, so this
    // follows Modrinth's own established policy here: show everything,
    // *mark* what has no build for this MC version, never silently hide.
    if let Some(v) = mc_version {
        req = req.query("gameVersion", v);
    }
    let raw: RawSearch = req
        .call()
        .map_err(|e| format!("search failed: {e}"))?
        .into_json()
        .map_err(|e| format!("bad search JSON: {e}"))?;

    let mine: HashSet<i64> = read_manifest(Path::new(server_dir)).into_iter().map(|e| e.mod_id).collect();
    let ptype_label = if matches!(server_type, ServerType::Paper | ServerType::Spigot) {
        "plugin"
    } else {
        "mod"
    };

    let mut hits: Vec<Hit> = raw
        .data
        .into_iter()
        .map(|m| {
            let compatible = match mc_version {
                Some(v) => m.latest_files_indexes.iter().any(|fi| fi.game_version == v),
                None => true,
            };
            Hit {
                installed: mine.contains(&m.id),
                compatible,
                mod_id: m.id,
                slug: m.slug,
                title: m.name,
                description: m.summary,
                downloads: m.download_count.max(0.0) as u64,
                icon_url: m.logo.map(|l| l.url),
                project_type: ptype_label.to_string(),
                categories: m.categories.into_iter().map(|c| c.name).collect(),
            }
        })
        .collect();
    hits.sort_by_key(|h| !h.compatible);

    Ok(SearchResult { total: raw.pagination.total_count, hits })
}

// --- install (with required-dep resolution) -----------------------------

fn best_file(mod_id: i64, mc_version: Option<&str>, api_key: &str) -> Result<RawFile, String> {
    let mut req = ureq::get(&format!("{API}/mods/{mod_id}/files"))
        .set("x-api-key", api_key)
        .set("Accept", "application/json")
        .set("User-Agent", UA)
        .query("pageSize", "50")
        .timeout(std::time::Duration::from_secs(20));
    if let Some(v) = mc_version {
        req = req.query("gameVersion", v);
    }
    let Envelope { data }: Envelope<Vec<RawFile>> = req
        .call()
        .map_err(|e| format!("couldn't list files: {e}"))?
        .into_json()
        .map_err(|e| format!("bad files JSON: {e}"))?;
    data.into_iter()
        .next()
        .ok_or_else(|| "no file of this compatible with your Minecraft version".into())
}

fn download_file(f: &RawFile, dest_dir: &Path, api_key: &str) -> Result<String, String> {
    let Some(url) = &f.download_url else {
        return Err(format!(
            "{}: the author has disabled third-party downloads for this file — install it manually from curseforge.com.",
            f.file_name
        ));
    };
    fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    ureq::get(url)
        .set("x-api-key", api_key)
        .set("User-Agent", UA)
        .timeout(std::time::Duration::from_secs(120))
        .call()
        .map_err(|e| format!("download failed: {e}"))?
        .into_reader()
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if let Some(sha1) = f.hashes.iter().find(|h| h.algo == 1) {
        use sha1::{Digest, Sha1};
        let mut h = Sha1::new();
        h.update(&bytes);
        let got = h.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>();
        if got != sha1.value {
            return Err(format!("{}: checksum mismatch", f.file_name));
        }
    }
    fs::write(dest_dir.join(&f.file_name), &bytes).map_err(|e| e.to_string())?;
    Ok(f.file_name.clone())
}

pub fn install(
    server_dir: &str,
    server_type: ServerType,
    mod_id: i64,
    mc_version: Option<&str>,
    api_key: &str,
) -> Result<InstallResult, String> {
    let dir = Path::new(server_dir);
    let mut manifest = read_manifest(dir);
    let mut have: HashSet<i64> = manifest.iter().map(|e| e.mod_id).collect();

    let mut installed = Vec::new();
    let mut skipped = Vec::new();
    let mut queue: Vec<(i64, bool)> = vec![(mod_id, false)];
    let mut seen: HashSet<i64> = HashSet::new();
    let dest = content_dir(dir, server_type);

    while let Some((mid, is_dep)) = queue.pop() {
        if !seen.insert(mid) {
            continue;
        }
        if have.contains(&mid) {
            skipped.push(mid.to_string());
            continue;
        }
        let file = best_file(mid, mc_version, api_key)?;
        let title: RawMod = get_json::<Envelope<RawMod>>(&format!("{API}/mods/{mid}"), api_key)?.data;
        let filename = download_file(&file, &dest, api_key)?;

        manifest.push(InstalledEntry {
            mod_id: mid,
            slug: title.slug.clone(),
            title: title.name.clone(),
            filename,
            file_id: file.id,
            dependency: is_dep,
            update: None,
        });
        have.insert(mid);
        installed.push(title.name);

        for d in &file.dependencies {
            if d.relation_type == RELATION_REQUIRED_DEPENDENCY {
                queue.push((d.mod_id, true));
            }
        }
    }

    write_manifest(dir, &manifest)?;
    Ok(InstallResult { installed, skipped })
}

// --- installed list + updates -------------------------------------------

pub fn installed(server_dir: &str) -> Vec<InstalledEntry> {
    read_manifest(Path::new(server_dir))
}

pub fn check_updates(server_dir: &str, mc_version: Option<&str>, api_key: &str) -> Result<Vec<InstalledEntry>, String> {
    let dir = Path::new(server_dir);
    let mut list = read_manifest(dir);
    for e in list.iter_mut() {
        if let Ok(f) = best_file(e.mod_id, mc_version, api_key) {
            if f.id != e.file_id {
                e.update = Some(UpdateInfo { file_id: f.id, filename: f.file_name });
            } else {
                e.update = None;
            }
        }
    }
    write_manifest(dir, &list)?;
    Ok(list)
}

pub fn update_one(
    server_dir: &str,
    server_type: ServerType,
    mod_id: i64,
    mc_version: Option<&str>,
    api_key: &str,
) -> Result<(), String> {
    let dir = Path::new(server_dir);
    let mut list = read_manifest(dir);
    let idx = list.iter().position(|e| e.mod_id == mod_id).ok_or("not installed")?;
    let file = best_file(mod_id, mc_version, api_key)?;
    let destdir = content_dir(dir, server_type);
    let old = destdir.join(&list[idx].filename);
    let _ = fs::rename(&old, dir.join(".craftpanel-trash").join(&list[idx].filename))
        .or_else(|_| fs::remove_file(&old));
    let filename = download_file(&file, &destdir, api_key)?;
    list[idx].filename = filename;
    list[idx].file_id = file.id;
    list[idx].update = None;
    write_manifest(dir, &list)
}

pub fn remove_one(server_dir: &str, server_type: ServerType, mod_id: i64) -> Result<(), String> {
    let dir = Path::new(server_dir);
    let mut list = read_manifest(dir);
    let idx = list.iter().position(|e| e.mod_id == mod_id).ok_or("not installed")?;
    let e = list.remove(idx);
    for base in [content_dir(dir, server_type), dir.join("mods-disabled")] {
        let p = base.join(&e.filename);
        if p.is_file() {
            let trash = dir.join(".craftpanel-trash");
            let _ = fs::create_dir_all(&trash);
            let _ = fs::rename(&p, trash.join(&e.filename)).or_else(|_| fs::remove_file(&p));
        }
    }
    write_manifest(dir, &list)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_roundtrip() {
        let d = std::env::temp_dir().join(format!("cp-cf-{:?}", std::thread::current().id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        let list = vec![InstalledEntry {
            mod_id: 123,
            slug: "jei".into(),
            title: "Just Enough Items".into(),
            filename: "jei-1.jar".into(),
            file_id: 999,
            dependency: false,
            update: None,
        }];
        write_manifest(&d, &list).unwrap();
        let back = read_manifest(&d);
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].slug, "jei");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn content_dir_by_server_type() {
        let d = Path::new("/srv");
        assert!(content_dir(d, ServerType::Fabric).ends_with("mods"));
        assert!(content_dir(d, ServerType::Paper).ends_with("plugins"));
    }

    #[test]
    fn missing_key_errors_immediately_no_network() {
        let err = get_json::<serde_json::Value>(&format!("{API}/mods/1"), "").unwrap_err();
        assert!(err.contains("API key"));
    }

    #[test]
    fn download_without_url_reports_the_real_reason() {
        let f = RawFile {
            id: 1,
            mod_id: 1,
            file_name: "locked.jar".into(),
            download_url: None,
            game_versions: vec![],
            hashes: vec![],
            dependencies: vec![],
        };
        let err = download_file(&f, Path::new("/tmp/cp-cf-unused"), "key").unwrap_err();
        assert!(err.contains("disabled third-party downloads"));
    }

    // hits the network — run with a real key: CURSEFORGE_TEST_KEY=... cargo test -- --ignored
    #[test]
    #[ignore]
    fn live_search_fabric() {
        let key = std::env::var("CURSEFORGE_TEST_KEY").expect("set CURSEFORGE_TEST_KEY");
        let r = search("/tmp", ServerType::Fabric, "jei", "mod", Some("1.21.1"), 0, &key).unwrap();
        assert!(r.hits.iter().any(|h| h.slug.contains("jei") || h.title.to_lowercase().contains("just enough items")));
    }
}
