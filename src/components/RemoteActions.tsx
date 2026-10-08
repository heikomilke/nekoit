import { ChevronDown, CloudDownload, Download, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type PullMode, type RemoteResult } from "../api";
import { useStore } from "../store";
import { errorMessage } from "../util/format";

type Op = "fetch" | "pull" | "push";

/** Fetch / Pull ▾ / Push ▾ for the active worktree. Network work runs off the UI thread; the button spins meanwhile. */
export function RemoteActions() {
  const current = useStore((s) => s.current);
  const reloadLog = useStore((s) => s.reloadLog);
  const setError = useStore((s) => s.setError);
  const setNotice = useStore((s) => s.setNotice);
  const [busy, setBusy] = useState<Op | null>(null);
  if (!current) return null;
  const { repo, worktree, statuses } = current;
  const st = worktree ? statuses[worktree.path] : undefined;
  const upstream = st?.branch.upstream ?? null;
  const branch = worktree?.branch ?? null;

  const run = async (op: Op, task: () => Promise<RemoteResult>, label: string) => {
    if (busy) return;
    setBusy(op);
    const before = useStore.getState().commandLog.length;
    try {
      const r = await task();
      const text = (r.stderr.trim() || r.stdout.trim()).split("\n").filter((l) => !l.startsWith("From ") && !l.startsWith("To ")).slice(-2).join(" · ");
      // The exact command git ran is the first log entry recorded since we started.
      const ran = useStore.getState().commandLog[before];
      const cmd = ran ? `git ${ran.args.filter((a) => a !== "--no-progress").join(" ")}` : label;
      setNotice(`${cmd} → ${text || "done"}`);
      await reloadLog();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const pull = (mode: PullMode) => {
    if (!worktree) return;
    const label = mode === "rebase" ? "Pull (rebase)" : mode === "ff-only" ? "Pull (fast-forward)" : "Pull (merge)";
    void run("pull", () => api.pull(worktree.path, mode), label);
  };
  const push = (opts: { setUpstream?: boolean; forceWithLease?: boolean }) => {
    if (!worktree) return;
    const remote = opts.setUpstream ? "origin" : null;
    const label = opts.forceWithLease ? "Force push (with lease)" : opts.setUpstream ? "Push (set upstream)" : "Push";
    void run("push", () => api.push(worktree.path, { ...opts, remote, branch: opts.setUpstream ? branch : null }), label);
  };

  const wtHint = worktree ? `${worktree.name} · ${branch ?? "detached"}${upstream ? ` → ${upstream}` : " (no upstream)"}` : "no worktree";

  return (
    <div className="remote-actions">
      <button className="btn" disabled={!!busy} onClick={() => void run("fetch", () => api.fetch(repo.commonDir, null, true), "Fetch")} title="git fetch --all --prune">
        <CloudDownload size={14} className={busy === "fetch" ? "spin" : ""} /> Fetch
      </button>
      <Menu
        disabled={!worktree || !!busy}
        label={
          <>
            <Download size={14} className={busy === "pull" ? "spin" : ""} /> Pull
          </>
        }
        title={`Pull into ${wtHint}`}
        items={[
          { label: "Pull with merge", hint: "git pull --no-rebase", onClick: () => pull("merge") },
          { label: "Pull with rebase", hint: "git pull --rebase", onClick: () => pull("rebase") },
          { label: "Fast-forward only", hint: "git pull --ff-only", onClick: () => pull("ff-only") },
        ]}
      />
      <Menu
        disabled={!worktree || !!busy || !branch}
        label={
          <>
            <Upload size={14} className={busy === "push" ? "spin" : ""} /> Push
          </>
        }
        title={`Push ${wtHint}`}
        items={[
          { label: "Push", hint: upstream ? `to ${upstream}` : "needs an upstream", onClick: () => push({}), disabled: !upstream },
          { label: "Push and set upstream", hint: `origin/${branch ?? ""}`, onClick: () => push({ setUpstream: true }) },
          { label: "Force push with lease", hint: "git push --force-with-lease", onClick: () => push({ forceWithLease: true }), danger: true, disabled: !upstream },
        ]}
      />
    </div>
  );
}

interface Item {
  label: string;
  hint?: string;
  onClick(): void;
  disabled?: boolean;
  danger?: boolean;
}

function Menu({ label, items, disabled, title }: { label: ReactNode; items: Item[]; disabled?: boolean; title?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="menu" ref={root}>
      <button className={`btn ${open ? "is-active" : ""}`} disabled={disabled} onClick={() => setOpen((v) => !v)} title={title} aria-haspopup="menu" aria-expanded={open}>
        {label} <ChevronDown size={12} />
      </button>
      {open && (
        <div className="menu-popup" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              className={`menu-item ${it.danger ? "is-danger" : ""}`}
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              <span>{it.label}</span>
              {it.hint && <span className="menu-hint">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
