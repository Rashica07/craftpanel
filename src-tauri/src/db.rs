//! SQLite-backed app metadata: the server list and (later) settings.

use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::adapter::ServerType;

pub struct Db(pub Mutex<Connection>);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerRecord {
    pub id: String,
    pub name: String,
    pub path: String,
    pub server_type: ServerType,
    pub launch_target: String,
    pub mc_version: Option<String>,
    pub java_path: String,
    pub ram_mb: u32,
    pub created_at: i64,
    /// Set when this server is synced via R2 under this code.
    #[serde(default)]
    pub sync_code: Option<String>,
    /// Keep this machine awake (no idle sleep) while the server runs.
    #[serde(default)]
    pub keep_awake: bool,
    /// Extra JVM flags injected between the heap flags and `-jar` (Aikar's, GC…).
    #[serde(default)]
    pub jvm_args: Option<String>,
}

/// Fields the UI supplies when confirming a new server.
#[derive(Debug, Clone, Deserialize)]
pub struct NewServer {
    pub name: String,
    pub path: String,
    pub server_type: ServerType,
    pub launch_target: String,
    pub mc_version: Option<String>,
    pub java_path: String,
    pub ram_mb: u32,
}

impl Db {
    pub fn open(file: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(file)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS servers (
                 id            TEXT PRIMARY KEY,
                 name          TEXT NOT NULL,
                 path          TEXT NOT NULL UNIQUE,
                 server_type   TEXT NOT NULL,
                 launch_target TEXT NOT NULL,
                 mc_version    TEXT,
                 java_path     TEXT NOT NULL,
                 ram_mb        INTEGER NOT NULL,
                 created_at    INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS settings (
                 key   TEXT PRIMARY KEY,
                 value TEXT NOT NULL
             );",
        )?;
        // migrations (idempotent — ignore "duplicate column")
        let _ = conn.execute("ALTER TABLE servers ADD COLUMN sync_code TEXT", []);
        let _ = conn.execute(
            "ALTER TABLE servers ADD COLUMN keep_awake INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = conn.execute("ALTER TABLE servers ADD COLUMN jvm_args TEXT", []);
        Ok(Db(Mutex::new(conn)))
    }

    pub fn insert_server(&self, new: NewServer) -> rusqlite::Result<ServerRecord> {
        let rec = ServerRecord {
            id: uuid::Uuid::new_v4().to_string(),
            name: new.name,
            path: new.path,
            server_type: new.server_type,
            launch_target: new.launch_target,
            mc_version: new.mc_version,
            java_path: new.java_path,
            ram_mb: new.ram_mb,
            created_at: now_secs(),
            sync_code: None,
            keep_awake: false,
            jvm_args: None,
        };
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO servers
                (id, name, path, server_type, launch_target, mc_version, java_path, ram_mb, created_at, sync_code, keep_awake, jvm_args)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                rec.id,
                rec.name,
                rec.path,
                type_str(rec.server_type),
                rec.launch_target,
                rec.mc_version,
                rec.java_path,
                rec.ram_mb,
                rec.created_at,
                rec.sync_code,
                rec.keep_awake,
                rec.jvm_args,
            ],
        )?;
        Ok(rec)
    }

    pub fn list_servers(&self) -> rusqlite::Result<Vec<ServerRecord>> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn.prepare(&format!("SELECT {COLS} FROM servers ORDER BY created_at DESC"))?;
        let rows = stmt.query_map([], map_row)?;
        rows.collect()
    }

    pub fn get_server(&self, id: &str) -> rusqlite::Result<Option<ServerRecord>> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn.prepare(&format!("SELECT {COLS} FROM servers WHERE id = ?1"))?;
        let mut rows = stmt.query_map(params![id], map_row)?;
        rows.next().transpose()
    }

    pub fn update_server_ram(&self, id: &str, ram_mb: u32) -> rusqlite::Result<()> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "UPDATE servers SET ram_mb = ?2 WHERE id = ?1",
            params![id, ram_mb],
        )?;
        Ok(())
    }

    pub fn set_sync_code(&self, id: &str, code: Option<&str>) -> rusqlite::Result<()> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "UPDATE servers SET sync_code = ?2 WHERE id = ?1",
            params![id, code],
        )?;
        Ok(())
    }

    pub fn set_keep_awake(&self, id: &str, keep_awake: bool) -> rusqlite::Result<()> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "UPDATE servers SET keep_awake = ?2 WHERE id = ?1",
            params![id, keep_awake],
        )?;
        Ok(())
    }

    pub fn update_java_path(&self, id: &str, java_path: &str) -> rusqlite::Result<()> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "UPDATE servers SET java_path = ?2 WHERE id = ?1",
            params![id, java_path],
        )?;
        Ok(())
    }

    pub fn set_jvm_args(&self, id: &str, jvm_args: Option<&str>) -> rusqlite::Result<()> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "UPDATE servers SET jvm_args = ?2 WHERE id = ?1",
            params![id, jvm_args],
        )?;
        Ok(())
    }

    /// Generic key/value app setting (used for backup retention, scheduler
    /// config, …).
    pub fn get_setting(&self, key: &str) -> rusqlite::Result<Option<String>> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query_map(params![key], |r| r.get::<_, String>(0))?;
        rows.next().transpose()
    }

    pub fn set_setting(&self, key: &str, value: &str) -> rusqlite::Result<()> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn delete_server(&self, id: &str) -> rusqlite::Result<()> {
        let conn = self.0.lock().unwrap();
        conn.execute("DELETE FROM servers WHERE id = ?1", params![id])?;
        Ok(())
    }
}

