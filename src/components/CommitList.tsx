import { useVirtualizer } from "@tanstack/react-virtual";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { Commit } from "../api";
import { GraphCell, LANE_WIDTH } from "../graph/GraphCell";
import { laneColor } from "../graph/colors";
import { layoutGraph } from "../graph/layout";
import { RefChips } from "./RefChips";
import { useStore } from "../store";
import { relativeTime, shortSha } from "../util/format";

export const ROW_HEIGHT = 26;

export interface CommitListHandle {
  scrollTo(sha: string): void;
}

interface Props {
  onLayout(colorBySha: Map<string, number>): void;
}

export const CommitList = forwardRef<CommitListHandle, Props>(function CommitList({ onLayout }, ref) {
  const current = useStore((s) => s.current);
  const select = useStore((s) => s.select);
  const loadMore = useStore((s) => s.loadMore);
  const commits = current?.commits ?? [];
  const parent = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => layoutGraph(commits), [commits]);
  const indexBySha = useMemo(() => new Map(commits.map((c, i) => [c.sha, i])), [commits]);

  useEffect(() => {
    const m = new Map<string, number>();
    commits.forEach((c, i) => m.set(c.sha, layout.rows[i].color));
    onLayout(m);
  }, [commits, layout, onLayout]);

  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => parent.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  useImperativeHandle(ref, () => ({
    scrollTo(sha) {
      const i = indexBySha.get(sha);
      if (i !== undefined) {
        virtualizer.scrollToIndex(i, { align: "center" });
        select(sha, false);
      }
    },
  }));

  // Load the next page when the user nears the end.
  const items = virtualizer.getVirtualItems();
  useEffect(() => {
    const last = items[items.length - 1];
    if (last && last.index >= commits.length - 50 && current?.hasMore && !current.loadingLog) void loadMore();
  }, [items, commits.length, current?.hasMore, current?.loadingLog, loadMore]);

  // Keyboard navigation: arrows / j k move the primary selection.
  useEffect(() => {
    const el = parent.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (!current) return;
      const sel = current.selected[0];
      const i = sel ? (indexBySha.get(sel) ?? -1) : -1;
      let next: number | null = null;
      if (e.key === "ArrowDown" || e.key === "j") next = Math.min(commits.length - 1, i + 1);
      if (e.key === "ArrowUp" || e.key === "k") next = Math.max(0, i - 1);
      if (e.key === "Home") next = 0;
      if (e.key === "End") next = commits.length - 1;
      if (next === null || next === i) return;
      e.preventDefault();
      select(commits[next].sha, e.shiftKey);
      virtualizer.scrollToIndex(next, { align: "auto" });
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [commits, current, indexBySha, select, virtualizer]);

  if (!current) return null;
  const { refsBySha, worktreesBySha, worktree, selected } = current;
  const graphWidth = layout.maxLanes * LANE_WIDTH;

  return (
    <div ref={parent} className="commit-list" tabIndex={0} role="listbox" aria-label="Commits">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {items.map((v) => {
          const c: Commit = commits[v.index];
          const row = layout.rows[v.index];
          const isSel = selected.includes(c.sha);
          const wts = worktreesBySha.get(c.sha);
          return (
            <div
              key={c.sha}
              role="option"
              aria-selected={isSel}
              className={`commit-row ${isSel ? "is-selected" : ""} ${selected[0] === c.sha ? "is-primary" : ""}`}
              style={{ transform: `translateY(${v.start}px)`, height: ROW_HEIGHT }}
              onClick={(e) => select(c.sha, e.ctrlKey || e.metaKey || e.shiftKey)}
            >
              <div className="commit-graph" style={{ width: graphWidth }}>
                <GraphCell row={row} height={ROW_HEIGHT} lanes={layout.maxLanes} highlighted={isSel} worktree={!!wts} />
              </div>
              <div className="commit-subject">
                <RefChips refs={refsBySha.get(c.sha)} worktrees={wts} activeWorktree={worktree?.path ?? null} color={laneColor(row.color)} />
                <span className="subject-text" title={c.subject}>
                  {c.subject}
                </span>
              </div>
              <div className="commit-author" title={c.authorEmail}>
                {c.authorName}
              </div>
              <div className="commit-time" title={new Date(c.authorTime * 1000).toLocaleString()}>
                {relativeTime(c.authorTime)}
              </div>
              <div className="commit-sha">{shortSha(c.sha)}</div>
            </div>
          );
        })}
      </div>
      {current.loadingLog && <div className="list-loading muted">loading…</div>}
    </div>
  );
});
