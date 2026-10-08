use std::io::Write;
use std::path::{Path, PathBuf};

use crate::{GitError, Result};

/// Append `pattern` to the worktree's top-level `.gitignore` (created if
/// missing), returning the file's path. Does nothing if the exact line exists.
pub fn add_to_gitignore(worktree: &Path, pattern: &str) -> Result<PathBuf> {
    let path = worktree.join(".gitignore");
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    if existing.lines().any(|l| l.trim() == pattern.trim()) {
        return Ok(path);
    }
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&path).map_err(GitError::Spawn)?;
    if !existing.is_empty() && !existing.ends_with('\n') {
        f.write_all(b"\n").map_err(GitError::Spawn)?;
    }
    f.write_all(pattern.as_bytes()).map_err(GitError::Spawn)?;
    f.write_all(b"\n").map_err(GitError::Spawn)?;
    Ok(path)
}

/// Ignore patterns worth offering for a path inside the worktree.
pub fn suggestions(path: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    out.push((format!("/{path}"), "this file".to_string()));
    if let Some(i) = path.rfind('/') {
        out.push((format!("/{}/", &path[..i]), format!("folder {}/", &path[..i])));
    }
    if let Some(i) = path.rfind('.') {
        let ext = &path[i + 1..];
        if !ext.is_empty() && !ext.contains('/') {
            out.push((format!("*.{ext}"), format!("every *.{ext}")));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_once_with_newlines() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".gitignore"), "node_modules").unwrap();
        add_to_gitignore(dir.path(), "/build/").unwrap();
        add_to_gitignore(dir.path(), "/build/").unwrap();
        assert_eq!(std::fs::read_to_string(dir.path().join(".gitignore")).unwrap(), "node_modules\n/build/\n");
    }

    #[test]
    fn suggests_file_folder_and_extension() {
        let s = suggestions("src/app/main.rs");
        assert_eq!(s.iter().map(|x| x.0.as_str()).collect::<Vec<_>>(), ["/src/app/main.rs", "/src/app/", "*.rs"]);
        assert_eq!(suggestions("Makefile").len(), 1);
    }
}
