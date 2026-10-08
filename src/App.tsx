import { useEffect } from "react";
import { onGitCommand } from "./api";
import { CommandLog } from "./components/CommandLog";
import { Dashboard } from "./screens/Dashboard";
import { RepoView } from "./screens/RepoView";
import { useStore } from "./store";

export default function App() {
  const screen = useStore((s) => s.screen);
  const error = useStore((s) => s.error);
  const notice = useStore((s) => s.notice);
  const setNotice = useStore((s) => s.setNotice);
  const logOpen = useStore((s) => s.logOpen);
  const init = useStore((s) => s.init);
  const pushCommand = useStore((s) => s.pushCommand);
  const toggleLog = useStore((s) => s.toggleLog);
  const setError = useStore((s) => s.setError);

  useEffect(() => {
    void init();
    const unlisten = onGitCommand(pushCommand);
    return () => {
      void unlisten.then((f) => f());
    };
  }, [init, pushCommand]);

  const refreshStatuses = useStore((s) => s.refreshStatuses);
  const refreshRepos = useStore((s) => s.refreshRepos);
  const reloadLog = useStore((s) => s.reloadLog);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "`" && e.ctrlKey) {
        e.preventDefault();
        toggleLog();
      }
      // F5 reloads whatever is on screen: the repo graph and statuses, or the dashboard.
      if (e.key === "F5") {
        e.preventDefault();
        if (useStore.getState().current) void reloadLog();
        else void refreshRepos();
      }
    };
    // Coming back to the window is the cheap moment to re-check working trees.
    const onFocus = () => refreshStatuses();
    window.addEventListener("keydown", onKey);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("focus", onFocus);
    };
  }, [toggleLog, reloadLog, refreshRepos, refreshStatuses]);

  return (
    <div className="app">
      <div className="app-main">{screen.kind === "dashboard" ? <Dashboard /> : <RepoView />}</div>
      {logOpen && <CommandLog />}
      {notice && !error && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button className="btn btn-ghost" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {error && (
        <div className="toast toast-error" role="alert">
          <span>{error}</span>
          <button className="btn btn-ghost" onClick={() => setError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
