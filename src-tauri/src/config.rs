use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    /// Folders that are scanned for repositories on startup.
    pub scan_roots: Vec<String>,
    /// Repositories added by hand (project folders).
    pub repos: Vec<String>,
    /// Last opened repo id and worktree path, to restore on start.
    pub last_repo: Option<String>,
    pub last_worktree: Option<String>,
    pub theme: Theme,
    /// Editor command for opening files; `{file}` is replaced by the path. Empty = `xdg-open`.
    /// Use a blocking command (e.g. `code --wait {file}`) to have the UI refresh when you close the file.
    pub editor: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("nekoit")
        .join("config.json")
}

pub fn load() -> AppConfig {
    std::fs::read_to_string(config_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(cfg: &AppConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}
