import type { SelectedLineRange } from "@pierre/diffs/react";
import { ArrowLeftRight, Cherry, ChevronDown, ChevronRight, Columns2, Files, Rows3, Undo2, UnfoldVertical } from "lucide-react";
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
import { DiffMarks, DiffNavButtons, useDiffNav } from "./DiffNav";
import { FileList } from "./FileList";
import { SplitPane } from "./SplitPane";

/**
 * Bottom pane: what the selection means.
 *  - one commit   → its message, metadata, changed files, diff vs first parent
 *  - two commits  → changed files and diff between them (first picked → second picked)
 *  - two files    → ad-hoc diff between those two files at the shown revision
 */
export function CommitDetailsPane() {
  const current = useStore((s) => s.current);
  const setError = useStore((s) => s.setError);
  const dark = useDarkTheme();
  const [diffStyle, setDiffStyle] = useState<DiffStyle>(() => (localStorage.getItem("diffStyle") as DiffStyle) || "unified");
  /** Show whole files instead of hunks; display only, revert/cherry-pick still use normal patches. */
  const [fullDiff, setFullDiff] = useState(() => localStorage.getItem("diffFull") === "1");
  const diffWrap = useRef<HTMLDivElement>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [files, setFiles] = useState<FileChange[]>([]);
  const filesRef = useRef<FileChange[]>([]);
  filesRef.current = files;
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [patch, setPatch] = useState<string>("");
  const [pair, setPair] = useState<{ a: string; b: string; aText: string; bText: string } | null>(null);
  const nav = useDiffNav(pair ? "" : patch, diffWrap);
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

  // Range: the commit picked first is the base, the second one the target
  // (the store keeps the newest pick in front), so the diff reads in pick order.
  const range = useMemo(() => {
    if (selected.length !== 2) return null;
    const [second, first] = selected;
    return { base: first, target: second };
  }, [selected]);
  const swapRange = useCallback(() => {
    if (selected.length !== 2) return;
    select(selected[1], false);
    select(selected[0], true);
  }, [selected, select]);
  const single = selected.length === 1 ? selected[0] : null;
  const target = range?.target ?? single;

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
          // Start on the first file: one diff to highlight instead of the whole commit.
          setSelectedFiles(f.length ? [f[0].path] : []);
        } else if (single) {
          const [d, f] = await Promise.all([api.commitDetails(repoDir, single), api.commitChanges(repoDir, single)]);
          if (!live) return;
          setDetails(d);
          setFiles(f);
          setSelectedFiles(f.length ? [f[0].path] : []);
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
    // Wait for the file list: it decides the initial file, so fetching earlier would diff the whole commit for nothing.
    if (!repoDir || !target || loading) return;
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
        const p = range ? await api.rangePatch(repoDir, range.base, range.target, path, fullDiff) : await api.commitPatch(repoDir, target, path, fullDiff);
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
  }, [repoDir, target, range, selectionKey, fullDiff, loading, setError]);

  /**
   * Apply the shown change into the active worktree as a staged pending change:
   * the file's patch (or only the selected lines, or the whole commit), in
   * reverse for a revert or forward for a cherry-pick. Armed on the first key
   * press, executed on the second.
   */
  const applyFromCommit = useCallback(async (reverse: boolean) => {
    const wt = current?.worktree;
    if (!wt || !target || busy || pair) return;
    const path = selectedFiles.length === 1 ? selectedFiles[0] : null;
    const lines = !!lineRange && !!path;
    const verb = reverse ? "revert" : "pick";
    const key = `${verb}:${target}:${path ?? "*"}:${lines ? `${lineRange.start}-${lineRange.end}` : ""}`;
    if (armed !== key) {
      setArmed(key);
      setTimeout(() => setArmed((a) => (a === key ? null : a)), 3000);
      return;
    }
    setArmed(null);
    setBusy(true);
    try {
      // Fetch the patch for exactly what is selected right now; never trust the
      // displayed patch state, which may still be loading for a freshly picked file.
      let toApply = range
        ? await api.rangePatch(repoDir, range.base, range.target, path ?? undefined)
        : await api.commitPatch(repoDir, target, path ?? undefined);
      const files = parseUnifiedDiff(toApply);
      if (path && files.length !== 1) throw new Error(`expected one file in the patch for ${path}, got ${files.length}`);
      if (lines) {
        const single = files[0];
        const from = rowFor(single, lineRange.start, lineRange.side ?? "additions", "down");
        const to = rowFor(single, lineRange.end, lineRange.endSide ?? lineRange.side ?? "additions", "up");
        if (from === null || to === null) return;
        // Reverse needs a patch whose new side matches the target file; forward needs the old side.
        const partial = buildPartialPatch(single, keepRows(from, to), reverse);
        if (!partial) return;
        toApply = partial;
      }
      // Apply to the working tree and the index, so the result is already staged.
      await api.applyToWorktree(wt.path, toApply, reverse, true);
      const what = lines ? `part of ${path}` : path ?? "all changes";
      setNotice(`${reverse ? "reverted" : "cherry-picked"} ${what} into ${wt.name}, staged`);
      setLineRange(null);
      await refreshStatus(wt.path);
      // Hand over to the working-changes view with a ready-made message; ctrl+enter finishes it.
      const subject = details?.subject ?? target.slice(0, 8);
      setCommitDraft(
        reverse
          ? `Revert ${what} from "${subject}"\n\nThis reverts ${what} of commit ${target}.\n`
          : path || lines
            ? `${subject}\n\nCherry-picked ${what} of commit ${target}.\n`
            : `${subject}\n\n(cherry picked from commit ${target})\n`,
      );
      select(WORKDIR, false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [current?.worktree, target, busy, pair, selectedFiles, range, repoDir, lineRange, armed, refreshStatus, setNotice, setError, setCommitDraft, select, details?.subject]);

  const revert = useCallback(() => applyFromCommit(true), [applyFromCommit]);
  const pick = useCallback(() => applyFromCommit(false), [applyFromCommit]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "r" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        void revert();
      }
      if (e.key === "p" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        void pick();
      }
      if ((e.key === "n" || e.key === "N" || e.key === "b") && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (e.key === "n") nav.next();
        else nav.prev();
      }
      if (e.key === "Escape" && (armed || lineRange)) {
        e.stopPropagation();
        setArmed(null);
        setLineRange(null);
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [revert, pick, armed, lineRange, nav]);

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
            <span className="muted"> · from the first picked commit to the second</span>
            <button className="btn btn-ghost btn-icon" onClick={swapRange} title="Swap direction">
              <ArrowLeftRight size={13} />
            </button>
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
            {armed.startsWith("revert") ? "revert" : "cherry-pick"} {lineRange && selectedFiles.length === 1 ? "selected lines of " : ""}
            {selectedFiles.length === 1 ? selectedFiles[0].split("/").pop() : "the whole commit"} into {current.worktree?.name}? press {armed.startsWith("revert") ? "r" : "p"} again, Esc to cancel
          </span>
        ) : lineRange && selectedFiles.length === 1 ? (
          <span className="sel-pill">
            <span className="sel-dot" />
            lines {Math.min(lineRange.start, lineRange.end)}–{Math.max(lineRange.start, lineRange.end)} selected
            <span className="sel-keys">p p cherry-pick · r r revert into {current.worktree?.name} · Esc clear</span>
          </span>
        ) : null}
        <button
          className={`btn btn-icon ${selectedFiles.length === 0 && files.length > 0 ? "is-active" : ""}`}
          onClick={() => setSelectedFiles((cur) => (cur.length === 0 ? (files.length ? [files[0].path] : []) : []))}
          disabled={files.length < 2}
          title={selectedFiles.length === 0 ? "Showing all files; click to show one file" : `Show all ${files.length} files in one diff (slower on big commits)`}
        >
          <Files size={14} />
        </button>
        <button
          className="btn btn-icon"
          onClick={() => void pick()}
          disabled={!current.worktree || busy || !!pair}
          title={`Cherry-pick ${selectedFiles.length === 1 ? "this file's change" : "this commit"} into the working tree of ${current.worktree?.name ?? "…"}, staged (p p)`}
        >
          <Cherry size={14} />
        </button>
        <button
          className="btn btn-icon"
          onClick={() => void revert()}
          disabled={!current.worktree || busy || !!pair}
          title={`Revert ${selectedFiles.length === 1 ? "this file's change" : "this commit"} into the working tree of ${current.worktree?.name ?? "…"}, staged (r r)`}
        >
          <Undo2 size={14} />
        </button>
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
          <div className="diff-pane diff-wrap" ref={diffWrap}>
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
            {fullDiff && !pair && <DiffMarks nav={nav} />}
          </div>
        }
      />
    </div>
  );
}
