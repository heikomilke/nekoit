import { Columns2, Rows3 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type CommitDetails as Details, type FileChange } from "../api";
import { useStore } from "../store";
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
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [patch, setPatch] = useState<string>("");
  const [pair, setPair] = useState<{ a: string; b: string; aText: string; bText: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const repoDir = current?.repo.commonDir ?? "";
  const selected = current?.selected ?? [];
  const commits = current?.commits ?? [];

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

  // Load header + file list whenever the commit selection changes.
  useEffect(() => {
    setSelectedFiles([]);
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
  useEffect(() => {
    if (!repoDir || !target) return;
    let live = true;
    (async () => {
      try {
        if (selectedFiles.length === 2) {
          const [a, b] = selectedFiles;
          const [aText, bText] = await Promise.all([api.fileAt(repoDir, target, a), api.fileAt(repoDir, target, b)]);
          if (live) setPair({ a, b, aText, bText });
          return;
        }
        setPair(null);
        const path = selectedFiles[0];
        const p = range ? await api.rangePatch(repoDir, range.base, range.target, path) : await api.commitPatch(repoDir, target, path);
        if (live) setPatch(p);
      } catch (e) {
        if (live) setError(errorMessage(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [repoDir, target, range, selectedFiles, setError]);

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
      {!range && details.body && <pre className="details-body">{details.body}</pre>}
      <div className="details-tools">
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
    <div className="details">
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
                <PatchView dark={dark} diffStyle={diffStyle} patch={patch} />
              )}
            </ErrorBoundary>
          </div>
        }
      />
    </div>
  );
}