const COLS: &str =
    "id, name, path, server_type, launch_target, mc_version, java_path, ram_mb, created_at, sync_code, keep_awake, jvm_args";

fn map_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<ServerRecord> {
    Ok(ServerRecord {
        id: r.get(0)?,
        name: r.get(1)?,
        path: r.get(2)?,
        server_type: type_from_str(&r.get::<_, String>(3)?),
        launch_target: r.get(4)?,
        mc_version: r.get(5)?,
        java_path: r.get(6)?,
        ram_mb: r.get(7)?,
        created_at: r.get(8)?,
        sync_code: r.get(9)?,
        keep_awake: r.get::<_, i64>(10).unwrap_or(0) != 0,
        jvm_args: r.get(11).ok().flatten(),
    })
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn type_str(t: ServerType) -> &'static str {
    match t {
        ServerType::Fabric => "fabric",
        ServerType::Forge => "forge",
        ServerType::Paper => "paper",
        ServerType::Spigot => "spigot",
        ServerType::Vanilla => "vanilla",
        ServerType::Bedrock => "bedrock",
    }
}

fn type_from_str(s: &str) -> ServerType {
    match s {
        "fabric" => ServerType::Fabric,
        "forge" => ServerType::Forge,
        "paper" => ServerType::Paper,
        "spigot" => ServerType::Spigot,
        "bedrock" => ServerType::Bedrock,
        _ => ServerType::Vanilla,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(path: &str) -> NewServer {
        NewServer {
            name: "Test".into(),
            path: path.into(),
            server_type: ServerType::Paper,
            launch_target: "paper.jar".into(),
            mc_version: Some("1.21.1".into()),
            java_path: "java".into(),
            ram_mb: 4096,
        }
    }

    #[test]
    fn round_trips_servers() {
        let file = std::env::temp_dir().join(format!("cp-db-{:?}.sqlite", std::thread::current().id()));
        let _ = std::fs::remove_file(&file);
        let db = Db::open(&file).unwrap();

        let rec = db.insert_server(sample("/srv/a")).unwrap();
        assert_eq!(db.list_servers().unwrap().len(), 1);
        assert_eq!(db.list_servers().unwrap()[0].server_type, ServerType::Paper);
        assert_eq!(db.list_servers().unwrap()[0].ram_mb, 4096);

        // path is UNIQUE
        assert!(db.insert_server(sample("/srv/a")).is_err());

        db.delete_server(&rec.id).unwrap();
        assert!(db.list_servers().unwrap().is_empty());
        let _ = std::fs::remove_file(&file);
    }
}
