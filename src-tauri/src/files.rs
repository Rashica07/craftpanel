//! In-app file manager for a server folder: list / view / edit / rename /
//! delete / mkdir / upload / download, plus a `logs/latest.log` tail.
//!
//! Every path is resolved relative to the server folder and rejected if it
//! escapes it (no `..`, no absolute, no symlink-out).

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

const TRASH: &str = ".craftpanel-trash";
const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub rel: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    /// normalised rel path of the dir being listed ("" = server root)
    pub path: String,
    pub parent: Option<String>,
    pub entries: Vec<Entry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileView {
    pub rel: String,
    pub text: String,
    pub bytes: u64,
    pub truncated: bool,
    pub binary: bool,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn mtime(m: &fs::Metadata) -> i64 {
    m.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Resolve `rel` under `root`, rejecting anything that would leave the folder.
fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let mut out = root.to_path_buf();
    for comp in Path::new(rel.trim_start_matches(['/', '\\'])).components() {
        match comp {
            Component::Normal(c) => out.push(c),
            Component::CurDir => {}
            _ => return Err("That path isn't allowed.".into()),
        }
    }
    let base = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    if let Ok(canon) = out.canonicalize() {
        if !canon.starts_with(&base) {
            return Err("That path escapes the server folder.".into());
        }
    }
    Ok(out)
}

fn norm_rel(root: &Path, p: &Path) -> String {
    p.strip_prefix(root)
        .map(|r| r.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

pub fn list(root: &Path, rel: &str) -> Result<Listing, String> {
    let dir = resolve(root, rel)?;
    if !dir.is_dir() {
        return Err("Not a folder.".into());
    }
    let mut entries = Vec::new();
    for e in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let meta = match e.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_dir = meta.is_dir();
        entries.push(Entry {
            rel: norm_rel(root, &e.path()),
            name,
            is_dir,
            size: if is_dir { 0 } else { meta.len() },
            modified: mtime(&meta),
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()))
    });
    let path = norm_rel(root, &dir);
    let parent = if path.is_empty() {
        None
    } else {
        Some(path.rsplit_once('/').map(|(p, _)| p.to_string()).unwrap_or_default())
    };
    Ok(Listing { path, parent, entries })
}

pub fn read(root: &Path, rel: &str) -> Result<FileView, String> {
    let path = resolve(root, rel)?;
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        return Err("That's a folder.".into());
    }
    let bytes = meta.len();
    let raw = {
        use std::io::Read;
        let mut f = fs::File::open(&path).map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; bytes.min(MAX_TEXT_BYTES) as usize];
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        buf.truncate(n);
        buf
    };
    let binary = raw.contains(&0);
    Ok(FileView {
        rel: norm_rel(root, &path),
        text: if binary {
            String::new()
        } else {
            String::from_utf8_lossy(&raw).into_owned()
        },
        bytes,
        truncated: bytes > MAX_TEXT_BYTES,
        binary,
    })
}

