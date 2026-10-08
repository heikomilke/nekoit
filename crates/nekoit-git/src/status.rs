use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{Git, Result};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct BranchStatus {
    pub head: Option<String>,
    pub oid: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntry {
    pub path: String,
    pub orig_path: Option<String>,
    /// Index (staged) status letter, `.` when unchanged.
    pub index: char,
    /// Worktree (unstaged) status letter, `.` when unchanged.
    pub worktree: char,
    pub untracked: bool,
    pub ignored: bool,
    pub unmerged: bool,
    pub submodule: bool,
}

impl StatusEntry {
    pub fn is_staged(&self) -> bool {
        self.index != '.' && !self.untracked && !self.unmerged
    }
    pub fn is_unstaged(&self) -> bool {
        self.worktree != '.' || self.untracked || self.unmerged
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStatus {
    pub branch: BranchStatus,
    pub entries: Vec<StatusEntry>,
}

/// `git status --porcelain=v2 -z` for one worktree.
pub fn status(git: &Git, worktree: &Path, include_ignored: bool) -> Result<WorktreeStatus> {
    let mut args = vec!["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"];
    if include_ignored {
        args.push("--ignored");
    }
    let out = git.run(worktree, &args)?;
    parse_status(&out)
}

pub(crate) fn parse_status(out: &str) -> Result<WorktreeStatus> {
    let mut st = WorktreeStatus::default();
    let mut fields = out.split('\0').filter(|s| !s.is_empty());
    while let Some(rec) = fields.next() {
        if let Some(rest) = rec.strip_prefix("# ") {
            let (key, val) = rest.split_once(' ').unwrap_or((rest, ""));
            match key {
                "branch.oid" => st.branch.oid = Some(val.to_string()).filter(|v| v != "(initial)"),
                "branch.head" => st.branch.head = Some(val.to_string()).filter(|v| v != "(detached)"),
                "branch.upstream" => st.branch.upstream = Some(val.to_string()),
                "branch.ab" => {
                    for part in val.split_whitespace() {
                        if let Some(n) = part.strip_prefix('+') {
                            st.branch.ahead = n.parse().unwrap_or(0);
                        } else if let Some(n) = part.strip_prefix('-') {
                            st.branch.behind = n.parse().unwrap_or(0);
                        }
                    }
                }
                _ => {}
            }
            continue;
        }
        let mut parts = rec.splitn(2, ' ');
        let kind = parts.next().unwrap_or("");
        let rest = parts.next().unwrap_or("");
        match kind {
            "1" => {
                // XY sub mH mI mW hH hI path
                let cols: Vec<&str> = rest.splitn(8, ' ').collect();
                if cols.len() < 8 {
                    continue;
                }
                let xy = cols[0];
                st.entries.push(StatusEntry {
                    path: cols[7].to_string(),
                    orig_path: None,
                    index: xy.chars().next().unwrap_or('.'),
                    worktree: xy.chars().nth(1).unwrap_or('.'),
                    untracked: false,
                    ignored: false,
                    unmerged: false,
                    submodule: cols[1].starts_with('S'),
                });
            }
            "2" => {
                // XY sub mH mI mW hH hI Xscore path  \0 origPath
                let cols: Vec<&str> = rest.splitn(9, ' ').collect();
                if cols.len() < 9 {
                    continue;
                }
                let orig = fields.next().map(str::to_string);
                let xy = cols[0];
                st.entries.push(StatusEntry {
                    path: cols[8].to_string(),
                    orig_path: orig,
                    index: xy.chars().next().unwrap_or('.'),
                    worktree: xy.chars().nth(1).unwrap_or('.'),
                    untracked: false,
                    ignored: false,
                    unmerged: false,
                    submodule: cols[1].starts_with('S'),
                });
            }
            "u" => {
                // XY sub m1 m2 m3 mW h1 h2 h3 path
                let cols: Vec<&str> = rest.splitn(10, ' ').collect();
                if cols.len() < 10 {
                    continue;
                }
                let xy = cols[0];
                st.entries.push(StatusEntry {
                    path: cols[9].to_string(),
                    orig_path: None,
                    index: xy.chars().next().unwrap_or('.'),
                    worktree: xy.chars().nth(1).unwrap_or('.'),
                    untracked: false,
                    ignored: false,
                    unmerged: true,
                    submodule: cols[1].starts_with('S'),
                });
            }
            "?" => st.entries.push(StatusEntry {
                path: rest.to_string(),
                orig_path: None,
                index: '.',
                worktree: '?',
                untracked: true,
                ignored: false,
                unmerged: false,
                submodule: false,
            }),
            "!" => st.entries.push(StatusEntry {
                path: rest.to_string(),
                orig_path: None,
                index: '.',
                worktree: '!',
                untracked: false,
                ignored: true,
                unmerged: false,
                submodule: false,
            }),
            _ => {}
        }
    }
    Ok(st)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_v2() {
        let raw = "# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0\
1 .M N... 100644 100644 100644 1111 2222 src/lib.rs\0\
1 M. N... 100644 100644 100644 1111 2222 staged.rs\0\
2 R. N... 100644 100644 100644 1111 2222 R100 new.rs\0old.rs\0\
u UU N... 100644 100644 100644 100644 1 2 3 conflict.rs\0\
? untracked.txt\0";
        let st = parse_status(raw).unwrap();
        assert_eq!(st.branch.head.as_deref(), Some("main"));
        assert_eq!((st.branch.ahead, st.branch.behind), (2, 1));
        assert_eq!(st.entries.len(), 5);
        assert!(st.entries[0].is_unstaged() && !st.entries[0].is_staged());
        assert!(st.entries[1].is_staged() && !st.entries[1].is_unstaged());
        assert_eq!(st.entries[2].orig_path.as_deref(), Some("old.rs"));
        assert!(st.entries[3].unmerged);
        assert!(st.entries[4].untracked);
    }
}
