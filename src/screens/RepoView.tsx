import { ArrowLeft, RefreshCw, ScrollText, SquareTerminal } from "lucide-react";
import { api } from "../api";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChangesPane } from "../components/ChangesPane";
import { CommitDetailsPane } from "../components/CommitDetails";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { RemoteActions } from "../components/RemoteActions";
import { CommitList, type CommitListHandle } from "../components/CommitList";
import { SplitPane } from "../components/SplitPane";
import { WorktreeBar } from "../components/WorktreeBar";
import { WORKDIR, useStore } from "../store";
import { useDarkTheme } from "../util/theme";

export function RepoView() {
  useDarkTheme();
  const current = useStore((s) => s.current);
  const closeRepo = useStore((s) => s.closeRepo);
  const reloadLog = useStore((s) => s.reloadLog);
  const toggleLog = useStore((s) => s.toggleLog);
  const setError = useStore((s) => s.setError);
  const list = useRef<CommitListHandle>(null);
  const [colorBySha, setColorBySha] = useState<Map<string, number>>(new Map());
  const onLayout = useCallback((m: Map<string, number>) => setColorBySha(m), []);

  const openTerminal = useCallback(() => {
    const dir = useStore.getState().current?.worktree?.path;
    if (dir) api.openTerminal(dir).catch((e) => setError(String(e)));
  }, [setError]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) closeRepo();
      if (e.key === "t" && e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        openTerminal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeRepo, openTerminal]);

  if (!current) return null;
  const { repo, worktree } = current;

  return (
    <div className="repo-view">
      <div className="repo-head-wrap">
        <header className="repo-head">
          <button className="btn btn-icon" onClick={closeRepo} title="Back to repositories (Esc)">
            <ArrowLeft size={16} />
          </button>
          <span className="repo-title">{repo.name}</span>
          <span className="repo-path muted">{repo.path}</span>
          <span className="spacer" />
          <RemoteActions />
          <button className="btn btn-icon" onClick={() => void reloadLog()} title="Refresh (F5)">
            <RefreshCw size={14} className={current.loadingLog ? "spin" : ""} />
          </button>
          <button className="btn btn-icon" onClick={openTerminal} disabled={!worktree} title={worktree ? `Open terminal in ${worktree.path} (ctrl+t)` : "No worktree"}>
            <SquareTerminal size={14} />
          </button>
          <button className="btn btn-icon" onClick={toggleLog} title="Command log (ctrl+`)">
            <ScrollText size={14} />
          </button>
        </header>
        <WorktreeBar colorBySha={colorBySha} onJump={(sha) => list.current?.scrollTo(sha)} />
      </div>
      <SplitPane
        direction="vertical"
        initial={Math.round(window.innerHeight * 0.45)}
        min={120}
        storageKey="repo-main"
        className="repo-split"
        first={<CommitList ref={list} onLayout={onLayout} />}
        second={<ErrorBoundary resetKey={current.selected[0]}>{current.selected[0] === WORKDIR ? <ChangesPane /> : <CommitDetailsPane />}</ErrorBoundary>}
      />
    </div>
  );
}
