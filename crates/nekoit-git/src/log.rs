use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{Git, GitError, Result, US};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub sha: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub author_time: i64,
    pub committer_name: String,
    pub commit_time: i64,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    #[serde(flatten)]
    pub commit: Commit,
    pub committer_email: String,
    pub body: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RefKind {
    Branch,
    Remote,
    Tag,
    Stash,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RefInfo {
    /// Full ref name, e.g. `refs/heads/main`.
    pub name: String,
    /// Display name, e.g. `main`, `origin/main`, `v1.2`.
    pub short: String,
    pub kind: RefKind,
    /// Commit the ref points to (peeled for annotated tags).
    pub sha: String,
    /// Short upstream name for local branches, e.g. `origin/main`.
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LogOptions {
    /// Include every ref (branches, remotes, tags). When false, only `revs`.
    pub all: bool,
    /// Extra revisions to start from (e.g. detached worktree HEADs).
    pub revs: Vec<String>,
    pub limit: usize,
    pub skip: usize,
    /// Only commits touching this path.
    pub path: Option<String>,
    /// Walk first parents only.
    pub first_parent: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogPage {
    pub commits: Vec<Commit>,
    pub has_more: bool,
}

const COMMIT_FORMAT: &str = "%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ct%x1f%s";

fn parse_commit(record: &str) -> Result<Commit> {
    let f: Vec<&str> = record.splitn(8, US).collect();
    if f.len() < 8 {
        return Err(GitError::Parse(format!("commit record has {} fields", f.len())));
    }
    Ok(Commit {
        sha: f[0].to_string(),
        parents: f[1].split_whitespace().map(str::to_string).collect(),
        author_name: f[2].to_string(),
        author_email: f[3].to_string(),
        author_time: f[4].parse().unwrap_or(0),
        committer_name: f[5].to_string(),
        commit_time: f[6].parse().unwrap_or(0),
        subject: f[7].to_string(),
    })
}

/// Commit list in topological order, one page.
pub fn log(git: &Git, repo: &Path, opts: &LogOptions) -> Result<LogPage> {
    let limit = if opts.limit == 0 { 1000 } else { opts.limit };
    let count = format!("--max-count={}", limit + 1);
    let skip = format!("--skip={}", opts.skip);
    let format = format!("--format={COMMIT_FORMAT}");
    let mut args: Vec<&str> = vec!["log", "-z", "--topo-order", &format, &count, &skip];
    if opts.first_parent {
        args.push("--first-parent");
    }
    if opts.all {
        args.push("--exclude=refs/stash");
        args.push("--all");
    }
    for r in &opts.revs {
        args.push(r);
    }
    if let Some(p) = &opts.path {
        args.push("--");
        args.push(p);
    }
    let out = git.run(repo, &args)?;
    let mut commits = Vec::new();
    for record in out.split('\0') {
        if record.is_empty() {
            continue;
        }
        commits.push(parse_commit(record)?);
    }
    let has_more = commits.len() > limit;
    commits.truncate(limit);
    Ok(LogPage { commits, has_more })
}

/// All refs with their (peeled) targets and tracking info.
pub fn refs(git: &Git, repo: &Path) -> Result<Vec<RefInfo>> {
    let out = git.run(
        repo,
        &[
            "for-each-ref",
            "--format=%(objectname)%1f%(refname)%1f%(refname:short)%1f%(upstream:short)%1f%(*objectname)%1f%(upstream:track,nobracket)",
        ],
    )?;
    let mut result = Vec::new();
    for line in out.lines() {
        let f: Vec<&str> = line.split(US).collect();
        if f.len() < 6 {
            continue;
        }
        let name = f[1].to_string();
        let kind = if name.starts_with("refs/heads/") {
            RefKind::Branch
        } else if name.starts_with("refs/remotes/") {
            RefKind::Remote
        } else if name.starts_with("refs/tags/") {
            RefKind::Tag
        } else if name == "refs/stash" {
            RefKind::Stash
        } else {
            RefKind::Other
        };
        if kind == RefKind::Other || (kind == RefKind::Remote && name.ends_with("/HEAD")) {
            continue;
        }
        let sha = if f[4].is_empty() { f[0] } else { f[4] }.to_string();
        let (ahead, behind) = parse_track(f[5]);
        result.push(RefInfo {
            name,
            short: f[2].to_string(),
            kind,
            sha,
            upstream: if f[3].is_empty() { None } else { Some(f[3].to_string()) },
            ahead,
            behind,
        });
    }
    Ok(result)
}

fn parse_track(s: &str) -> (u32, u32) {
    let mut ahead = 0;
    let mut behind = 0;
    for part in s.split(',') {
        let part = part.trim();
        if let Some(n) = part.strip_prefix("ahead ") {
            ahead = n.trim().parse().unwrap_or(0);
        } else if let Some(n) = part.strip_prefix("behind ") {
            behind = n.trim().parse().unwrap_or(0);
        }
    }
    (ahead, behind)
}

/// Full details for one commit including the message body.
pub fn commit_details(git: &Git, repo: &Path, rev: &str) -> Result<CommitDetails> {
    let format = format!("--format={COMMIT_FORMAT}%x1f%ce%x1f%b");
    let out = git.run(repo, &["show", "-s", "-z", &format, rev])?;
    let record = out.trim_end_matches('\0');
    let (head, rest) = split_n(record, 8)?;
    let commit = parse_commit(&head)?;
    let (ce, body) = rest.split_once(US).unwrap_or((rest, ""));
    Ok(CommitDetails {
        commit,
        committer_email: ce.to_string(),
        body: body.trim_end().to_string(),
    })
}

/// Split off the first `n` US-separated fields, returning them rejoined plus the remainder.
fn split_n(s: &str, n: usize) -> Result<(String, &str)> {
    let mut idx = 0;
    let mut seen = 0;
    for (i, c) in s.char_indices() {
        if c == US {
            seen += 1;
            if seen == n {
                idx = i;
                break;
            }
        }
    }
    if seen < n {
        return Err(GitError::Parse("commit details record too short".into()));
    }
    Ok((s[..idx].to_string(), &s[idx + 1..]))
}

/// Resolve any revision expression to a full sha.
pub fn resolve(git: &Git, repo: &Path, rev: &str) -> Result<String> {
    let out = git.run(repo, &["rev-parse", "--verify", "--end-of-options", &format!("{rev}^{{commit}}")])?;
    Ok(out.trim().to_string())
}
