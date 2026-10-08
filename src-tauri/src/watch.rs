//! Watches a repository's git dir so the graph refreshes when refs change
//! behind the UI's back (a commit from a terminal, a fetch, a checkout).
//!
//! Only the git dir is watched: refs/, logs/, packed-refs, HEAD and the
//! per-worktree HEAD/index files under worktrees/. Working directories are
//! deliberately not watched: recursive watches over large trees are slow to
//! set up and noisy; worktree status is refreshed on F5, on the refresh
//! button, when the window regains focus, and after the app's own actions.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const REPO_CHANGED_EVENT: &str = "repo-changed";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum RepoChange {
    Refs,
}

type Watcher = Debouncer<notify::RecommendedWatcher, RecommendedCache>;

#[derive(Default, Clone)]
pub struct WatchState {
    current: Arc<Mutex<Option<Watcher>>>,
}

/// Only ref-like paths matter; lock files and object writes are noise.
fn interesting(path: &Path, common_dir: &Path) -> bool {
    if path.extension().map(|e| e == "lock").unwrap_or(false) {
        return false;
    }
    let Ok(rel) = path.strip_prefix(common_dir) else { return false };
    let Some(first) = rel.components().next() else { return false };
    let first = first.as_os_str().to_string_lossy();
    let name = path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default();
    first == "refs" || first == "logs" || first == "packed-refs" || name == "HEAD" || name == "index" || name == "ORIG_HEAD"
}

/// Start watching `common_dir`, replacing any previous watch. Setup runs on a
/// background thread so the UI never waits for inotify registration.
pub fn watch(app: AppHandle, state: &WatchState, common_dir: String) {
    let slot = state.current.clone();
    std::thread::spawn(move || {
        let common = PathBuf::from(&common_dir);
        let common_c = common.clone();
        let app_c = app.clone();
        let debouncer = new_debouncer(Duration::from_millis(400), None, move |result: DebounceEventResult| {
            let Ok(events) = result else { return };
            if events.iter().any(|ev| ev.paths.iter().any(|p| interesting(p, &common_c))) {
                let _ = app_c.emit(REPO_CHANGED_EVENT, RepoChange::Refs);
            }
        });
        let mut debouncer = match debouncer {
            Ok(d) => d,
            Err(e) => {
                eprintln!("nekoit: watcher unavailable: {e}");
                return;
            }
        };
        let targets: [(&str, RecursiveMode); 4] = [
            ("", RecursiveMode::NonRecursive),
            ("refs", RecursiveMode::Recursive),
            ("logs", RecursiveMode::Recursive),
            ("worktrees", RecursiveMode::Recursive),
        ];
        for (sub, mode) in targets {
            let p = if sub.is_empty() { common.clone() } else { common.join(sub) };
            if p.is_dir() {
                if let Err(e) = debouncer.watch(&p, mode) {
                    eprintln!("nekoit: cannot watch {}: {e}", p.display());
                }
            }
        }
        *slot.lock().unwrap() = Some(debouncer);
    });
}

pub fn unwatch(state: &WatchState) {
    *state.current.lock().unwrap() = None;
}
