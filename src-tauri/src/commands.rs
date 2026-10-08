//! Thin Tauri command layer over `nekoit-git`. Every command runs its git
//! work through `blocking`, i.e. on Tauri's blocking thread pool: a
//! synchronous command would run on the main thread and freeze the window
//! for the duration of the git call.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use nekoit_git as g;
use tauri::State;

use crate::config::{self, AppConfig};

pub struct AppState {
    pub git: Arc<g::Git>,
    pub config: Mutex<AppConfig>,
}

type R<T> = Result<T, String>;

fn err(e: g::GitError) -> String {
    e.to_string()
}

/// Run a blocking git closure off the main thread.
async fn blocking<T: Send + 'static>(git: &Arc<g::Git>, f: impl FnOnce(&g::Git) -> g::Result<T> + Send + 'static) -> R<T> {
    let git = Arc::clone(git);
    tauri::async_runtime::spawn_blocking(move || f(&git).map_err(err))
        .await
        .map_err(|e| e.to_string())?
}

fn p(s: &str) -> PathBuf {
    PathBuf::from(s)
}

#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> R<AppConfig> {
    Ok(state.config.lock().unwrap().clone())
}

#[tauri::command]
pub async fn set_config(state: State<'_, AppState>, config: AppConfig) -> R<()> {
    config::save(&config)?;
    *state.config.lock().unwrap() = config;
    Ok(())
}

/// Repositories from all configured scan roots plus manually added repos,
/// newest activity first.
#[tauri::command]
pub async fn list_repos(state: State<'_, AppState>) -> R<Vec<g::RepoInfo>> {
    let cfg = state.config.lock().unwrap().clone();
    blocking(&state.git, move |git| {
        let mut repos = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        for root in &cfg.scan_roots {
            for r in g::scan(git, Path::new(root), 1)? {
                if seen.insert(r.id.clone()) {
                    repos.push(r);
                }
            }
        }
        for path in &cfg.repos {
            if let Ok(r) = g::inspect(git, Path::new(path)) {
                if seen.insert(r.id.clone()) {
                    repos.push(r);
                }
            }
        }
        repos.sort_by(|a, b| b.last_activity.cmp(&a.last_activity).then(a.name.cmp(&b.name)));
        Ok(repos)
    })
    .await
}

#[tauri::command]
pub async fn scan_folder(state: State<'_, AppState>, root: String, depth: u32) -> R<Vec<g::RepoInfo>> {
    blocking(&state.git, move |git| g::scan(git, &p(&root), depth.max(1))).await
}

#[tauri::command]
pub async fn inspect_repo(state: State<'_, AppState>, path: String) -> R<g::RepoInfo> {
    blocking(&state.git, move |git| g::inspect(git, &p(&path))).await
}

#[tauri::command]
pub async fn worktrees(state: State<'_, AppState>, repo: String) -> R<Vec<g::WorktreeInfo>> {
    blocking(&state.git, move |git| g::worktrees(git, &p(&repo))).await
}

#[tauri::command]
pub async fn log(state: State<'_, AppState>, repo: String, options: g::LogOptions) -> R<g::LogPage> {
    blocking(&state.git, move |git| g::log(git, &p(&repo), &options)).await
}

#[tauri::command]
pub async fn refs(state: State<'_, AppState>, repo: String) -> R<Vec<g::RefInfo>> {
    blocking(&state.git, move |git| g::refs(git, &p(&repo))).await
}

#[tauri::command]
pub async fn commit_details(state: State<'_, AppState>, repo: String, rev: String) -> R<g::CommitDetails> {
    blocking(&state.git, move |git| g::commit_details(git, &p(&repo), &rev)).await
}

#[tauri::command]
pub async fn commit_changes(state: State<'_, AppState>, repo: String, sha: String) -> R<Vec<g::FileChange>> {
    blocking(&state.git, move |git| g::commit_changes(git, &p(&repo), &sha)).await
}

#[tauri::command]
pub async fn changes_between(state: State<'_, AppState>, repo: String, base: String, target: String) -> R<Vec<g::FileChange>> {
    blocking(&state.git, move |git| g::changes_between(git, &p(&repo), &base, &target)).await
}

#[tauri::command]
pub async fn commit_patch(state: State<'_, AppState>, repo: String, sha: String, path: Option<String>) -> R<String> {
    blocking(&state.git, move |git| g::commit_patch(git, &p(&repo), &sha, path.as_deref())).await
}

#[tauri::command]
pub async fn range_patch(state: State<'_, AppState>, repo: String, base: String, target: String, path: Option<String>) -> R<String> {
    blocking(&state.git, move |git| g::range_patch(git, &p(&repo), &base, &target, path.as_deref())).await
}

