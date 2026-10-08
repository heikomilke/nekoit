use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{Git, Result};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PullMode {
    Merge,
    Rebase,
    FfOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    pub fetch_url: String,
    pub push_url: String,
}

/// Output of a network operation; git reports progress on stderr, so both streams are returned.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RemoteResult {
    pub stdout: String,
    pub stderr: String,
}

pub fn remotes(git: &Git, repo: &Path) -> Result<Vec<RemoteInfo>> {
    let out = git.run(repo, &["remote", "-v"])?;
    let mut map: Vec<RemoteInfo> = Vec::new();
    for line in out.lines() {
        let mut parts = line.split_whitespace();
        let (Some(name), Some(url), Some(kind)) = (parts.next(), parts.next(), parts.next()) else { continue };
        let entry = match map.iter_mut().find(|r| r.name == name) {
            Some(e) => e,
            None => {
                map.push(RemoteInfo { name: name.to_string(), fetch_url: String::new(), push_url: String::new() });
                map.last_mut().unwrap()
            }
        };
        if kind == "(fetch)" {
            entry.fetch_url = url.to_string();
        } else {
            entry.push_url = url.to_string();
        }
    }
    Ok(map)
}

fn run_net(git: &Git, cwd: &Path, args: &[&str]) -> Result<RemoteResult> {
    let out = git.run_raw(cwd, args)?;
    if out.code != 0 {
        return Err(crate::GitError::Failed {
            cwd: cwd.display().to_string(),
            args: args.iter().map(|s| s.to_string()).collect(),
            code: out.code,
            stderr: out.stderr,
        });
    }
    Ok(RemoteResult { stdout: String::from_utf8_lossy(&out.stdout).into_owned(), stderr: out.stderr })
}

/// `git fetch <remote|--all> --prune`.
pub fn fetch(git: &Git, repo: &Path, remote: Option<&str>, prune: bool) -> Result<RemoteResult> {
    let mut args = vec!["fetch", "--no-progress"];
    if prune {
        args.push("--prune");
    }
    match remote {
        Some(r) => args.push(r),
        None => args.push("--all"),
    }
    run_net(git, repo, &args)
}

/// `git pull` in a worktree with an explicit integration strategy.
pub fn pull(git: &Git, worktree: &Path, mode: PullMode, remote: Option<&str>, branch: Option<&str>) -> Result<RemoteResult> {
    let mut args = vec!["pull", "--no-progress"];
    args.push(match mode {
        PullMode::Merge => "--no-rebase",
        PullMode::Rebase => "--rebase",
        PullMode::FfOnly => "--ff-only",
    });
    if let Some(r) = remote {
        args.push(r);
        if let Some(b) = branch {
            args.push(b);
        }
    }
    run_net(git, worktree, &args)
}

/// `git push`, optionally setting upstream or forcing with lease.
pub fn push(git: &Git, worktree: &Path, remote: Option<&str>, branch: Option<&str>, set_upstream: bool, force_with_lease: bool) -> Result<RemoteResult> {
    let mut args = vec!["push", "--no-progress"];
    if set_upstream {
        args.push("--set-upstream");
    }
    if force_with_lease {
        args.push("--force-with-lease");
    }
    if let Some(r) = remote {
        args.push(r);
        if let Some(b) = branch {
            args.push(b);
        }
    }
    run_net(git, worktree, &args)
}

/// `git rebase --abort`, used to back out of a failed automatic pull.
pub fn abort_rebase(git: &Git, worktree: &Path) -> Result<()> {
    git.run(worktree, &["rebase", "--abort"]).map(|_| ())
}