pub fn write(root: &Path, rel: &str, content: &str) -> Result<(), String> {
    if rel.trim().is_empty() {
        return Err("No file given.".into());
    }
    let path = resolve(root, rel)?;
    if path.is_dir() {
        return Err("That's a folder.".into());
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

pub fn mkdir(root: &Path, rel: &str) -> Result<(), String> {
    if rel.trim().is_empty() {
        return Err("No name given.".into());
    }
    let path = resolve(root, rel)?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

pub fn rename(root: &Path, from: &str, to: &str) -> Result<(), String> {
    if from.trim().is_empty() || to.trim().is_empty() {
        return Err("Both names are required.".into());
    }
    let src = resolve(root, from)?;
    let dst = resolve(root, to)?;
    if !src.exists() {
        return Err("Source no longer exists.".into());
    }
    if dst.exists() {
        return Err("Something with that name already exists.".into());
    }
    if let Some(p) = dst.parent() {
        fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    fs::rename(&src, &dst).map_err(|e| e.to_string())
}

/// Move to `.craftpanel-trash/<ts>-<name>` — never a hard delete.
pub fn delete(root: &Path, rel: &str) -> Result<(), String> {
    if rel.trim().is_empty() {
        return Err("Nothing selected.".into());
    }
    let path = resolve(root, rel)?;
    if !path.exists() {
        return Err("That's already gone.".into());
    }
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "item".into());
    let trash = root.join(TRASH);
    fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let dst = trash.join(format!("{}-{name}", now()));
    fs::rename(&path, &dst).map_err(|e| e.to_string())
}

pub fn import(root: &Path, dir_rel: &str, sources: &[String]) -> Result<Vec<String>, String> {
    let dir = resolve(root, dir_rel)?;
    if !dir.is_dir() {
        return Err("Target isn't a folder.".into());
    }
    let mut added = Vec::new();
    for src in sources {
        let src = Path::new(src);
        let name = src
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("bad source path")?;
        fs::copy(src, dir.join(name)).map_err(|e| format!("{name}: {e}"))?;
        added.push(name.to_string());
    }
    Ok(added)
}

pub fn export(root: &Path, rel: &str, dest: &str) -> Result<(), String> {
    let src = resolve(root, rel)?;
    if !src.is_file() {
        return Err("Only files can be downloaded.".into());
    }
    fs::copy(&src, dest).map_err(|e| e.to_string())?;
    Ok(())
}

/// Last `max_lines` of a log file (default `logs/latest.log`).
pub fn tail(root: &Path, rel: Option<&str>, max_lines: usize) -> Result<String, String> {
    let rel = rel.filter(|s| !s.trim().is_empty()).unwrap_or("logs/latest.log");
    let path = resolve(root, rel)?;
    if !path.is_file() {
        return Err(format!("No {rel} yet."));
    }
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let start = meta.len().saturating_sub(MAX_TEXT_BYTES);
    let bytes = {
        use std::io::{Read, Seek, SeekFrom};
        let mut f = fs::File::open(&path).map_err(|e| e.to_string())?;
        f.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
        let mut b = Vec::new();
        f.read_to_end(&mut b).map_err(|e| e.to_string())?;
        b
    };
    let text = String::from_utf8_lossy(&bytes);
    let lines: Vec<&str> = text.lines().collect();
    let tail = &lines[lines.len().saturating_sub(max_lines)..];
    Ok(tail.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn srv(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("cp-files-{tag}-{:?}", std::thread::current().id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("config")).unwrap();
        fs::create_dir_all(d.join("logs")).unwrap();
        fs::write(d.join("server.properties"), "level-name=world\n").unwrap();
        fs::write(d.join("config/paper.yml"), "verbose: false\n").unwrap();
        fs::write(d.join("logs/latest.log"), "line1\nline2\nline3\n").unwrap();
        d
    }

    #[test]
    fn lists_dirs_first_then_files() {
        let d = srv("ls");
        let l = list(&d, "").unwrap();
        assert_eq!(l.path, "");
        assert!(l.parent.is_none());
        assert!(l.entries[0].is_dir); // config/ or logs/ before server.properties
        assert!(l.entries.iter().any(|e| e.name == "server.properties" && !e.is_dir));

        let sub = list(&d, "config").unwrap();
        assert_eq!(sub.parent.as_deref(), Some(""));
        assert!(sub.entries.iter().any(|e| e.name == "paper.yml"));
    }

    #[test]
    fn read_write_roundtrip_and_traversal_blocked() {
        let d = srv("rw");
        let v = read(&d, "config/paper.yml").unwrap();
        assert!(v.text.contains("verbose"));
        write(&d, "config/paper.yml", "verbose: true\n").unwrap();
        assert_eq!(read(&d, "config/paper.yml").unwrap().text, "verbose: true\n");

        assert!(read(&d, "../../../etc/passwd").is_err());
        assert!(write(&d, "../escape.txt", "x").is_err());
        assert!(delete(&d, "..").is_err());
    }

    #[test]
    fn delete_moves_to_trash_and_rename_works() {
        let d = srv("del");
        delete(&d, "config/paper.yml").unwrap();
        assert!(!d.join("config/paper.yml").exists());
        assert!(fs::read_dir(d.join(TRASH)).unwrap().count() == 1);

        write(&d, "notes.txt", "hi").unwrap();
        rename(&d, "notes.txt", "docs/notes.txt").unwrap();
        assert!(d.join("docs/notes.txt").is_file());
    }

    #[test]
    fn tail_returns_last_lines() {
        let d = srv("tail");
        let t = tail(&d, None, 2).unwrap();
        assert_eq!(t, "line2\nline3");
        assert!(tail(&d, Some("logs/missing.log"), 10).is_err());
    }

    #[test]
    fn binary_files_flagged_not_dumped() {
        let d = srv("bin");
        fs::write(d.join("world.dat"), [0u8, 1, 2, 0, 255]).unwrap();
        let v = read(&d, "world.dat").unwrap();
        assert!(v.binary);
        assert!(v.text.is_empty());
    }
}
