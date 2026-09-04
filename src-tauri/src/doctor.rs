//! A pre-flight health check: Java, disk space, and port availability —
//! everything that would otherwise surface as a confusing error the
//! moment someone tries to create or start a server. One button in
//! Settings, run all three, tell the admin what's wrong *before* it
//! becomes a failure instead of explaining it after.

use std::path::Path;

use serde::Serialize;
use sysinfo::Disks;

use crate::{db::Db, external, java};

const MIN_FREE_GB: u64 = 2;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorCheck {
    pub id: &'static str,
    pub label: String,
    pub ok: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorReport {
    pub checks: Vec<DoctorCheck>,
    pub all_ok: bool,
}

fn check_java() -> DoctorCheck {
    match java::probe(None) {
        Some(j) => DoctorCheck {
            id: "java",
            label: "Java".into(),
            ok: true,
            detail: format!("Java {} found at {}", j.major, j.path),
        },
        None => DoctorCheck {
            id: "java",
            label: "Java".into(),
            ok: false,
            detail: "No Java runtime found on PATH. Servers won't be able to start until one's installed.".into(),
        },
    }
}

/// Free space on whichever disk the app's data directory lives on — the
/// longest matching mount point, same approach `df` uses.
fn check_disk(app_data_dir: &Path) -> DoctorCheck {
    let disks = Disks::new_with_refreshed_list();
    let best = disks
        .iter()
        .filter(|d| app_data_dir.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len());

    match best {
        Some(d) => {
            let free_gb = d.available_space() / 1_073_741_824;
            DoctorCheck {
                id: "disk",
                label: "Disk space".into(),
                ok: free_gb >= MIN_FREE_GB,
                detail: if free_gb >= MIN_FREE_GB {
                    format!("{free_gb} GB free")
                } else {
                    format!(
                        "Only {free_gb} GB free — worlds and backups fill up fast, \
                         free some space before creating a new server."
                    )
                },
            }
        }
        None => DoctorCheck {
            id: "disk",
            label: "Disk space".into(),
            ok: true, // couldn't determine it — don't cry wolf
            detail: "Couldn't check — not a blocker.".into(),
        },
    }
}

fn check_port(db: &Db) -> DoctorCheck {
    let taken: std::collections::HashSet<u16> = db
        .list_servers()
        .unwrap_or_default()
        .iter()
        .map(|s| external::port_of(Path::new(&s.path)))
        .collect();
    let free = (25565u16..25665).find(|p| !taken.contains(p) && external::port_free(*p));

    match free {
        Some(p) => DoctorCheck {
            id: "port",
            label: "Network port".into(),
            ok: true,
            detail: format!("Port {p} is free for a new server."),
        },
        None => DoctorCheck {
            id: "port",
            label: "Network port".into(),
            ok: false,
            detail: "Every port from 25565–25665 is already in use — something's unusual here."
                .into(),
        },
    }
}

pub fn run(db: &Db, app_data_dir: &Path) -> DoctorReport {
    let checks = vec![check_java(), check_disk(app_data_dir), check_port(db)];
    let all_ok = checks.iter().all(|c| c.ok);
    DoctorReport { checks, all_ok }
}
