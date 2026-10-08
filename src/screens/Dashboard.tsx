import { open } from "@tauri-apps/plugin-dialog";
import { FolderGit2, FolderPlus, FolderSearch, RefreshCw, X } from "lucide-react";
import type { RepoInfo } from "../api";
import { useStore } from "../store";
import { relativeTime } from "../util/format";
import { useDarkTheme } from "../util/theme";

/** All known repositories as cards, most recently active first. */
export function Dashboard() {
  useDarkTheme();
  const repos = useStore((s) => s.repos);
  const loading = useStore((s) => s.loadingRepos);
  const config = useStore((s) => s.config);
  const openRepo = useStore((s) => s.openRepo);
  const refresh = useStore((s) => s.refreshRepos);
  const addScanRoot = useStore((s) => s.addScanRoot);
  const removeScanRoot = useStore((s) => s.removeScanRoot);
  const addRepo = useStore((s) => s.addRepo);
  const toggleLog = useStore((s) => s.toggleLog);

  const pickFolder = async (title: string): Promise<string | null> => {
    const r = await open({ directory: true, multiple: false, title });
    return typeof r === "string" ? r : null;
  };

  return (
    <div className="dashboard">
      <header className="dash-head">
        <h1 className="brand">nekoit</h1>
        <div className="scan-roots">
          {config?.scanRoots.map((r) => (
            <span key={r} className="pill pill-root" title="Scanned for repositories">
              <FolderSearch size={12} /> {r}
              <button className="pill-x" onClick={() => void removeScanRoot(r)} aria-label={`Stop scanning ${r}`}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
        <div className="dash-actions">
          <button className="btn" onClick={() => void pickFolder("Scan folder for repositories").then((p) => (p ? addScanRoot(p) : undefined))}>
            <FolderSearch size={14} /> Scan folder
          </button>
          <button className="btn" onClick={() => void pickFolder("Add repository").then((p) => (p ? addRepo(p) : undefined))}>
            <FolderPlus size={14} /> Add repo
          </button>
          <button className="btn btn-icon" onClick={() => void refresh()} title="Refresh" disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : ""} />
          </button>
          <button className="btn btn-ghost" onClick={toggleLog} title="Command log (ctrl+`)">
            log
          </button>
        </div>
      </header>

      {repos.length === 0 && !loading && (
        <div className="empty-state">
          <FolderGit2 size={40} strokeWidth={1.2} />
          <p>No repositories yet. Scan a folder such as your projects directory, or add a repository.</p>
        </div>
      )}

      <div className="repo-grid">
        {repos.map((r) => (
          <RepoCard key={r.id} repo={r} onOpen={(wt) => void openRepo(r, wt)} />
        ))}
      </div>
    </div>
  );
}

function RepoCard({ repo, onOpen }: { repo: RepoInfo; onOpen(worktree?: RepoInfo["worktrees"][number]): void }) {
  const wts = [...repo.worktrees].sort((a, b) => b.headTime - a.headTime);
  return (
    <article className="repo-card" onClick={() => onOpen()} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen()}>
      <div className="repo-card-head">
        <span className="repo-name">{repo.name}</span>
        <span className="repo-age muted" title={new Date(repo.lastActivity * 1000).toLocaleString()}>
          {relativeTime(repo.lastActivity)}
        </span>
      </div>
      <div className="repo-path muted">{repo.path}</div>
      <div className="repo-wts">
        {wts.map((w) => (
          <button
            key={w.path}
            className="wt-mini"
            title={`${w.path}\n${w.branch ?? "detached"}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(w);
            }}
          >
            <FolderGit2 size={11} />
            <span>{w.name}</span>
            {w.branch && w.branch !== w.name && <span className="muted">{w.branch}</span>}
            {w.detached && <span className="muted">detached</span>}
            <span className="muted wt-mini-age">{relativeTime(w.headTime)}</span>
          </button>
        ))}
      </div>
    </article>
  );
}
