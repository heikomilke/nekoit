import { useVirtualizer } from "@tanstack/react-virtual";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { Commit } from "../api";
import { GraphCell, LANE_WIDTH } from "../graph/GraphCell";
import { laneColor } from "../graph/colors";
import { layoutGraph } from "../graph/layout";
import { FilterBox, usePathFilter } from "./FilterBox";
import { RefChips } from "./RefChips";
import { WORKDIR, useStore } from "../store";
import { relativeTime, shortSha } from "../util/format";

export const ROW_HEIGHT = 26;

/** Dashed node for the virtual working-changes row, in the lane of the worktree's HEAD. */
function WorkdirCell({ lane, color, lanes, height }: { lane: number; color: number; lanes: number; height: number }) {
  const width = lanes * LANE_WIDTH;
  const cx = lane * LANE_WIDTH + LANE_WIDTH / 2;
  const c = laneColor(color);
  return (
    <svg className="graph-cell" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={`M${cx} ${height / 2} L${cx} ${height}`} stroke={c} strokeWidth={2} strokeDasharray="2 3" strokeLinecap="round" />
      <circle cx={cx} cy={height / 2} r={3.5} fill="none" stroke={c} strokeWidth={2} strokeDasharray="2 2" />
    </svg>
  );
}

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
  const allCommits = current?.commits ?? [];
  const parent = useRef<HTMLDivElement>(null);

  // Filter over message, author, sha and ref names of the loaded commits. While it is
  // active the lane graph is meaningless, so rows get a plain dot instead.
  const [query, setQuery] = useState("");
  const matches = usePathFilter(query);
  const filtering = query.trim() !== "";
  const refsBySha = current?.refsBySha;
  const commits = useMemo(() => {
    if (!filtering) return allCommits;
    return allCommits.filter(
      (c) => matches(c.subject) || matches(c.authorName) || matches(c.sha) || (refsBySha?.get(c.sha) ?? []).some((r) => matches(r.short)),
    );
  }, [allCommits, filtering, matches, refsBySha]);

  const layout = useMemo(() => (filtering ? null : layoutGraph(commits)), [commits, filtering]);
  // Row 0 is the virtual "working changes" row of the active worktree.
  const wt = current?.worktree ?? null;
  const hasWorkdir = !!wt && !filtering;
  const offset = hasWorkdir ? 1 : 0;
  const indexBySha = useMemo(() => new Map(commits.map((c, i) => [c.sha, i + offset])), [commits, offset]);
  const headRow = wt ? indexBySha.get(wt.head) : undefined;
  const headLayout = headRow !== undefined && layout ? layout.rows[headRow - offset] : undefined;

  useEffect(() => {
    if (!layout) return;
    const m = new Map<string, number>();
    commits.forEach((c, i) => m.set(c.sha, layout.rows[i].color));
    onLayout(m);
  }, [commits, layout, onLayout]);

  const virtualizer = useVirtualizer({
    count: commits.length + offset,
    getScrollElement: () => parent.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  useImperativeHandle(ref, () => ({
    scrollTo(sha) {
      const i = sha === WORKDIR ? (hasWorkdir ? 0 : undefined) : indexBySha.get(sha);
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
    if (last && last.index >= commits.length + offset - 50 && current?.hasMore && !current.loadingLog) void loadMore();
  }, [items, commits.length, current?.hasMore, current?.loadingLog, loadMore]);

  // Keyboard navigation: arrows / j k move the primary selection.
  useEffect(() => {
    const el = parent.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (!current) return;
      const sel = current.selected[0];
      const i = sel === WORKDIR ? 0 : sel ? (indexBySha.get(sel) ?? -1) : -1;
      const total = commits.length + offset;
      let next: number | null = null;
      if (e.key === "ArrowDown" || e.key === "j") next = Math.min(total - 1, i + 1);
      if (e.key === "ArrowUp" || e.key === "k") next = Math.max(0, i - 1);
      if (e.key === "Home") next = 0;
      if (e.key === "End") next = total - 1;
      if (next === null || next === i) return;
      e.preventDefault();
      const sha = hasWorkdir && next === 0 ? WORKDIR : commits[next - offset].sha;
      select(sha, e.shiftKey && sha !== WORKDIR);
      virtualizer.scrollToIndex(next, { align: "auto" });
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [commits, current, indexBySha, select, virtualizer, hasWorkdir, offset]);

  if (!current) return null;
  const { worktreesBySha, worktree, selected, statuses, tracks } = current;
  const graphWidth = (layout?.maxLanes ?? 1) * LANE_WIDTH;
  const dirty = wt ? (statuses[wt.path]?.entries.filter((e) => !e.ignored).length ?? 0) : 0;

  return (
    <div className="commit-pane">
      <div className="commit-toolbar">
        <FilterBox value={query} onChange={setQuery} placeholder="filter commits (regex: message, author, sha, ref)" hotkey="ctrl+f" />
        <span className="muted">
          {filtering ? `${commits.length} of ${allCommits.length} loaded commits` : `${allCommits.length} commits${current.hasMore ? "+" : ""}`}
        </span>
      </div>
    <div ref={parent} className="commit-list" tabIndex={0} role="listbox" aria-label="Commits">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {items.map((v) => {
          if (hasWorkdir && v.index === 0) {
            const isSel = selected[0] === WORKDIR;
            return (
              <div
                key={WORKDIR}
                role="option"
                aria-selected={isSel}
                className={`commit-row is-workdir ${isSel ? "is-selected is-primary" : ""}`}
                style={{ transform: `translateY(${v.start}px)`, height: ROW_HEIGHT }}
                onClick={() => select(WORKDIR, false)}
              >
                <div className="commit-graph" style={{ width: graphWidth }}>
                  <WorkdirCell lane={headLayout?.lane ?? 0} color={headLayout?.color ?? 0} lanes={layout?.maxLanes ?? 1} height={ROW_HEIGHT} />
                </div>
                <div className="commit-subject">
                  <span className={`subject-text ${dirty > 0 ? "has-changes" : ""}`}>
                    {dirty > 0 ? `${dirty} changed file${dirty === 1 ? "" : "s"} in ${wt!.name}` : `no local changes in ${wt!.name}`}
                  </span>
                </div>
                <div className="commit-author" />
                <div className="commit-time" />
                <div className="commit-sha" />
              </div>
            );
          }
          const c: Commit = commits[v.index - offset];
          const row = layout?.rows[v.index - offset];
          const isSel = selected.includes(c.sha);
          const wts = worktreesBySha.get(c.sha);
          const color = row ? laneColor(row.color) : "var(--fg-muted)";
          return (
            <div
              key={c.sha}
              role="option"
              aria-selected={isSel}
              className={`commit-row ${isSel ? "is-selected" : ""} ${selected[0] === c.sha ? "is-primary" : ""}`}
              style={{ transform: `translateY(${v.start}px)`, height: ROW_HEIGHT }}
              onClick={(e) => select(c.sha, e.ctrlKey || e.metaKey || e.shiftKey)}
              title={tracks.get(c.sha) ? `on ${tracks.get(c.sha)}` : undefined}
            >
              <div className="commit-graph" style={{ width: graphWidth }}>
                {row && layout ? <GraphCell row={row} height={ROW_HEIGHT} lanes={layout.maxLanes} highlighted={isSel} worktree={!!wts} /> : <span className="flat-dot" />}
              </div>
              <div className="commit-subject">
                <RefChips refs={refsBySha?.get(c.sha)} worktrees={wts} activeWorktree={worktree?.path ?? null} color={color} />
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
      {filtering && commits.length === 0 && <div className="muted pad">No loaded commit matches.</div>}
    </div>
    </div>
  );
});
