use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{Git, GitError, Result};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    /// A, M, D, R, C, T (type change), U (unmerged), X (unknown).
    pub status: char,
    /// Similarity score for renames/copies.
    pub score: Option<u8>,
    pub path: String,
    pub old_path: Option<String>,
}

/// Files changed by a commit relative to its first parent (or the empty tree for root commits).
pub fn commit_changes(git: &Git, repo: &Path, sha: &str) -> Result<Vec<FileChange>> {
    let parents = git.run(repo, &["rev-list", "--parents", "-n", "1", sha])?;
    let first_parent = parents.split_whitespace().nth(1).map(str::to_string);
    match first_parent {
        Some(parent) => changes_between(git, repo, &parent, sha),
        None => {
            let out = git.run_bytes(repo, &["diff-tree", "--no-commit-id", "-r", "-M", "-z", "--name-status", "--root", sha])?;
            parse_name_status(&out)
        }
    }
}

/// Files changed between two revisions (trees).
pub fn changes_between(git: &Git, repo: &Path, base: &str, target: &str) -> Result<Vec<FileChange>> {
    let out = git.run_bytes(repo, &["diff", "-M", "-z", "--name-status", base, target])?;
    parse_name_status(&out)
}

pub(crate) fn parse_name_status(out: &[u8]) -> Result<Vec<FileChange>> {
    let text = String::from_utf8_lossy(out);
    let mut fields = text.split('\0').filter(|s| !s.is_empty());
    let mut result = Vec::new();
    while let Some(status) = fields.next() {
        let mut chars = status.chars();
        let code = chars.next().ok_or_else(|| GitError::Parse("empty status".into()))?;
        let score: Option<u8> = chars.as_str().parse().ok();
        match code {
            'R' | 'C' => {
                let old = fields.next().ok_or_else(|| GitError::Parse("rename without old path".into()))?;
                let new = fields.next().ok_or_else(|| GitError::Parse("rename without new path".into()))?;
                result.push(FileChange { status: code, score, path: new.to_string(), old_path: Some(old.to_string()) });
            }
            _ => {
                let path = fields.next().ok_or_else(|| GitError::Parse("status without path".into()))?;
                result.push(FileChange { status: code, score, path: path.to_string(), old_path: None });
            }
        }
    }
    Ok(result)
}

const DIFF_FLAGS: &[&str] = &["--no-color", "--no-ext-diff", "-M", "--patch"];

/// Unified diff of one commit (vs first parent, or vs empty tree for root commits),
/// optionally restricted to `path`.
pub fn commit_patch(git: &Git, repo: &Path, sha: &str, path: Option<&str>) -> Result<String> {
    let parents = git.run(repo, &["rev-list", "--parents", "-n", "1", sha])?;
    let first_parent = parents.split_whitespace().nth(1).map(str::to_string);
    match first_parent {
        Some(parent) => range_patch(git, repo, &parent, sha, path),
        None => {
            let mut args = vec!["show", "--format=", "--root"];
            args.extend_from_slice(DIFF_FLAGS);
            args.push(sha);
            if let Some(p) = path {
                args.push("--");
                args.push(p);
            }
            git.run(repo, &args)
        }
    }
}

/// Unified diff between two revisions, optionally restricted to `path`.
pub fn range_patch(git: &Git, repo: &Path, base: &str, target: &str, path: Option<&str>) -> Result<String> {
    let mut args = vec!["diff"];
    args.extend_from_slice(DIFF_FLAGS);
    args.push(base);
    args.push(target);
    if let Some(p) = path {
        args.push("--");
        args.push(p);
    }
    git.run(repo, &args)
}

/// Unified diff of the working tree: index vs HEAD when `staged`, else worktree vs index.
/// Untracked files are diffed against /dev/null so they render like additions.
pub fn worktree_patch(git: &Git, worktree: &Path, path: Option<&str>, staged: bool, untracked: bool) -> Result<String> {
    if untracked {
        let p = path.ok_or_else(|| GitError::Other("untracked diff needs a path".into()))?;
        let mut args = vec!["diff"];
        args.extend_from_slice(DIFF_FLAGS);
        args.extend_from_slice(&["--no-index", "--", "/dev/null", p]);
        // --no-index exits 1 when there are differences; that is the normal case.
        let out = git.run_raw(worktree, &args)?;
        if out.code > 1 {
            return Err(GitError::Failed {
                cwd: worktree.display().to_string(),
                args: args.iter().map(|s| s.to_string()).collect(),
                code: out.code,
                stderr: out.stderr,
            });
        }
        return Ok(String::from_utf8_lossy(&out.stdout).into_owned());
    }
    let mut args = vec!["diff"];
    args.extend_from_slice(DIFF_FLAGS);
    if staged {
        args.push("--cached");
    }
    if let Some(p) = path {
        args.push("--");
        args.push(p);
    }
    git.run(worktree, &args)
}

/// Contents of `path` at `rev` (`rev` = None reads the working tree file).
pub fn file_at(git: &Git, worktree: &Path, rev: Option<&str>, path: &str) -> Result<Vec<u8>> {
    match rev {
        Some(r) => git.run_bytes(worktree, &["show", &format!("{r}:{path}")]),
        None => std::fs::read(worktree.join(path)).map_err(GitError::Spawn),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_name_status_with_renames() {
        let raw = b"M\0src/a.rs\0R095\0old.txt\0new.txt\0A\0added\0D\0gone\0";
        let changes = parse_name_status(raw).unwrap();
        assert_eq!(changes.len(), 4);
        assert_eq!(changes[0], FileChange { status: 'M', score: None, path: "src/a.rs".into(), old_path: None });
        assert_eq!(changes[1], FileChange { status: 'R', score: Some(95), path: "new.txt".into(), old_path: Some("old.txt".into()) });
        assert_eq!(changes[3].status, 'D');
    }
}
