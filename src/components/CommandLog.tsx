import { useCallback, useEffect, useRef, useState } from "react";
import type { CommandRecord } from "../api";
import { useStore } from "../store";

/** Read-only plumbing the UI runs constantly; hidden unless verbose. */
const QUIET_HIDDEN = new Set(["log", "status", "diff", "diff-tree", "show", "rev-list", "rev-parse", "for-each-ref", "worktree", "remote", "ls-files", "cat-file"]);

function isNoise(r: CommandRecord): boolean {
  const sub = r.args[0];
  return QUIET_HIDDEN.has(sub) && r.exitCode === 0;
}

function readHeight(): number {
  try {
    return Number(localStorage.getItem("cmdlog:height")) || 220;
  } catch {
    return 220;
  }
}

/**
 * Transparent log of every git invocation, like Git Extensions' command log.
 * Quiet by default: only commands that change something, talk to the network,
 * or failed. Verbose shows everything. Drag the top edge to resize.
 */
export function CommandLog() {
  const log = useStore((s) => s.commandLog);
  const toggle = useStore((s) => s.toggleLog);
  const [open, setOpen] = useState<number | null>(null);
  const [verbose, setVerbose] = useState(() => localStorage.getItem("cmdlog:verbose") === "1");
  const [height, setHeight] = useState(readHeight);
  const dragging = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, []);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      setHeight(Math.max(80, Math.min(window.innerHeight - 160, window.innerHeight - e.clientY)));
    };
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      setHeight((h) => {
        try {
          localStorage.setItem("cmdlog:height", String(h));
        } catch {
          // ignore
        }
        return h;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  const setVerb = (v: boolean) => {
    setVerbose(v);
    localStorage.setItem("cmdlog:verbose", v ? "1" : "0");
  };

  const shown = verbose ? log : log.filter((r) => !isNoise(r));

  return (
    <section className="cmdlog" aria-label="Git command log" style={{ height }}>
      <div className="cmdlog-grip" onPointerDown={onPointerDown} role="separator" aria-orientation="horizontal" title="Drag to resize" />
      <header className="cmdlog-head">
        <span className="cmdlog-title">git command log</span>
        <span className="muted">
          {shown.length}
          {!verbose && log.length !== shown.length ? ` of ${log.length}` : ""} · ctrl+`
        </span>
        <label className="check muted" title="Also show read-only commands (log, status, diff, …)">
          <input type="checkbox" checked={verbose} onChange={(e) => setVerb(e.target.checked)} /> verbose
        </label>
        <button className="btn btn-ghost" onClick={toggle} aria-label="Close log">
          ×
        </button>
      </header>
      <div className="cmdlog-body">
        {[...shown].reverse().map((r) => {
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
        {shown.length === 0 && <div className="muted pad">{verbose ? "No commands yet." : "No commands that changed anything yet. Tick verbose to see read-only ones."}</div>}
      </div>
    </section>
  );
}
