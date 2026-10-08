use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{Git, GitError, Result};

/// A repository as the dashboard sees it: one common git dir, N worktrees.
///
/// The user's preferred layout is a bare clone at `<project>/.bare` with the
/// worktrees as sibling folders (`<project>/master`, `<project>/staging`, …),
/// but plain repos (`<project>/.git`) with or without extra worktrees are
/// handled the same way.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    /// Stable identity: canonical common git dir.
    pub id: String,
    /// Display name: the project folder name.
    pub name: String,
    /// Project folder (parent of `.bare`, or the main worktree for plain repos).
    pub path: String,
    pub common_dir: String,
    pub bare: bool,
    pub worktrees: Vec<WorktreeInfo>,
    /// Newest committer time across local branches (unix seconds).
    pub last_activity: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    /// Folder name, which in the user's layout is the meaningful label.
    pub name: String,
    pub head: String,
    /// Short branch name, if not detached.
    pub branch: Option<String>,
    pub detached: bool,
    pub is_main: bool,
    pub locked: bool,
    pub prunable: bool,
    /// Committer time of HEAD (unix seconds).
    pub head_time: i64,
}

/// Returns true when `dir` looks like it could be a repository or a bare-clone project folder.
fn looks_like_repo(dir: &Path) -> bool {
    dir.join(".git").exists() || dir.join(".bare").is_dir()
}

/// Where to run git for a candidate folder.
fn git_entry(dir: &Path) -> PathBuf {
    if dir.join(".git").exists() {
        dir.to_path_buf()
    } else {
        dir.join(".bare")
    }
}

/// Scan `root` for repositories, `depth` levels deep (1 = direct children).
/// Candidates nested inside an already-found repo are skipped.
pub fn scan(git: &Git, root: &Path, depth: u32) -> Result<Vec<RepoInfo>> {
    let mut found = Vec::new();
    let mut seen = BTreeSet::new();
    scan_into(git, root, depth, &mut found, &mut seen)?;
    found.sort_by(|a, b| b.last_activity.cmp(&a.last_activity).then(a.name.cmp(&b.name)));
    Ok(found)
}

fn scan_into(
    git: &Git,
    dir: &Path,
    depth: u32,
    found: &mut Vec<RepoInfo>,
    seen: &mut BTreeSet<String>,
) -> Result<()> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    let mut children: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .filter(|p| !p.file_name().map(|n| n.to_string_lossy().starts_with('.')).unwrap_or(true))
        .collect();
    children.sort();
    for child in children {
        if looks_like_repo(&child) {
            match inspect(git, &child) {
                Ok(info) => {
                    if seen.insert(info.id.clone()) {
                        found.push(info);
                    }
                }
                Err(_) => continue,
            }
        } else if depth > 1 {
            scan_into(git, &child, depth - 1, found, seen)?;
        }
    }
    Ok(())
}

/// Inspect a single folder that is a repo, a worktree, or a bare-clone project folder.
pub fn inspect(git: &Git, dir: &Path) -> Result<RepoInfo> {
    let entry = git_entry(dir);
    let out = git.run(&entry, &["rev-parse", "--path-format=absolute", "--git-common-dir"])?;
    let common_dir = PathBuf::from(out.trim());
    let common_dir = std::fs::canonicalize(&common_dir).unwrap_or(common_dir);
    let bare = git.run(&common_dir, &["rev-parse", "--is-bare-repository"])?.trim() == "true";

    let worktrees = worktrees(git, &common_dir)?;

    // Project folder: parent of `.bare`, else the main worktree, else the git dir's parent.
    let path = if bare && common_dir.file_name().map(|n| n == ".bare").unwrap_or(false) {
        common_dir.parent().map(Path::to_path_buf).unwrap_or_else(|| common_dir.clone())
    } else if let Some(main) = worktrees.iter().find(|w| w.is_main) {
        PathBuf::from(&main.path)
    } else {
        common_dir.parent().map(Path::to_path_buf).unwrap_or_else(|| common_dir.clone())
    };
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string());

    let last_activity = git
        .run(
            &common_dir,
            &["for-each-ref", "--sort=-committerdate", "--count=1", "--format=%(committerdate:unix)", "refs/heads"],
        )
        .ok()
        .and_then(|s| s.trim().parse::<i64>().ok())
        .unwrap_or(0);
    let last_activity = worktrees.iter().map(|w| w.head_time).fold(last_activity, i64::max);

    Ok(RepoInfo {
        id: common_dir.display().to_string(),
        name,
        path: path.display().to_string(),
        common_dir: common_dir.display().to_string(),
        bare,
        worktrees,
        last_activity,
    })
}

/// `git worktree list --porcelain`, without the bare entry.
pub fn worktrees(git: &Git, repo: &Path) -> Result<Vec<WorktreeInfo>> {
    let out = git.run(repo, &["worktree", "list", "--porcelain", "-z"])?;
    let mut result = Vec::new();
    let mut first = true;
    for block in out.split("\0\0") {
        let block = block.trim_matches('\0');
        if block.is_empty() {
            continue;
        }
        let mut path = None;
        let mut head = String::new();
        let mut branch = None;
        let mut detached = false;
        let mut bare = false;
        let mut locked = false;
        let mut prunable = false;
        for line in block.split('\0') {
            let (key, value) = line.split_once(' ').unwrap_or((line, ""));
            match key {
                "worktree" => path = Some(value.to_string()),
                "HEAD" => head = value.to_string(),
                "branch" => branch = Some(value.strip_prefix("refs/heads/").unwrap_or(value).to_string()),
                "detached" => detached = true,
                "bare" => bare = true,
                "locked" => locked = true,
                "prunable" => prunable = true,
                _ => {}
            }
        }
        let is_main = first;
        first = false;
        if bare {
            continue;
        }
        let Some(path) = path else { continue };
        let name = Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone());
        let unborn = head.is_empty() || head.chars().all(|c| c == '0');
        let head_time = if unborn {
            0
        } else {
            git.run(repo, &["log", "-1", "--format=%ct", &head])
                .ok()
                .and_then(|s| s.trim().parse().ok())
                .unwrap_or(0)
        };
        result.push(WorktreeInfo { path, name, head, branch, detached, is_main, locked, prunable, head_time });
    }
    Ok(result)
}

/// Validate that `dir` is inside a git worktree and return its top level.
pub fn toplevel(git: &Git, dir: &Path) -> Result<PathBuf> {
    let out = git.run(dir, &["rev-parse", "--show-toplevel"])?;
    let p = out.trim();
    if p.is_empty() {
        return Err(GitError::Other(format!("{} is not inside a worktree", dir.display())));
    }
    Ok(PathBuf::from(p))
}
