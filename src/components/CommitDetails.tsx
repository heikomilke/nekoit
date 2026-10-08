import type { SelectedLineRange } from "@pierre/diffs/react";
import { ChevronDown, ChevronRight, Columns2, Rows3, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildPartialPatch, keepRows, parseUnifiedDiff, rowFor } from "../diff/unified";
import { api, type CommitDetails as Details, type FileChange } from "../api";
import { WORKDIR, useStore } from "../store";
import { laneColor } from "../graph/colors";
import { layoutGraph } from "../graph/layout";
import { absoluteTime, errorMessage, shortSha } from "../util/format";
import { useDarkTheme } from "../util/theme";
import { ErrorBoundary } from "./ErrorBoundary";
import { FilesView, PatchView, type DiffStyle } from "./DiffView";
import { FileList } from "./FileList";
import { SplitPane } from "./SplitPane";

/**
 * Bottom pane: what the selection means.
 *  - one commit   → its message, metadata, changed files, diff vs first parent
 *  - two commits  → changed files and diff between them (older → newer)
 *  - two files    → ad-hoc diff between those two files at the shown revision
 */
export function CommitDetailsPane() {
  const current = useStore((s) => s.current);
  const setError = useStore((s) => s.setError);
  const dark = useDarkTheme();
  const [diffStyle, setDiffStyle] = useState<DiffStyle>(() => (localStorage.getItem("diffStyle") as DiffStyle) || "unified");
  const [details, setDetails] = useState<Details | null>(null);
  const [files, setFiles] = useState<FileChange[]>([]);
  const filesRef = useRef<FileChange[]>([]);
  filesRef.current = files;
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [patch, setPatch] = useState<string>("");
  const [pair, setPair] = useState<{ a: string; b: string; aText: string; bText: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [showBody, setShowBody] = useState(false);
  const [containing, setContaining] = useState<string[]>([]);
  /** Line selection on the single-file diff, for partial reverts. */
  const [lineRange, setLineRange] = useState<SelectedLineRange | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const refreshStatus = useStore((s) => s.refreshStatus);
  const setNotice = useStore((s) => s.setNotice);
  const setCommitDraft = useStore((s) => s.setCommitDraft);
  const select = useStore((s) => s.select);

  const repoDir = current?.repo.commonDir ?? "";
  const selected = current?.selected ?? [];
  const commits = current?.commits ?? [];
  const tracks = current?.tracks;
  // Lane colour of the selected commit, so the header dot matches the graph.
  const laneColorOf = useMemo(() => {
    const rows = layoutGraph(commits).rows;
    const m = new Map<string, string>();
    commits.forEach((c, i) => m.set(c.sha, laneColor(rows[i].color)));
    return m;
  }, [commits]);

  // Range: the lower row in the list is the older commit → base.
  const range = useMemo(() => {
    if (selected.length !== 2) return null;
    const [x, y] = selected;
    const ix = commits.findIndex((c) => c.sha === x);
    const iy = commits.findIndex((c) => c.sha === y);
    return ix > iy ? { base: x, target: y } : { base: y, target: x };
  }, [selected, commits]);
  const single = selected.length === 1 ? selected[0] : null;
  const target = range?.target ?? single;

  const changeStyle = (s: DiffStyle) => {
    setDiffStyle(s);
    localStorage.setItem("diffStyle", s);
  };

  // Branches that contain the selected commit (exact, via git), loaded lazily.
  useEffect(() => {
    setContaining([]);
    if (!repoDir || !target) return;
    let live = true;
    // origin/HEAD shortens to the bare remote name; drop those.
    const remoteNames = new Set((current?.refs ?? []).filter((r) => r.kind === "remote").map((r) => r.short.split("/")[0]));
    api
      .refsContaining(repoDir, target)
      .then((r) => live && setContaining(r.filter((n) => !remoteNames.has(n))))
      .catch(() => live && setContaining([]));
    return () => {
      live = false;
    };
  }, [repoDir, target, current?.refs]);

  // Load header + file list whenever the commit selection changes.
  useEffect(() => {
    setSelectedFiles((cur) => (cur.length ? [] : cur));
    setPair(null);
    setPatch("");
    if (!repoDir || (!single && !range)) {
      setDetails(null);
      setFiles([]);
      return;
    }
    let live = true;
    setLoading(true);
    (async () => {
      try {
        if (range) {
          const [d, f] = await Promise.all([api.commitDetails(repoDir, range.target), api.changesBetween(repoDir, range.base, range.target)]);
          if (!live) return;
          setDetails(d);
          setFiles(f);
        } else if (single) {
          const [d, f] = await Promise.all([api.commitDetails(repoDir, single), api.commitChanges(repoDir, single)]);
          if (!live) return;
          setDetails(d);
          setFiles(f);
        }
      } catch (e) {
        if (live) setError(errorMessage(e));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [repoDir, single, range, setError]);

  // Load the diff for the selected file(s), or the whole commit when none is selected.
  // Keyed on a string so replacing the selection array with an equal one does not refetch.
  const selectionKey = selectedFiles.join("\0");
  useEffect(() => {
    if (!repoDir || !target) return;
    const selectedFiles = selectionKey ? selectionKey.split("\0") : [];
    let live = true;
    (async () => {
      try {
        if (selectedFiles.length === 2) {
          const [a, b] = selectedFiles;
          // A deleted file only exists on the old side of the range.
          const revFor = (path: string) => (filesRef.current.find((f) => f.path === path)?.status === "D" ? (range ? range.base : `${target}^`) : target);
          const [aText, bText] = await Promise.all([api.fileAt(repoDir, revFor(a), a), api.fileAt(repoDir, revFor(b), b)]);
          if (live) setPair({ a, b, aText, bText });
          return;
        }
        setPair(null);
        const path = selectedFiles[0];
        const p = range ? await api.rangePatch(repoDir, range.base, range.target, path) : await api.commitPatch(repoDir, target, path);
        if (live) {
          setPatch(p);
          setLineRange(null);
        }
      } catch (e) {
        if (live) setError(errorMessage(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [repoDir, target, range, selectionKey, setError]);

  /**
   * Revert the shown change into the active worktree as a pending change:
   * the file's patch (or only the selected lines) applied in reverse with
   * `git apply --reverse`. Armed on the first r, executed on the second.
   */
  const revert = useCallback(async () => {
    const wt = current?.worktree;
    if (!wt || !target || busy || pair) return;
    const path = selectedFiles.length === 1 ? selectedFiles[0] : null;
    const single = parseUnifiedDiff(patch)[0];
    const lines = !!lineRange && !!path && !!single;
    const key = `${target}:${path ?? "*"}:${lines ? `${lineRange.start}-${lineRange.end}` : ""}`;
    if (armed !== key) {
      setArmed(key);
      setTimeout(() => setArmed((a) => (a === key ? null : a)), 3000);
      return;
    }
    setArmed(null);
    setBusy(true);
    try {
      let toApply = patch;
      if (lines) {
        const from = rowFor(single, lineRange.start, lineRange.side ?? "additions");
        const to = rowFor(single, lineRange.end, lineRange.endSide ?? lineRange.side ?? "additions");
        if (from === null || to === null) return;
        const partial = buildPartialPatch(single, keepRows(from, to), true);
        if (!partial) return;
        toApply = partial;
      }
      // Reverse-apply to the working tree and the index, so the revert is already staged.
      await api.applyToWorktree(wt.path, toApply, true, true);
      setNotice(`reverted ${lines ? "selected lines of " : ""}${path ?? "the whole commit"} into ${wt.name}, staged`);
      setLineRange(null);
      await refreshStatus(wt.path);
      // Hand over to the working-changes view with a ready-made message; ctrl+enter finishes it.
      const what = lines ? `part of ${path}` : path ?? "all changes";
      setCommitDraft(`Revert ${what} from "${details?.subject ?? target.slice(0, 8)}"\n\nThis reverts ${what} of commit ${target}.\n`);
      select(WORKDIR, false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [current?.worktree, target, busy, pair, selectedFiles, patch, lineRange, armed, refreshStatus, setNotice, setError, setCommitDraft, select, details?.subject]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "r" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        void revert();
      }
      if (e.key === "Escape" && (armed || lineRange)) {
        e.stopPropagation();
        setArmed(null);
        setLineRange(null);
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [revert, armed, lineRange]);

  const onSelectFile = useCallback((path: string, extend: boolean) => {
    setSelectedFiles((cur) => {
      if (!extend) return cur.length === 1 && cur[0] === path ? [] : [path];
      if (cur.includes(path)) return cur.filter((p) => p !== path);
      return [...cur, path].slice(-2);
    });
  }, []);

  if (!current) return null;
  if (!target || !details) {
    return <div className="details-empty muted">{loading ? "loading…" : "Select a commit. Ctrl-click a second one to diff a range."}</div>;
  }

  const header = (
    <header className="details-head">
      <div className="details-subject">
        {!range && details.body && (
          <button className="btn btn-ghost btn-icon body-toggle" onClick={() => setShowBody((v) => !v)} title={showBody ? "Hide message" : "Show full message"} aria-expanded={showBody}>
            {showBody ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
        {range ? (
          <>
            <span className="mono">{shortSha(range.base)}</span> → <span className="mono">{shortSha(range.target)}</span>
            <span className="muted"> · changes between the two commits</span>
          </>
        ) : (
          details.subject
        )}
      </div>
      {!range && (
        <div className="details-meta">
          <span>{details.authorName}</span>
          <span className="muted">{details.authorEmail}</span>
          <span title="author date">{absoluteTime(details.authorTime)}</span>
          {details.committerName !== details.authorName && <span className="muted">committed by {details.committerName}</span>}
          <span className="mono muted" title={details.sha}>
            {shortSha(details.sha, 12)}
          </span>
          {details.parents.length > 1 && <span className="pill">merge</span>}
        </div>
      )}
      {!range && (tracks?.get(target) || containing.length > 0) && (
        <div className="details-branches">
          {tracks?.get(target) && (
            <span className="track" style={{ "--chip-color": laneColorOf.get(target) ?? "var(--fg-muted)" } as React.CSSProperties} title="Branch this lane belongs to (first-parent descent from the tip)">
              <span className="track-dot" />
              {tracks.get(target)}
            </span>
          )}
          {containing.length > 0 && (
            <span className="muted containing" title="Branches that contain this commit">
              in{" "}
              {containing.map((b) => (
                <span key={b} className="containing-ref">
                  {b}
                </span>
              ))}
            </span>
          )}
        </div>
      )}
      {!range && details.body && showBody && <pre className="details-body">{details.body}</pre>}
      <div className="details-tools">
        {armed ? (
          <span className="arm-hint">
            revert {lineRange && selectedFiles.length === 1 ? "selected lines of " : ""}
            {selectedFiles.length === 1 ? selectedFiles[0].split("/").pop() : "the whole commit"} into {current.worktree?.name}? press r again, Esc to cancel
          </span>
        ) : lineRange && selectedFiles.length === 1 ? (
          <span className="sel-pill">
            <span className="sel-dot" />
            lines {Math.min(lineRange.start, lineRange.end)}–{Math.max(lineRange.start, lineRange.end)} selected
            <span className="sel-keys">r r revert into {current.worktree?.name} · Esc clear</span>
          </span>
        ) : null}
        <button
          className="btn btn-icon"
          onClick={() => void revert()}
          disabled={!current.worktree || busy || !!pair}
          title={`Revert ${selectedFiles.length === 1 ? "this file's change" : "this commit"} into the working tree of ${current.worktree?.name ?? "…"} as a pending change (r r)`}
        >
          <Undo2 size={14} />
        </button>
        <button className={`btn btn-icon ${diffStyle === "unified" ? "is-active" : ""}`} onClick={() => changeStyle("unified")} title="Unified">
          <Rows3 size={14} />
        </button>
        <button className={`btn btn-icon ${diffStyle === "split" ? "is-active" : ""}`} onClick={() => changeStyle("split")} title="Side by side">
          <Columns2 size={14} />
        </button>
      </div>
    </header>
  );

  return (
    <div className="details" ref={rootRef} tabIndex={0}>
      {header}
      <SplitPane
        direction="horizontal"
        initial={320}
        min={180}
        storageKey="details-files"
        className="details-split"
        first={<FileList files={files} selected={selectedFiles} onSelect={onSelectFile} title={range ? "Changed between" : "Changed files"} />}
        second={
          <div className="diff-pane">
            <ErrorBoundary resetKey={pair ?? patch}>
              {pair ? (
                <FilesView dark={dark} diffStyle={diffStyle} oldName={pair.a} oldContents={pair.aText} newName={pair.b} newContents={pair.bText} />
              ) : (
                <PatchView
                  dark={dark}
                  diffStyle={diffStyle}
                  patch={patch}
                  enableLineSelection={selectedFiles.length === 1}
                  selectedLines={lineRange}
                  onLineSelected={setLineRange}
                />
              )}
            </ErrorBoundary>
          </div>
        }
      />
    </div>
  );
}
