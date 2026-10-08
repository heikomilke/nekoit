import type { SelectedLineRange } from "@pierre/diffs/react";
import { Check, Columns2, Rows3 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type StatusEntry } from "../api";
import { buildPartialPatch, keepRows, parseUnifiedDiff, rowFor } from "../diff/unified";
import { useStore } from "../store";
import { basename, dirname, errorMessage } from "../util/format";
import { useDarkTheme } from "../util/theme";
import { PatchView, type DiffStyle } from "./DiffView";
import { ErrorBoundary } from "./ErrorBoundary";
import { SplitPane } from "./SplitPane";

type Side = "unstaged" | "staged";

interface Pick {
  side: Side;
  path: string;
}

/**
 * Working changes of the active worktree: unstaged and staged lists, the diff
 * of the focused file, and the commit box. Keyboard first:
 *   s / u     stage / unstage the focused file, or only the selected diff lines
 *   a         stage everything
 *   tab       switch between the two lists
 *   ctrl+enter commit
 */
export function ChangesPane() {
  const current = useStore((s) => s.current);
  const refreshStatus = useStore((s) => s.refreshStatus);
  const reloadLog = useStore((s) => s.reloadLog);
  const setError = useStore((s) => s.setError);
  const dark = useDarkTheme();
  const wt = current?.worktree ?? null;
  const status = wt ? current?.statuses[wt.path] : undefined;

  const [pick, setPick] = useState<Pick | null>(null);
  const [patch, setPatch] = useState("");
  const [range, setRange] = useState<SelectedLineRange | null>(null);
  const [diffStyle, setDiffStyle] = useState<DiffStyle>(() => (localStorage.getItem("diffStyle") as DiffStyle) || "unified");
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const messageBox = useRef<HTMLTextAreaElement>(null);

  const unstaged = useMemo(() => (status?.entries ?? []).filter((e) => e.worktree !== "." || e.untracked || e.unmerged), [status]);
  const staged = useMemo(() => (status?.entries ?? []).filter((e) => e.index !== "." && !e.untracked && !e.unmerged), [status]);
  const entry = pick ? (pick.side === "unstaged" ? unstaged : staged).find((e) => e.path === pick.path) : undefined;

  // Keep a sensible pick when the lists change under us.
  useEffect(() => {
    if (entry) return;
    const first = unstaged[0] ? { side: "unstaged" as Side, path: unstaged[0].path } : staged[0] ? { side: "staged" as Side, path: staged[0].path } : null;
    setPick(first);
  }, [entry, unstaged, staged]);

  // Load the diff for the pick.
  useEffect(() => {
    setRange(null);
    if (!wt || !pick || !entry) {
      setPatch("");
      return;
    }
    let live = true;
    api
      .worktreePatch(wt.path, pick.path, pick.side === "staged", entry.untracked)
      .then((p) => live && setPatch(p))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [wt, pick, entry, setError]);

  const parsed = useMemo(() => parseUnifiedDiff(patch)[0], [patch]);

  const refresh = useCallback(async () => {
    if (wt) await refreshStatus(wt.path);
  }, [wt, refreshStatus]);

  /** Stage or unstage the focused file, or just the selected lines when a range is active. */
  const move = useCallback(
    async (toStaged: boolean) => {
      if (!wt || !pick || !entry || busy) return;
      if (pick.side === (toStaged ? "staged" : "unstaged")) return;
      setBusy(true);
      try {
        if (range && parsed && !entry.untracked) {
          const from = rowFor(parsed, range.start, range.side ?? "additions");
          const to = rowFor(parsed, range.end, range.endSide ?? range.side ?? "additions");
          if (from !== null && to !== null) {
            const partial = buildPartialPatch(parsed, keepRows(from, to), !toStaged);
            if (partial) await api.applyToIndex(wt.path, partial, !toStaged);
            await refresh();
            // Re-fetch the diff for the same file so the user can keep picking lines.
            const p = await api.worktreePatch(wt.path, pick.path, pick.side === "staged", false);
            setPatch(p);
            setRange(null);
            return;
          }
        }
        if (toStaged) await api.stage(wt.path, [pick.path]);
        else await api.unstage(wt.path, [pick.path]);
        await refresh();
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [wt, pick, entry, busy, range, parsed, refresh, setError],
  );

  const stageAll = useCallback(async () => {
    if (!wt || unstaged.length === 0) return;
    setBusy(true);
    try {
      await api.stage(wt.path, unstaged.map((e) => e.path));
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [wt, unstaged, refresh, setError]);

  const doCommit = useCallback(async () => {
    if (!wt || busy) return;
    if (!message.trim() && !amend) {
      messageBox.current?.focus();
      return;
    }
    if (staged.length === 0 && !amend) {
      setError("Nothing staged.");
      return;
    }
    setBusy(true);
    try {
      await api.commit(wt.path, message, amend);
      setMessage("");
      setAmend(false);
      await refresh();
      await reloadLog();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [wt, busy, message, amend, staged.length, refresh, reloadLog, setError]);

  // Keyboard handling scoped to this pane.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const inText = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void doCommit();
        return;
      }
      if (inText) return;
      const list = pick?.side === "staged" ? staged : unstaged;
      const i = pick ? list.findIndex((x) => x.path === pick.path) : -1;
      switch (e.key) {
        case "s":
          e.preventDefault();
          void move(true);
          break;
        case "u":
          e.preventDefault();
          void move(false);
          break;
        case "a":
          e.preventDefault();
          void stageAll();
          break;
        case "Tab": {
          e.preventDefault();
          const other: Side = pick?.side === "staged" ? "unstaged" : "staged";
          const target = other === "staged" ? staged : unstaged;
          if (target[0]) setPick({ side: other, path: target[0].path });
          break;
        }
        case "ArrowDown":
        case "j":
          if (list[i + 1]) {
            e.preventDefault();
            setPick({ side: pick!.side, path: list[i + 1].path });
          }
          break;
        case "ArrowUp":
        case "k":
          if (i > 0) {
            e.preventDefault();
            setPick({ side: pick!.side, path: list[i - 1].path });
          }
          break;
        case "c":
          e.preventDefault();
          messageBox.current?.focus();
          break;
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [pick, staged, unstaged, move, stageAll, doCommit]);

  const changeStyle = (s: DiffStyle) => {
    setDiffStyle(s);
    localStorage.setItem("diffStyle", s);
  };

  if (!wt) return <div className="details-empty muted">No worktree selected.</div>;

  const lineHint = range ? (range.start === range.end ? "1 line selected" : `lines ${Math.min(range.start, range.end)}–${Math.max(range.start, range.end)} selected`) : null;

  return (
    <div className="changes" ref={root} tabIndex={0}>
      <SplitPane
        direction="horizontal"
        initial={340}
        min={200}
        storageKey="changes-files"
        className="changes-split"
        first={
          <div className="changes-lists">
            <ChangeList title="Unstaged" side="unstaged" entries={unstaged} pick={pick} onPick={setPick} action="s" onAction={() => void move(true)} />
            <ChangeList title="Staged" side="staged" entries={staged} pick={pick} onPick={setPick} action="u" onAction={() => void move(false)} />
            <div className="commit-box">
              <textarea
                ref={messageBox}
                className="commit-msg"
                placeholder={amend ? "Amend message (leave empty to keep)" : "Commit message"}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                spellCheck
              />
              <div className="commit-box-row">
                <label className="check">
                  <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} /> amend
                </label>
                <span className="muted">
                  {wt.branch ?? "detached"} · {staged.length} staged
                </span>
                <span className="spacer" />
                <button className="btn btn-primary" onClick={() => void doCommit()} disabled={busy} title="ctrl+enter">
                  <Check size={14} /> Commit
                </button>
              </div>
            </div>
          </div>
        }
        second={
          <div className="diff-pane changes-diff">
            <div className="changes-diff-head">
              <span className="mono">{pick?.path ?? ""}</span>
              <span className="muted">{lineHint ?? (pick ? "drag over line numbers to pick lines, then s / u" : "")}</span>
              <span className="spacer" />
              <button className={`btn btn-icon ${diffStyle === "unified" ? "is-active" : ""}`} onClick={() => changeStyle("unified")} title="Unified">
                <Rows3 size={14} />
              </button>
              <button className={`btn btn-icon ${diffStyle === "split" ? "is-active" : ""}`} onClick={() => changeStyle("split")} title="Side by side">
                <Columns2 size={14} />
              </button>
            </div>
            <ErrorBoundary resetKey={patch}>
              {pick && <PatchView dark={dark} diffStyle={diffStyle} patch={patch} enableLineSelection={!entry?.untracked} selectedLines={range} onLineSelected={setRange} />}
            </ErrorBoundary>
          </div>
        }
      />
    </div>
  );
}

function ChangeList({
  title,
  side,
  entries,
  pick,
  onPick,
  action,
  onAction,
}: {
  title: string;
  side: Side;
  entries: StatusEntry[];
  pick: Pick | null;
  onPick(p: Pick): void;
  action: string;
  onAction(): void;
}) {
  return (
    <div className="change-list" role="listbox" aria-label={title}>
      <div className="pane-title">
        {title} <span className="muted">{entries.length}</span>
        <span className="muted key-hint">{action}</span>
      </div>
      {entries.map((e) => {
        const code = side === "staged" ? e.index : e.untracked ? "?" : e.unmerged ? "U" : e.worktree;
        const sel = pick?.side === side && pick.path === e.path;
        return (
          <div
            key={e.path}
            role="option"
            aria-selected={sel}
            className={`file-row ${sel ? "is-selected" : ""}`}
            onClick={() => onPick({ side, path: e.path })}
            onDoubleClick={() => {
              onPick({ side, path: e.path });
              onAction();
            }}
            title={e.origPath ? `${e.origPath} → ${e.path}` : e.path}
          >
            <span className={`status status-${code === "?" ? "A" : code}`}>{code === "?" ? "+" : code}</span>
            <span className="file-name">{basename(e.path)}</span>
            <span className="file-dir muted">{dirname(e.path)}</span>
          </div>
        );
      })}
      {entries.length === 0 && <div className="muted pad">nothing</div>}
    </div>
  );
}
