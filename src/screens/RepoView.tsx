import { ArrowLeft, RefreshCw, Terminal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CommitDetailsPane } from "../components/CommitDetails";
import { CommitList, type CommitListHandle } from "../components/CommitList";
import { SplitPane } from "../components/SplitPane";
import { WorktreeBar } from "../components/WorktreeBar";
import { useStore } from "../store";
import { useDarkTheme } from "../util/theme";

export function RepoView() {
  useDarkTheme();
  const current = useStore((s) => s.current);
  const closeRepo = useStore((s) => s.closeRepo);
  const reloadLog = useStore((s) => s.reloadLog);
  const toggleLog = useStore((s) => s.toggleLog);
  const list = useRef<CommitListHandle>(null);
  const [colorBySha, setColorBySha] = useState<Map<string, number>>(new Map());
  const onLayout = useCallback((m: Map<string, number>) => setColorBySha(m), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F5") {
        e.preventDefault();
        void reloadLog();
      }
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement)) closeRepo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reloadLog, closeRepo]);

  if (!current) return null;
  const { repo } = current;

  return (
    <div className="repo-view">
      <header className="repo-head">
        <button className="btn btn-icon" onClick={closeRepo} title="Back to repositories (Esc)">
          <ArrowLeft size={16} />
        </button>
        <span className="repo-title">{repo.name}</span>
        <span className="repo-path muted">{repo.path}</span>
        <WorktreeBar colorBySha={colorBySha} onJump={(sha) => list.current?.scrollTo(sha)} />
        <span className="spacer" />
        <button className="btn btn-icon" onClick={() => void reloadLog()} title="Refresh (F5)">
          <RefreshCw size={14} className={current.loadingLog ? "spin" : ""} />
        </button>
        <button className="btn btn-icon" onClick={toggleLog} title="Command log (ctrl+`)">
          <Terminal size={14} />
        </button>
      </header>
      <SplitPane
        direction="vertical"
        initial={Math.round(window.innerHeight * 0.45)}
        min={120}
        storageKey="repo-main"
        className="repo-split"
        first={<CommitList ref={list} onLayout={onLayout} />}
        second={<CommitDetailsPane />}
      />
    </div>
  );
}
