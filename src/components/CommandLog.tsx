import { useState } from "react";
import { useStore } from "../store";

/** Transparent log of every git invocation, like Git Extensions' command log. */
export function CommandLog() {
  const log = useStore((s) => s.commandLog);
  const toggle = useStore((s) => s.toggleLog);
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section className="cmdlog" aria-label="Git command log">
      <header className="cmdlog-head">
        <span className="cmdlog-title">git command log</span>
        <span className="muted">{log.length} commands · ctrl+`</span>
        <button className="btn btn-ghost" onClick={toggle} aria-label="Close log">
          ×
        </button>
      </header>
      <div className="cmdlog-body">
        {[...log].reverse().map((r) => {
          const failed = r.exitCode !== 0;
          return (
            <div key={r.id} className={`cmdlog-row ${failed ? "is-failed" : ""}`} onClick={() => setOpen(open === r.id ? null : r.id)}>
              <span className="cmdlog-ms">{r.durationMs}ms</span>
              <code className="cmdlog-cmd">git {r.args.join(" ")}</code>
              <span className="cmdlog-cwd muted" title={r.cwd}>
                {r.cwd}
              </span>
              {failed && <span className="pill pill-danger">exit {r.exitCode ?? "?"}</span>}
              {open === r.id && r.stderr && <pre className="cmdlog-stderr">{r.stderr}</pre>}
            </div>
          );
        })}
        {log.length === 0 && <div className="muted pad">No commands yet.</div>}
      </div>
    </section>
  );
}
