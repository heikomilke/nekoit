//! Thin Tauri command layer over `nekoit-git`. Each command maps 1:1 to a
//! function in the git crate; errors are flattened to strings for the UI.

use std::path::Path;
use std::sync::Mutex;

use nekoit_git as g;
use tauri::State;

use crate::config::{self, AppConfig};

pub struct AppState {
    pub git: g::Git,
    pub config: Mutex<AppConfig>,
}

type R<T> = Result<T, String>;

fn err(e: g::GitError) -> String {
    e.to_string()
}

#[tauri::command]
pub fn get_config(state: State<AppState>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_config(state: State<AppState>, config: AppConfig) -> R<()> {
    config::save(&config)?;
    *state.config.lock().unwrap() = config;
    Ok(())
}

/// Repositories from all configured scan roots plus manually added repos,
/// newest activity first.
#[tauri::command]
pub fn list_repos(state: State<AppState>) -> R<Vec<g::RepoInfo>> {
    let cfg = state.config.lock().unwrap().clone();
    let mut repos = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for root in &cfg.scan_roots {
        for r in g::scan(&state.git, Path::new(root), 1).map_err(err)? {
            if seen.insert(r.id.clone()) {
                repos.push(r);
            }
        }
    }
    for p in &cfg.repos {
        if let Ok(r) = g::inspect(&state.git, Path::new(p)) {
            if seen.insert(r.id.clone()) {
                repos.push(r);
            }
        }
    }
    repos.sort_by(|a, b| b.last_activity.cmp(&a.last_activity).then(a.name.cmp(&b.name)));
    Ok(repos)
}

#[tauri::command]
pub fn scan_folder(state: State<AppState>, root: String, depth: u32) -> R<Vec<g::RepoInfo>> {
    g::scan(&state.git, Path::new(&root), depth.max(1)).map_err(err)
}

#[tauri::command]
pub fn inspect_repo(state: State<AppState>, path: String) -> R<g::RepoInfo> {
    g::inspect(&state.git, Path::new(&path)).map_err(err)
}

#[tauri::command]
pub fn worktrees(state: State<AppState>, repo: String) -> R<Vec<g::WorktreeInfo>> {
    g::worktrees(&state.git, Path::new(&repo)).map_err(err)
}

#[tauri::command]
pub fn log(state: State<AppState>, repo: String, options: g::LogOptions) -> R<g::LogPage> {
    g::log(&state.git, Path::new(&repo), &options).map_err(err)
}

#[tauri::command]
pub fn refs(state: State<AppState>, repo: String) -> R<Vec<g::RefInfo>> {
    g::refs(&state.git, Path::new(&repo)).map_err(err)
}

#[tauri::command]
pub fn commit_details(state: State<AppState>, repo: String, rev: String) -> R<g::CommitDetails> {
    g::commit_details(&state.git, Path::new(&repo), &rev).map_err(err)
}

#[tauri::command]
pub fn commit_changes(state: State<AppState>, repo: String, sha: String) -> R<Vec<g::FileChange>> {
    g::commit_changes(&state.git, Path::new(&repo), &sha).map_err(err)
}

#[tauri::command]
pub fn changes_between(state: State<AppState>, repo: String, base: String, target: String) -> R<Vec<g::FileChange>> {
    g::changes_between(&state.git, Path::new(&repo), &base, &target).map_err(err)
}

#[tauri::command]
pub fn commit_patch(state: State<AppState>, repo: String, sha: String, path: Option<String>) -> R<String> {
    g::commit_patch(&state.git, Path::new(&repo), &sha, path.as_deref()).map_err(err)
}

#[tauri::command]
pub fn range_patch(state: State<AppState>, repo: String, base: String, target: String, path: Option<String>) -> R<String> {
    g::range_patch(&state.git, Path::new(&repo), &base, &target, path.as_deref()).map_err(err)
}

#[tauri::command]
pub fn worktree_patch(state: State<AppState>, worktree: String, path: Option<String>, staged: bool, untracked: bool) -> R<String> {
    g::worktree_patch(&state.git, Path::new(&worktree), path.as_deref(), staged, untracked).map_err(err)
}

/// File contents at a revision (or the working tree when `rev` is null), lossily decoded.
#[tauri::command]
pub fn file_at(state: State<AppState>, worktree: String, rev: Option<String>, path: String) -> R<String> {
    g::file_at(&state.git, Path::new(&worktree), rev.as_deref(), &path)
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .map_err(err)
}

#[tauri::command]
pub fn status(state: State<AppState>, worktree: String) -> R<g::WorktreeStatus> {
    g::status(&state.git, Path::new(&worktree), false).map_err(err)
}

#[tauri::command]
pub fn stage(state: State<AppState>, worktree: String, paths: Vec<String>) -> R<()> {
    g::stage(&state.git, Path::new(&worktree), &paths).map_err(err)
}

#[tauri::command]
pub fn unstage(state: State<AppState>, worktree: String, paths: Vec<String>) -> R<()> {
    g::unstage(&state.git, Path::new(&worktree), &paths).map_err(err)
}

#[tauri::command]
pub fn apply_to_index(state: State<AppState>, worktree: String, patch: String, reverse: bool) -> R<()> {
    g::apply_to_index(&state.git, Path::new(&worktree), &patch, reverse).map_err(err)
}

#[tauri::command]
pub fn discard(state: State<AppState>, worktree: String, tracked: Vec<String>, untracked: Vec<String>) -> R<()> {
    g::discard(&state.git, Path::new(&worktree), &tracked, &untracked).map_err(err)
}

#[tauri::command]
pub fn commit(state: State<AppState>, worktree: String, message: String, amend: bool, author: Option<String>) -> R<String> {
    g::commit(&state.git, Path::new(&worktree), &message, amend, author.as_deref()).map_err(err)
}

#[tauri::command]
pub fn resolve(state: State<AppState>, repo: String, rev: String) -> R<String> {
    g::resolve(&state.git, Path::new(&repo), &rev).map_err(err)
}
