//! In-app content browser backed by the Modrinth API (api.modrinth.com/v2).
//! Search mods / plugins / datapacks, install with required-dependency
//! resolution, and flag updates. Installs are tracked in
//! `<server>/.craftpanel-modrinth.json` so we can update/remove cleanly.

use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};

use crate::adapter::ServerType;

const API: &str = "https://api.modrinth.com/v2";
const UA: &str = "CraftPanel/0.1 (minecraft server manager)";
const MANIFEST: &str = ".craftpanel-modrinth.json";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub project_id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub downloads: u64,
    pub icon_url: Option<String>,
    pub project_type: String,
    pub categories: Vec<String>,
    /// already installed by us
    pub installed: bool,
    /// has a build for this server's Minecraft version
    pub compatible: bool,
    /// "required" | "optional" | "unsupported" | "unknown"
    pub server_side: String,
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
    pub project_id: String,
    pub slug: String,
    pub title: String,
    pub filename: String,
    pub version_id: String,
    pub version_number: String,
    /// installed as a dependency of another mod
    #[serde(default)]
    pub dependency: bool,
    #[serde(default)]
    pub update: Option<UpdateInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version_id: String,
    pub version_number: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub installed: Vec<String>,
    pub skipped: Vec<String>,
}

// --- Modrinth response shapes (only the fields we need) ---------------------

#[derive(Deserialize)]
struct RawSearch {
    hits: Vec<RawHit>,
    total_hits: u64,
}
#[derive(Deserialize)]
struct RawHit {
    project_id: String,
    slug: String,
    title: String,
    description: String,
    downloads: u64,
    icon_url: Option<String>,
    project_type: String,
    #[serde(default)]
    categories: Vec<String>,
    /// all game versions any release of this project supports
    #[serde(default)]
    versions: Vec<String>,
    #[serde(default)]
    server_side: Option<String>,
}
#[derive(Deserialize)]
struct RawVersion {
    id: String,
    version_number: String,
    files: Vec<RawFile>,
    #[serde(default)]
    dependencies: Vec<RawDep>,
}
#[derive(Deserialize)]
struct RawFile {
    url: String,
    filename: String,
    #[serde(default)]
    primary: bool,
    hashes: RawHashes,
}
#[derive(Deserialize)]
struct RawHashes {
    sha1: Option<String>,
}
#[derive(Deserialize)]
struct RawDep {
    project_id: Option<String>,
    version_id: Option<String>,
    dependency_type: String,
}
#[derive(Deserialize)]
struct RawProject {
    id: String,
    slug: String,
    title: String,
}

// --- helpers --------------------------------------------------------------

fn get_json<T: for<'de> Deserialize<'de>>(url: &str) -> Result<T, String> {
    ureq::get(url)
        .set("User-Agent", UA)
        .timeout(std::time::Duration::from_secs(20))
        .call()
        .map_err(|e| format!("Modrinth request failed: {e}"))?
        .into_json()
        .map_err(|e| format!("Modrinth returned bad JSON: {e}"))
}

/// "mod" / "plugin" (=modrinth "mod" + a paper/spigot loader), "datapack".
pub fn loader_facet(t: ServerType) -> &'static str {
    match t {
        ServerType::Fabric => "fabric",
        ServerType::Forge => "forge",
        ServerType::Paper => "paper",
        ServerType::Spigot => "spigot",
        ServerType::Vanilla => "datapack",
    }
}

