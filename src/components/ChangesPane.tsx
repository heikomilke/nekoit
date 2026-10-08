import type { SelectedLineRange } from "@pierre/diffs/react";
import { Check, Columns2, Rows3, UnfoldVertical } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type StatusEntry } from "../api";
import { buildPartialPatch, keepRows, parseUnifiedDiff, rowFor, type DiffFile } from "../diff/unified";
import type { SelectedLineRange as Range } from "@pierre/diffs/react";
import { useStore } from "../store";
import { ignoreSuggestions } from "../util/ignore";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { basename, dirname, errorMessage } from "../util/format";
import { useDarkTheme } from "../util/theme";
import { PatchView, type DiffStyle } from "./DiffView";
import { DiffMarks, DiffNavButtons, useDiffNav } from "./DiffNav";
import { FilterBox, usePathFilter } from "./FilterBox";
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
 *   i         add the focused file to .gitignore (right-click for folder / extension)
 *   r r       discard the focused file's changes, or only the selected lines (second press confirms)
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
  /** Show whole files instead of hunks; display only, actions still use normal patches. */
  const [fullDiff, setFullDiff] = useState(() => localStorage.getItem("diffFull") === "1");
  const diffWrap = useRef<HTMLDivElement>(null);
  const nav = useDiffNav(patch, diffWrap);
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: StatusEntry; side: Side } | null>(null);
  /** Path armed for discard; a second `r` within a few seconds confirms. */
  const [armed, setArmed] = useState<string | null>(null);
  const setNotice = useStore((s) => s.setNotice);
  const commitDraft = useStore((s) => s.commitDraft);
  const setCommitDraft = useStore((s) => s.setCommitDraft);
  useEffect(() => {
    if (commitDraft !== null) {
      setMessage(commitDraft);
      setCommitDraft(null);
      messageBox.current?.focus();
    }
  }, [commitDraft, setCommitDraft]);
  const root = useRef<HTMLDivElement>(null);
  const messageBox = useRef<HTMLTextAreaElement>(null);

  const [query, setQuery] = useState("");
  const matches = usePathFilter(query);
  const unstaged = useMemo(() => (status?.entries ?? []).filter((e) => (e.worktree !== "." || e.untracked || e.unmerged) && matches(e.path)), [status, matches]);
  const staged = useMemo(() => (status?.entries ?? []).filter((e) => e.index !== "." && !e.untracked && !e.unmerged 
 && matches(e.path)), [status, matches]);
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
      .worktreePatch(wt.path, pick.path, pick.side === "staged", entry.untracked, fullDiff)
      .then((p) => live && setPatch(p))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [wt, pick, entry, fullDiff, setError]);

  const parsed = useMemo(() => parseUnifiedDiff(patch)[0], [patch]);

  const refresh = useCallback(async () => {
    if (wt) await refreshStatus(wt.path);
  }, [wt, refreshStatus]);

  /**
   * The diff to build a partial patch from. An untracked file first gets an
   * intent-to-add entry so git produces a real new-file diff; its line numbers
   * match the /dev/null diff shown so far, so the selection stays valid.
   */
  const diffForPartial = useCallback(async (): Promise<DiffFile | undefined> => {
    if (!wt || !pick || !entry) return undefined;
    if (!entry.untracked) return parsed;
    await api.intentToAdd(wt.path, [entry.path]);
    const p = await api.worktreePatch(wt.path, entry.path, false, false);
    return parseUnifiedDiff(p)[0];
  }, [wt, pick, entry, parsed]);

  /** Stage or unstage the focused file, or just the selected lines when a range is active. */
  const move = useCallback(
    async (toStaged: boolean) => {
      if (!wt || !pick || !entry || busy) return;
      if (pick.side === (toStaged ? "staged" : "unstaged")) return;
      setBusy(true);
      try {
        if (range && parsed) {
          const file = await diffForPartial();
          const from = file ? rowFor(file, range.start, range.side ?? "additions", "down") : null;
          const to = file ? rowFor(file, range.end, range.endSide ?? range.side ?? "additions", "up") : null;
          if (file && from !== null && to !== null) {
            const partial = buildPartialPatch(file, keepRows(from, to), !toStaged);
            if (partial) await api.applyToIndex(wt.path, partial, !toStaged);
            await refresh();
            // Re-fetch the diff for the same file so the user can keep picking lines.
            const p = await api.worktreePatch(wt.path, pick.path, pick.side === "staged", false, fullDiff);
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
    [wt, pick, entry, busy, range, parsed, refresh, setError, diffForPartial],
  );

  /** Append a pattern to .gitignore, open it in the editor, refresh when the editor returns. */
  const ignore = useCallback(
    async (pattern: string) => {
      if (!wt) return;
      try {
        const file = await api.addToGitignore(wt.path, pattern, true);
        setNotice(`added ${pattern} to ${file.replace(wt.path + "/", "")}`);
        await refresh();
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [wt, refresh, setError, setNotice],
  );

  /**
   * Discard the focused file's working changes (and index changes when picked
   * from Staged), or only the selected lines when a range is active on the
   * unstaged diff.
   */
  const discard = useCallback(async () => {
    if (!wt || !pick || !entry || busy) return;
    const lines = range && parsed && pick.side === "unstaged";
    const key = lines ? `${entry.path}:${range.start}-${range.end}` : entry.path;
    if (armed !== key) {
      setArmed(key);
      setTimeout(() => setArmed((a) => (a === key ? null : a)), 3000);
      return;
    }
    setArmed(null);
    setBusy(true);
    try {
      if (lines) {
        const file = await diffForPartial();
        const from = file ? rowFor(file, range.start, range.side ?? "additions", "down") : null;
        const to = file ? rowFor(file, range.end, range.endSide ?? range.side ?? "additions", "up") : null;
        if (file && from !== null && to !== null) {
          // The unstage-flavoured patch's new side matches the file on disk; reverse-apply it.
          const partial = buildPartialPatch(file, keepRows(from, to), true);
          if (partial) await api.applyToWorktree(wt.path, partial, true);
          setNotice(`discarded selected lines in ${entry.path}`);
          await refresh();
          const p = await api.worktreePatch(wt.path, pick.path, false, false);
          setPatch(p);
          setRange(null);
        }
        return;
      }
      if (pick.side === "staged" || entry.worktree === "A") await api.unstage(wt.path, [entry.path]);
      if (entry.untracked || entry.worktree === "A") await api.discard(wt.path, [], [entry.path]);
      else await api.discard(wt.path, [entry.path], []);
      setNotice(`discarded changes to ${entry.path}`);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [wt, pick, entry, busy, armed, range, parsed, refresh, setError, setNotice, diffForPartial]);

  const menuItems = useCallback(
    (entry: StatusEntry, side: Side): MenuItem[] => {
      const items: MenuItem[] = [];
      if (side === "unstaged") items.push({ label: "Stage", hint: "s", onClick: () => void move(true) });
      else items.push({ label: "Unstage", hint: "u", onClick: () => void move(false) });
      ignoreSuggestions(entry.path).forEach(([pattern, label], i) => {
        items.push({ label: `Ignore ${label}`, hint: pattern, separator: i === 0, onClick: () => void ignore(pattern) });
      });
      items.push({ label: entry.untracked ? "Delete file" : "Discard changes", hint: "r r", danger: true, separator: true, onClick: () => void discard() });
      return items;
    },
    [move, ignore, discard],
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
        case "i":
          if (entry && pick) {
            e.preventDefault();
            void ignore(ignoreSuggestions(entry.path)[0][0]);
          }
          break;
        case "r":
          e.preventDefault();
          void discard();
          break;
        case "n":
          e.preventDefault();
          nav.next();
          break;
        case "N":
          e.preventDefault();
          nav.prev();
          break;
        case "Escape":
          if (armed || range) {
            e.stopPropagation();
            setArmed(null);
            setRange(null);
          }
          break;
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [pick, staged, unstaged, move, stageAll, doCommit, entry, ignore, discard, armed, range, nav]);

  const changeStyle = (s: DiffStyle) => {
    setDiffStyle(s);
    localStorage.setItem("diffStyle", s);
  };
  const toggleFull = () => {
    setFullDiff((v) => {
      localStorage.setItem("diffFull", v ? "0" : "1");
      return !v;
    });
  };

  if (!wt) return <div className="details-empty muted">No worktree selected.</div>;

  const selectedCount = range && parsed ? countSelectedChanges(parsed, range) : 0;
  const lineHint = range ? (range.start === range.end ? `line ${range.start} selected` : `lines ${Math.min(range.start, range.end)}–${Math.max(range.start, range.end)} selected`) : null;
  const armHint =
    armed && entry && armed.startsWith(entry.path)
      ? armed.includes(":")
        ? `discard the selected lines in ${basename(entry.path)}? press r again, Esc to cancel`
        : entry.untracked || entry.worktree === "A"
          ? `delete ${basename(entry.path)}? press r again, Esc to cancel`
          : `discard changes to ${basename(entry.path)}? press r again, Esc to cancel`
      : null;

  return (
    <div className="changes" ref={root} tabIndex={0}>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.entry, menu.side)} onClose={() => setMenu(null)} />}
      <SplitPane
        direction="horizontal"
        initial={340}
        min={200}
        storageKey="changes-files"
        className="changes-split"
        first={
          <div className="changes-lists">
            <div className="changes-filter">
              <FilterBox value={query} onChange={setQuery} placeholder="filter files (regex)" />
            </div>
            <ChangeList title="Unstaged" side="unstaged" entries={unstaged} pick={pick} onPick={setPick} action="s" onAction={() => void move(true)} onMenu={(e, entry) => setMenu({ x: e.clientX, y: e.clientY, entry, side: "unstaged" })} />
            <ChangeList title="Staged" side="staged" entries={staged} pick={pick} onPick={setPick} action="u" onAction={() => void move(false)} onMenu={(e, entry) => setMenu({ x: e.clientX, y: e.clientY, entry, side: "staged" })} />
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
              {armHint ? (
                <span className="arm-hint">{armHint}</span>
              ) : range ? (
                <span className="sel-pill" title="Line selection: actions below apply to these lines only">
                  <span className="sel-dot" />
                  {lineHint} · {selectedCount} change{selectedCount === 1 ? "" : "s"}
                  <span className="sel-keys">{pick?.side === "unstaged" ? "s stage · r r discard" : "u unstage"} · Esc clear</span>
                </span>
              ) : (
                <span className="muted">{pick ? (pick.side === "unstaged" ? "whole file: s stages · r r discards · drag over line numbers to pick lines" : "whole file: u unstages · drag over line numbers to pick lines") : ""}</span>
              )}
              <span className="spacer" />
              <button className={`btn btn-icon ${diffStyle === "unified" ? "is-active" : ""}`} onClick={() => changeStyle("unified")} title="Unified">
                <Rows3 size={14} />
              </button>
              <button className={`btn btn-icon ${diffStyle === "split" ? "is-active" : ""}`} onClick={() => changeStyle("split")} title="Side by side">
                <Columns2 size={14} />
              </button>
              <button className={`btn btn-icon ${fullDiff ? "is-active" : ""}`} onClick={toggleFull} title={fullDiff ? "Showing the whole file; click for changed hunks only" : "Showing changed hunks; click for the whole file"}>
                <UnfoldVertical size={14} />
              </button>
              <DiffNavButtons nav={nav} />
            </div>
            <div className="diff-wrap" ref={diffWrap}>
              <ErrorBoundary resetKey={patch}>
                {pick && <PatchView dark={dark} diffStyle={diffStyle} patch={patch} enableLineSelection selectedLines={range} onLineSelected={setRange} />}
              </ErrorBoundary>
              {fullDiff && <DiffMarks nav={nav} />}
            </div>
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
  onMenu,
}: {
  title: string;
  side: Side;
  entries: StatusEntry[];
  pick: Pick | null;
  onPick(p: Pick): void;
  action: string;
  onAction(): void;
  onMenu(e: React.MouseEvent, entry: StatusEntry): void;
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
            onContextMenu={(ev) => {
              ev.preventDefault();
              onPick({ side, path: e.path });
              onMenu(ev, e);
            }}
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

/** Number of + / - lines inside a renderer selection. */
function countSelectedChanges(file: DiffFile, range: Range): number {
  const from = rowFor(file, range.start, range.side ?? "additions", "down");
  const to = rowFor(file, range.end, range.endSide ?? range.side ?? "additions", "up");
  if (from === null || to === null) return 0;
  const keep = keepRows(from, to);
  let n = 0;
  for (const h of file.hunks) for (const l of h.lines) if (l.kind !== "context" && keep(l)) n++;
  return n;
}