#[tauri::command]
pub async fn worktree_patch(state: State<'_, AppState>, worktree: String, path: Option<String>, staged: bool, untracked: bool) -> R<String> {
    blocking(&state.git, move |git| g::worktree_patch(git, &p(&worktree), path.as_deref(), staged, untracked)).await
}

/// File contents at a revision (or the working tree when `rev` is null), lossily decoded.
#[tauri::command]
pub async fn file_at(state: State<'_, AppState>, worktree: String, rev: Option<String>, path: String) -> R<String> {
    blocking(&state.git, move |git| {
        g::file_at(git, &p(&worktree), rev.as_deref(), &path).map(|b| String::from_utf8_lossy(&b).into_owned())
    })
    .await
}

#[tauri::command]
pub async fn status(state: State<'_, AppState>, worktree: String) -> R<g::WorktreeStatus> {
    blocking(&state.git, move |git| g::status(git, &p(&worktree), false)).await
}

#[tauri::command]
pub async fn stage(state: State<'_, AppState>, worktree: String, paths: Vec<String>) -> R<()> {
    blocking(&state.git, move |git| g::stage(git, &p(&worktree), &paths)).await
}

#[tauri::command]
pub async fn unstage(state: State<'_, AppState>, worktree: String, paths: Vec<String>) -> R<()> {
    blocking(&state.git, move |git| g::unstage(git, &p(&worktree), &paths)).await
}

#[tauri::command]
pub async fn apply_to_index(state: State<'_, AppState>, worktree: String, patch: String, reverse: bool) -> R<()> {
    blocking(&state.git, move |git| g::apply_to_index(git, &p(&worktree), &patch, reverse)).await
}

#[tauri::command]
pub async fn discard(state: State<'_, AppState>, worktree: String, tracked: Vec<String>, untracked: Vec<String>) -> R<()> {
    blocking(&state.git, move |git| g::discard(git, &p(&worktree), &tracked, &untracked)).await
}

#[tauri::command]
pub async fn commit(state: State<'_, AppState>, worktree: String, message: String, amend: bool, author: Option<String>) -> R<String> {
    blocking(&state.git, move |git| g::commit(git, &p(&worktree), &message, amend, author.as_deref())).await
}

#[tauri::command]
pub async fn resolve(state: State<'_, AppState>, repo: String, rev: String) -> R<String> {
    blocking(&state.git, move |git| g::resolve(git, &p(&repo), &rev)).await
}

#[tauri::command]
pub async fn remotes(state: State<'_, AppState>, repo: String) -> R<Vec<g::RemoteInfo>> {
    blocking(&state.git, move |git| g::remotes(git, &p(&repo))).await
}

#[tauri::command]
pub async fn fetch(state: State<'_, AppState>, repo: String, remote: Option<String>, prune: bool) -> R<g::RemoteResult> {
    blocking(&state.git, move |git| g::fetch(git, &p(&repo), remote.as_deref(), prune)).await
}

#[tauri::command]
pub async fn pull(state: State<'_, AppState>, worktree: String, mode: g::PullMode, remote: Option<String>, branch: Option<String>) -> R<g::RemoteResult> {
    blocking(&state.git, move |git| g::pull(git, &p(&worktree), mode, remote.as_deref(), branch.as_deref())).await
}

#[tauri::command]
pub async fn push(
    state: State<'_, AppState>,
    worktree: String,
    remote: Option<String>,
    branch: Option<String>,
    set_upstream: bool,
    force_with_lease: bool,
) -> R<g::RemoteResult> {
    blocking(&state.git, move |git| g::push(git, &p(&worktree), remote.as_deref(), branch.as_deref(), set_upstream, force_with_lease)).await
}

#[tauri::command]
pub async fn refs_containing(state: State<'_, AppState>, repo: String, sha: String) -> R<Vec<String>> {
    blocking(&state.git, move |git| g::refs_containing(git, &p(&repo), &sha, 30)).await
}

/// Open the system terminal in `dir`; returns the emulator that was launched.
#[tauri::command]
pub async fn open_terminal(dir: String) -> R<String> {
    tauri::async_runtime::spawn_blocking(move || crate::terminal::open(&dir)).await.map_err(|e| e.to_string())?
}

/// Append an ignore pattern to the worktree's .gitignore, open it in the editor,
/// and return once the editor command exits.
#[tauri::command]
pub async fn add_to_gitignore(state: State<'_, AppState>, worktree: String, pattern: String, open_editor: bool) -> R<String> {
    let editor = state.config.lock().unwrap().editor.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = g::add_to_gitignore(Path::new(&worktree), &pattern).map_err(err)?;
        let shown = path.display().to_string();
        if open_editor {
            crate::terminal::edit(&editor, &shown)?;
        }
        Ok(shown)
    })
    .await
    .map_err(|e| e.to_string())?
}