fn content_dir(server_dir: &Path, server_type: ServerType, project_type: &str) -> PathBuf {
    if project_type == "datapack" {
        let level = crate::properties::Properties::load(server_dir)
            .get_or("level-name", "world");
        server_dir.join(level).join("datapacks")
    } else if matches!(server_type, ServerType::Paper | ServerType::Spigot) {
        server_dir.join("plugins")
    } else {
        server_dir.join("mods")
    }
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

// --- search --------------------------------------------------------------

pub fn search(
    server_dir: &str,
    server_type: ServerType,
    query: &str,
    project_type: &str,
    mc_version: Option<&str>,
    offset: u32,
) -> Result<SearchResult, String> {
    let lf = loader_facet(server_type);
    let mut facets: Vec<String> = vec![format!("[\"project_type:{project_type}\"]")];
    if project_type != "datapack" {
        facets.push(format!("[\"categories:{lf}\"]"));
        // server-usable only — drop client-only mods (minimaps, Iris, …)
        facets.push("[\"server_side:required\",\"server_side:optional\"]".to_string());
    }
    // NB: no `versions:` facet — we show everything and *mark* what has no build
    // for this server's MC version, so nothing silently disappears.
    let facets = format!("[{}]", facets.join(","));

    let raw: RawSearch = ureq::get(&format!("{API}/search"))
        .set("User-Agent", UA)
        .query("query", query)
        .query("facets", &facets)
        .query("limit", "30")
        .query("offset", &offset.to_string())
        .query("index", if query.is_empty() { "downloads" } else { "relevance" })
        .timeout(std::time::Duration::from_secs(20))
        .call()
        .map_err(|e| format!("search failed: {e}"))?
        .into_json()
        .map_err(|e| format!("bad search JSON: {e}"))?;

    let mine: HashSet<String> = read_manifest(Path::new(server_dir))
        .into_iter()
        .map(|e| e.project_id)
        .collect();

    let mut hits: Vec<Hit> = raw
        .hits
        .into_iter()
        .map(|h| {
            let compatible = match mc_version {
                Some(v) => h.versions.iter().any(|x| x == v),
                None => true,
            };
            Hit {
                installed: mine.contains(&h.project_id),
                compatible,
                server_side: h.server_side.unwrap_or_else(|| "unknown".into()),
                project_id: h.project_id,
                slug: h.slug,
                title: h.title,
                description: h.description,
                downloads: h.downloads,
                icon_url: h.icon_url,
                project_type: h.project_type,
                categories: h.categories,
            }
        })
        .collect();
    // compatible first, keeping relevance order within each group
    hits.sort_by_key(|h| !h.compatible);

    Ok(SearchResult { total: raw.total_hits, hits })
}

// --- install (with required-dep resolution) -----------------------------

fn best_version(
    project: &str,
    loader: &str,
    mc_version: Option<&str>,
    project_type: &str,
) -> Result<RawVersion, String> {
    let mut url = format!("{API}/project/{project}/version");
    // datapacks have loader "datapack"; mods/plugins use the real loader
    let loaders = if project_type == "datapack" { "datapack" } else { loader };
    url.push_str(&format!("?loaders=[\"{loaders}\"]"));
    if let Some(v) = mc_version {
        url.push_str(&format!("&game_versions=[\"{v}\"]"));
    }
    let versions: Vec<RawVersion> = get_json(&url)?;
    versions
        .into_iter()
        .next()
        .ok_or_else(|| "no version of this compatible with your loader + Minecraft version".into())
}

fn download_file(f: &RawFile, dest_dir: &Path) -> Result<String, String> {
    fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    ureq::get(&f.url)
        .set("User-Agent", UA)
        .timeout(std::time::Duration::from_secs(120))
        .call()
        .map_err(|e| format!("download failed: {e}"))?
        .into_reader()
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if let Some(want) = &f.hashes.sha1 {
        let mut h = Sha1::new();
        h.update(&bytes);
        let got = h.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>();
        if &got != want {
            return Err(format!("{}: checksum mismatch", f.filename));
        }
    }
    fs::write(dest_dir.join(&f.filename), &bytes).map_err(|e| e.to_string())?;
    Ok(f.filename.clone())
}

fn primary_file(v: &RawVersion) -> Option<&RawFile> {
    v.files.iter().find(|f| f.primary).or_else(|| v.files.first())
}

pub fn install(
    server_dir: &str,
    server_type: ServerType,
    project_id: &str,
    project_type: &str,
    mc_version: Option<&str>,
) -> Result<InstallResult, String> {
    let dir = Path::new(server_dir);
    let loader = loader_facet(server_type);
    let mut manifest = read_manifest(dir);
    let mut have: HashSet<String> = manifest.iter().map(|e| e.project_id.clone()).collect();

    let mut installed = Vec::new();
    let mut skipped = Vec::new();
    let mut queue: Vec<(String, bool)> = vec![(project_id.to_string(), false)];
    let mut seen: HashSet<String> = HashSet::new();

    while let Some((pid, is_dep)) = queue.pop() {
        if !seen.insert(pid.clone()) {
            continue;
        }
        if have.contains(&pid) {
            skipped.push(pid.clone());
            continue;
        }
        let proj: RawProject = get_json(&format!("{API}/project/{pid}"))?;
        let ptype = if is_dep {
            // resolve dependency's own type via its version below; assume mod
            "mod"
        } else {
            project_type
        };
        let ver = best_version(&pid, loader, mc_version, ptype)
            .map_err(|e| format!("{}: {e}", proj.title))?;
        let file = primary_file(&ver)
            .ok_or_else(|| format!("{}: version has no file", proj.title))?;
        let dest = content_dir(dir, server_type, ptype);
        let filename = download_file(file, &dest)?;

        manifest.push(InstalledEntry {
            project_id: proj.id.clone(),
            slug: proj.slug.clone(),
            title: proj.title.clone(),
            filename,
            version_id: ver.id.clone(),
            version_number: ver.version_number.clone(),
            dependency: is_dep,
            update: None,
        });
        have.insert(proj.id.clone());
        installed.push(proj.title.clone());

        for d in &ver.dependencies {
            if d.dependency_type == "required" {
                if let Some(dp) = &d.project_id {
                    queue.push((dp.clone(), true));
                } else if let Some(vid) = &d.version_id {
                    if let Ok(v) = get_json::<RawVersion>(&format!("{API}/version/{vid}")) {
                        // fetch the parent project id via a project lookup is skipped;
                        // just install this exact version's file
                        if let Some(f) = primary_file(&v) {
                            let _ = download_file(f, &content_dir(dir, server_type, "mod"));
                        }
                    }
                }
            }
        }
    }

    write_manifest(dir, &manifest)?;
    Ok(InstallResult { installed, skipped })
}

// --- installed list + updates -----------------------------------------

pub fn installed(server_dir: &str) -> Vec<InstalledEntry> {
    read_manifest(Path::new(server_dir))
}

pub fn check_updates(
    server_dir: &str,
    server_type: ServerType,
    mc_version: Option<&str>,
) -> Result<Vec<InstalledEntry>, String> {
    let dir = Path::new(server_dir);
    let loader = loader_facet(server_type);
    let mut list = read_manifest(dir);
    for e in list.iter_mut() {
        let ptype = if e.filename.contains("datapack") { "datapack" } else { "mod" };
        if let Ok(v) = best_version(&e.project_id, loader, mc_version, ptype) {
            if v.id != e.version_id {
                e.update = Some(UpdateInfo {
                    version_id: v.id,
                    version_number: v.version_number,
                });
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
    project_id: &str,
    mc_version: Option<&str>,
) -> Result<(), String> {
    let dir = Path::new(server_dir);
    let loader = loader_facet(server_type);
    let mut list = read_manifest(dir);
    let idx = list
        .iter()
        .position(|e| e.project_id == project_id)
        .ok_or("not installed")?;
    let ptype = if list[idx].filename.contains("datapack") { "datapack" } else { "mod" };
    let ver = best_version(project_id, loader, mc_version, ptype)?;
    let file = primary_file(&ver).ok_or("no file")?;
    let destdir = content_dir(dir, server_type, ptype);
    // remove the old file
    let old = destdir.join(&list[idx].filename);
    let _ = fs::rename(&old, dir.join(".craftpanel-trash").join(&list[idx].filename))
        .or_else(|_| fs::remove_file(&old));
    let filename = download_file(file, &destdir)?;
    list[idx].filename = filename;
    list[idx].version_id = ver.id;
    list[idx].version_number = ver.version_number;
    list[idx].update = None;
    write_manifest(dir, &list)
}

pub fn remove_one(
    server_dir: &str,
    server_type: ServerType,
    project_id: &str,
) -> Result<(), String> {
    let dir = Path::new(server_dir);
    let mut list = read_manifest(dir);
    let idx = list.iter().position(|e| e.project_id == project_id).ok_or("not installed")?;
    let e = list.remove(idx);
    let ptype = if e.filename.contains("datapack") { "datapack" } else { "mod" };
    for base in [
        content_dir(dir, server_type, ptype),
        dir.join("mods-disabled"),
    ] {
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
    fn loader_facets() {
        assert_eq!(loader_facet(ServerType::Fabric), "fabric");
        assert_eq!(loader_facet(ServerType::Paper), "paper");
        assert_eq!(loader_facet(ServerType::Vanilla), "datapack");
    }

    #[test]
    fn manifest_roundtrip() {
        let d = std::env::temp_dir().join(format!("cp-mr-{:?}", std::thread::current().id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        let list = vec![InstalledEntry {
            project_id: "abc".into(),
            slug: "lithium".into(),
            title: "Lithium".into(),
            filename: "lithium-0.11.jar".into(),
            version_id: "v1".into(),
            version_number: "0.11".into(),
            dependency: false,
            update: None,
        }];
        write_manifest(&d, &list).unwrap();
        let back = read_manifest(&d);
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].slug, "lithium");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn content_dir_by_type() {
        let d = Path::new("/srv");
        assert!(content_dir(d, ServerType::Fabric, "mod").ends_with("mods"));
        assert!(content_dir(d, ServerType::Paper, "mod").ends_with("plugins"));
        assert!(content_dir(d, ServerType::Vanilla, "datapack").ends_with("datapacks"));
    }

    // hits the network
    #[test]
    #[ignore]
    fn live_search_fabric() {
        let r = search("/tmp", ServerType::Fabric, "lithium", "mod", Some("1.21.1"), 0).unwrap();
        assert!(r.hits.iter().any(|h| h.slug == "lithium"));
    }

    #[test]
    #[ignore]
    fn live_search_excludes_client_only_and_marks_old() {
        // Sodium is client-only -> must NOT appear in a server search
        let r = search("/tmp", ServerType::Fabric, "sodium", "mod", Some("1.21.1"), 0).unwrap();
        assert!(!r.hits.iter().any(|h| h.slug == "sodium"), "sodium is client-only");
        for h in &r.hits {
            assert_ne!(h.server_side, "unsupported");
        }
        // a very old MC version -> current mods have no build, must be marked
        let old = search("/tmp", ServerType::Fabric, "lithium", "mod", Some("1.7.10"), 0).unwrap();
        if let Some(l) = old.hits.iter().find(|h| h.slug == "lithium") {
            assert!(!l.compatible, "lithium has no 1.7.10 build");
        }
        println!("{} hits, {} incompatible", r.hits.len(), r.hits.iter().filter(|h| !h.compatible).count());
    }

    #[test]
    #[ignore]
    fn live_install_with_deps() {
        let d = std::env::temp_dir().join("cp-mr-install");
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        // Roughly Enough Items needs cloth-config + architectury -> exercises dep resolution
        let hit = search(&d.to_string_lossy(), ServerType::Fabric, "roughly enough items", "mod", Some("1.21.1"), 0)
            .unwrap()
            .hits
            .into_iter()
            .find(|h| h.slug == "rei")
            .expect("found REI");
        let r = install(&d.to_string_lossy(), ServerType::Fabric, &hit.project_id, "mod", Some("1.21.1")).unwrap();
        println!("installed: {:?}  skipped: {:?}", r.installed, r.skipped);
        let jars: Vec<_> = fs::read_dir(d.join("mods")).unwrap().flatten().collect();
        assert!(jars.len() >= 2, "REI + its deps should land in mods/");
        assert!(installed(&d.to_string_lossy()).len() >= 2);
        let _ = fs::remove_dir_all(&d);
    }
}
