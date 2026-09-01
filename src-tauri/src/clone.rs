//! Clone an existing server into a brand-new, independent one: same jar/
//! version/loader, same world/plugins/mods/configs — none of the runtime
//! state that shouldn't be duplicated (session lock, logs, crash reports,
//! its own backup history — the exact same filter `backups.rs` already
//! uses for what belongs in a backup zip applies equally well here).

use std::fs;
use std::path::Path;

pub fn clone_dir(src: &Path, dest: &Path) -> Result<(), String> {
    if dest.exists()
        && fs::read_dir(dest).map(|mut d| d.next().is_some()).unwrap_or(false)
    {
        return Err("Pick an empty or new folder for the clone.".into());
    }
    fs::create_dir_all(dest).map_err(|e| format!("can't create folder: {e}"))?;
    for (path, rel) in crate::backups::collect_files(src) {
        let target = dest.join(&rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(&path, &target).map_err(|e| format!("copying {rel}: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clones_files_and_skips_junk() {
        let base = std::env::temp_dir().join(format!("cp-clone-{:?}", std::thread::current().id()));
        let src = base.join("src");
        let dest = base.join("dest");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(src.join("world")).unwrap();
        fs::create_dir_all(src.join("logs")).unwrap();
        fs::write(src.join("server.jar"), b"jar").unwrap();
        fs::write(src.join("server.properties"), b"level-name=world\n").unwrap();
        fs::write(src.join("world/level.dat"), b"data").unwrap();
        fs::write(src.join("logs/latest.log"), b"log").unwrap();
        fs::write(src.join(".craftpanel-session.json"), b"{}").unwrap();

        clone_dir(&src, &dest).unwrap();

        assert!(dest.join("server.jar").is_file());
        assert!(dest.join("server.properties").is_file());
        assert!(dest.join("world/level.dat").is_file());
        assert!(!dest.join("logs").exists(), "logs shouldn't be cloned");
        assert!(!dest.join(".craftpanel-session.json").exists(), "session lock shouldn't be cloned");

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn refuses_a_non_empty_destination() {
        let base = std::env::temp_dir().join(format!("cp-clone-nonempty-{:?}", std::thread::current().id()));
        let src = base.join("src");
        let dest = base.join("dest");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("server.jar"), b"jar").unwrap();
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("something"), b"already here").unwrap();

        assert!(clone_dir(&src, &dest).is_err());
        let _ = fs::remove_dir_all(&base);
    }
}
