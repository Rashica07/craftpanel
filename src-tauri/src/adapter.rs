//! Game-agnostic server adapter layer.
//!
//! Game-specific logic (Minecraft today, FiveM later) lives behind the
//! [`ServerAdapter`] trait. The rest of the app only ever talks to this layer,
//! so the UI and process/RCON code stay generic.
//!
//! `start_command` / `ServerConfig` / `ServerStatus` are exercised by the
//! adapter's own tests today and wired into process management in Stage 2.
#![allow(dead_code)]

use std::path::Path;
use std::process::Command;

use serde::{Deserialize, Serialize};

/// A concrete server flavour we know how to launch and read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ServerType {
    Fabric,
    Forge,
    Paper,
    Spigot,
    /// Generic `server.jar` with no mod/plugin loader detected.
    Vanilla,
    /// Native Bedrock Dedicated Server — not a JVM process at all. See
    /// `bedrock.rs` for what does and doesn't carry over from the Java
    /// adapters (no RCON, no `eula.txt`, different world format).
    Bedrock,
}

impl ServerType {
    pub fn label(&self) -> &'static str {
        match self {
            ServerType::Fabric => "Fabric",
            ServerType::Forge => "Forge",
            ServerType::Paper => "Paper",
            ServerType::Spigot => "Spigot",
            ServerType::Vanilla => "Vanilla",
            ServerType::Bedrock => "Bedrock",
        }
    }

    /// True if this flavour loads mods from a `mods/` folder (Stage 4).
    pub fn uses_mods_folder(&self) -> bool {
        matches!(self, ServerType::Fabric | ServerType::Forge)
    }

    /// True for the native Bedrock Dedicated Server — a plain OS process,
    /// not a JVM. Callers use this to skip everything that assumes `java`:
    /// heap flags, `-jar`, RCON, `eula.txt`.
    pub fn is_bedrock(&self) -> bool {
        matches!(self, ServerType::Bedrock)
    }
}

/// Everything the adapter needs to build a launch command.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    /// Absolute path to the server directory.
    pub path: String,
    /// The launch jar (or run script) relative to `path`.
    pub launch_target: String,
    /// `java` executable to use (absolute path or bare `java`).
    pub java_path: String,
    /// Heap size in megabytes. `-Xms` and `-Xmx` are always set equal.
    pub ram_mb: u32,
    pub server_type: ServerType,
}

/// Coarse run-state parsed from console output.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ServerStatus {
    Starting,
    Running,
    Stopping,
    Stopped,
    Crashed,
    Unknown,
}

pub trait ServerAdapter {
    /// Inspect a folder and report what kind of server (if any) lives there.
    fn detect(path: &Path) -> Option<ServerType>
    where
        Self: Sized;

    /// Build the process that launches this server. No shell involved.
    fn start_command(&self, config: &ServerConfig) -> Command;

    /// Interpret a chunk of console output into a coarse status.
    fn parse_status(&self, output: &str) -> ServerStatus;
}
