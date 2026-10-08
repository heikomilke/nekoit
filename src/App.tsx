import { useEffect } from "react";
import { onGitCommand } from "./api";
import { CommandLog } from "./components/CommandLog";
import { Dashboard } from "./screens/Dashboard";
import { RepoView } from "./screens/RepoView";
import { useStore } from "./store";

export default function App() {
  const screen = useStore((s) => s.screen);
  const error = useStore((s) => s.error);
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "`" && e.ctrlKey) {
        e.preventDefault();
        toggleLog();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleLog]);

  return (
    <div className="app">
      <div className="app-main">{screen.kind === "dashboard" ? <Dashboard /> : <RepoView />}</div>
      {logOpen && <CommandLog />}
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
