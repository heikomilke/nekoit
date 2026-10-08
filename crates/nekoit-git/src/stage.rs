use std::path::Path;

use crate::{Git, Result};

/// `git add -- <paths>` (also stages deletions via `-A`).
pub fn stage(git: &Git, worktree: &Path, paths: &[String]) -> Result<()> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut args: Vec<&str> = vec!["add", "-A", "--"];
    args.extend(paths.iter().map(String::as_str));
    git.run(worktree, &args).map(|_| ())
}

/// `git restore --staged -- <paths>`; falls back to `git rm --cached` for files new to the index
/// in a repository without commits (restore needs HEAD).
pub fn unstage(git: &Git, worktree: &Path, paths: &[String]) -> Result<()> {
    if paths.is_empty() {
        return Ok(());
    }
    let has_head = git.run_raw(worktree, &["rev-parse", "--verify", "-q", "HEAD"])?.code == 0;
    let mut args: Vec<&str> = if has_head {
        vec!["restore", "--staged", "--"]
    } else {
        vec!["rm", "--cached", "-r", "--quiet", "--"]
    };
    args.extend(paths.iter().map(String::as_str));
    git.run(worktree, &args).map(|_| ())
}

/// Apply a (partial) unified diff to the index. `reverse` unstages the hunks instead.
/// This is how line-level staging works: the UI builds a patch containing only
/// the selected lines and we feed it to `git apply --cached`.
pub fn apply_to_index(git: &Git, worktree: &Path, patch: &str, reverse: bool) -> Result<()> {
    let mut args = vec!["apply", "--cached", "--whitespace=nowarn", "--recount"];
    if reverse {
        args.push("--reverse");
    }
    args.push("-");
    git.run_with_stdin(worktree, &args, patch.as_bytes()).map(|_| ())
}

/// Apply a (partial) unified diff to the working tree, index untouched. With
/// `reverse` this is how selected lines are discarded: the UI builds a patch
/// whose new side matches the file on disk and reverse-applies it.
pub fn apply_to_worktree(git: &Git, worktree: &Path, patch: &str, reverse: bool) -> Result<()> {
    let mut args = vec!["apply", "--whitespace=nowarn", "--recount"];
    if reverse {
        args.push("--reverse");
    }
    args.push("-");
    git.run_with_stdin(worktree, &args, patch.as_bytes()).map(|_| ())
}

/// Discard worktree changes for paths (`git restore --worktree`); untracked files are deleted with `clean`.
pub fn discard(git: &Git, worktree: &Path, tracked: &[String], untracked: &[String]) -> Result<()> {
    if !tracked.is_empty() {
        let mut args: Vec<&str> = vec!["restore", "--worktree", "--"];
        args.extend(tracked.iter().map(String::as_str));
        git.run(worktree, &args)?;
    }
    if !untracked.is_empty() {
        let mut args: Vec<&str> = vec!["clean", "-f", "--"];
        args.extend(untracked.iter().map(String::as_str));
        git.run(worktree, &args)?;
    }
    Ok(())
}

/// Create a commit from the index.
pub fn commit(git: &Git, worktree: &Path, message: &str, amend: bool, author: Option<&str>) -> Result<String> {
    let mut args = vec!["commit", "--quiet", "--file=-"];
    if amend {
        args.push("--amend");
    }
    let author_arg;
    if let Some(a) = author {
        author_arg = format!("--author={a}");
        args.push(&author_arg);
    }
    git.run_with_stdin(worktree, &args, message.as_bytes())?;
    let sha = git.run(worktree, &["rev-parse", "HEAD"])?;
    Ok(sha.trim().to_string())
}
