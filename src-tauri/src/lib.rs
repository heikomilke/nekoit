mod commands;
mod config;

use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

use commands::AppState;

/// Event name for the UI command log; payload is `nekoit_git::CommandRecord`.
pub const GIT_COMMAND_EVENT: &str = "git-command";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let git = nekoit_git::Git::with_sink(Arc::new(move |record| {
                let _ = handle.emit(GIT_COMMAND_EVENT, record);
            }));
            app.manage(AppState { git, config: Mutex::new(config::load()) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::set_config,
            commands::list_repos,
            commands::scan_folder,
            commands::inspect_repo,
            commands::worktrees,
            commands::log,
            commands::refs,
            commands::commit_details,
            commands::commit_changes,
            commands::changes_between,
            commands::commit_patch,
            commands::range_patch,
            commands::worktree_patch,
            commands::file_at,
            commands::status,
            commands::stage,
            commands::unstage,
            commands::apply_to_index,
            commands::discard,
            commands::commit,
            commands::resolve,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
