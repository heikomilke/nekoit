//! Manual probe: `cargo run -p nekoit-git --example probe -- <scan-root> [worktree]`
use std::path::Path;
use std::sync::Arc;

use nekoit_git::*;

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let root = args.get(1).map(String::as_str).unwrap_or(".");
    let git = Git::with_sink(Arc::new(|r: &CommandRecord| {
        eprintln!("[{:>4}ms] git {} (cwd {}){}", r.duration_ms, r.args.join(" "), r.cwd,
            if r.exit_code != Some(0) { format!(" -> {:?} {}", r.exit_code, r.stderr.trim()) } else { String::new() });
    }));
    let t = std::time::Instant::now();
    let repos = scan(&git, Path::new(root), 1)?;
    println!("scanned {} repos in {:?}", repos.len(), t.elapsed());
    for r in &repos {
        println!("{:<28} bare={:<5} act={} wts={} path={}", r.name, r.bare, r.last_activity, r.worktrees.len(), r.path);
        for w in &r.worktrees {
            println!("    {:<36} {} {:?} main={} detached={}", w.name, &w.head[..8], w.branch, w.is_main, w.detached);
        }
    }
    if let Some(wt) = args.get(2) {
        let wt = Path::new(wt);
        let page = log(&git, wt, &LogOptions { all: true, limit: 50, ..Default::default() })?;
        println!("log: {} commits, more={}", page.commits.len(), page.has_more);
        for c in page.commits.iter().take(5) {
            println!("  {} {:?} {} | {}", &c.sha[..8], c.parents.iter().map(|p| &p[..8]).collect::<Vec<_>>(), c.author_name, c.subject);
        }
        let refs = refs(&git, wt)?;
        println!("refs: {}", refs.len());
        for r in refs.iter().take(8) {
            println!("  {:?} {} -> {} up={:?} +{} -{}", r.kind, r.short, &r.sha[..8], r.upstream, r.ahead, r.behind);
        }
        let head = &page.commits[0];
        let d = commit_details(&git, wt, &head.sha)?;
        println!("details: {} body_len={} ce={}", d.commit.subject, d.body.len(), d.committer_email);
        let ch = commit_changes(&git, wt, &head.sha)?;
        println!("changes: {}", ch.len());
        for c in ch.iter().take(5) {
            println!("  {} {} {:?}", c.status, c.path, c.old_path);
        }
        if let Some(c) = ch.first() {
            let p = commit_patch(&git, wt, &head.sha, Some(&c.path), false)?;
            println!("patch head:\n{}", p.lines().take(8).collect::<Vec<_>>().join("\n"));
        }
        let st = status(&git, wt, false)?;
        println!("status: {:?} entries={}", st.branch, st.entries.len());
        for e in st.entries.iter().take(5) {
            println!("  {}{} {} untracked={}", e.index, e.worktree, e.path, e.untracked);
        }
    }
    Ok(())
}
