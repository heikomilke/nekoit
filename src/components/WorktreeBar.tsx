import { ChevronDown, FolderGit2, Lock } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorktreeInfo, WorktreeStatus } from "../api";
import { laneColor } from "../graph/colors";
import { useStore } from "../store";
import { relativeTime } from "../util/format";

interface Props {
  colorBySha: Map<string, number>;
  onJump(sha: string): void;
}

const GAP = 6;

function badges(st: WorktreeStatus | undefined) {
  const dirty = st ? st.entries.filter((e) => !e.ignored).length : 0;
  return { dirty, ahead: st?.branch.ahead ?? 0, behind: st?.branch.behind ?? 0 };
}

/**
 * Condensed worktree bar: colour dot + folder name per worktree, badges only
 * when non-zero, and whatever does not fit collapses into a "+N" menu instead
 * of scrolling. The active worktree (status and commit context) is always
 * visible. Hover a pill for path, branch and tracking details.
 */
export function WorktreeBar({ colorBySha, onJump }: Props) {
  const current = useStore((s) => s.current);
  const selectWorktree = useStore((s) => s.selectWorktree);
  const container = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(Infinity);
  const [menuOpen, setMenuOpen] = useState(false);

  const repo = current?.repo;
  const worktree = current?.worktree ?? null;
  const statuses = current?.statuses ?? {};
  const sorted = useMemo(() => (repo ? [...repo.worktrees].sort((a, b) => b.headTime - a.headTime) : []), [repo]);

  // Measure pill widths from an invisible copy and decide how many fit.
  useLayoutEffect(() => {
    const el = container.current;
    const m = measure.current;
    if (!el || !m) return;
    const compute = () => {
      const widths = Array.from(m.children).map((c) => (c as HTMLElement).offsetWidth);
      const avail = el.clientWidth - 70; // room for the "+N" menu button
      let used = 0;
      let n = 0;
      for (const w of widths) {
        if (used + w + (n ? GAP : 0) > avail) break;
        used += w + (n ? GAP : 0);
        n++;
      }
      setVisibleCount(n >= widths.length ? Infinity : Math.max(1, n));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sorted, statuses]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!container.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [menuOpen]);

  if (!repo) return null;

  // Keep the active worktree visible even when it would overflow.
  let visible = sorted.slice(0, visibleCount);
  let hidden = sorted.slice(visibleCount);
  if (worktree && hidden.some((w) => w.path === worktree.path)) {
    const active = hidden.find((w) => w.path === worktree.path)!;
    const bumped = visible[visible.length - 1];
    visible = [...visible.slice(0, -1), active];
    hidden = [bumped, ...hidden.filter((w) => w.path !== active.path)];
  }

  const pill = (w: WorktreeInfo, full: boolean) => {
    const st = statuses[w.path];
    const { dirty, ahead, behind } = badges(st);
    const active = worktree?.path === w.path;
    const color = colorBySha.get(w.head);
    const title = [
      w.path,
      w.branch ? `branch ${w.branch}` : "detached HEAD",
      st?.branch.upstream ? `tracks ${st.branch.upstream}${ahead ? ` ↑${ahead}` : ""}${behind ? ` ↓${behind}` : ""}` : null,
      dirty ? `${dirty} changed file${dirty === 1 ? "" : "s"}` : "clean",
      `last commit ${relativeTime(w.headTime)} ago`,
      active ? "active: status and commits use this worktree" : "click to make active, double-click to jump to HEAD",
    ]
      .filter(Boolean)
      .join("\n");
    return (
      <button
        key={w.path}
        role="tab"
        aria-selected={active}
        className={`wt-pill ${active ? "is-active" : ""} ${full ? "is-full" : ""}`}
        style={color !== undefined ? ({ "--wt-color": laneColor(color) } as React.CSSProperties) : undefined}
        onClick={() => {
          selectWorktree(w);
          setMenuOpen(false);
        }}
        onDoubleClick={() => onJump(w.head)}
        title={title}
      >
        <span className="wt-name">{w.name}</span>
        {full && <span className="wt-branch">{w.branch ?? "detached"}</span>}
        {w.locked && <Lock size={11} className="muted" />}
        {ahead > 0 && <span className="wt-ab">↑{ahead}</span>}
        {behind > 0 && <span className="wt-ab">↓{behind}</span>}
        {dirty > 0 && <span className="wt-dirty">{dirty}</span>}
      </button>
    );
  };

  return (
    <div ref={container} className="wt-bar" role="tablist" aria-label="Worktrees">
      <FolderGit2 size={13} className="muted wt-bar-icon" aria-hidden="true" />
      {visible.map((w) => pill(w, false))}
      {hidden.length > 0 && (
        <div className="wt-more">
          <button className={`wt-pill wt-more-btn ${menuOpen ? "is-active" : ""}`} onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen}>
            +{hidden.length} <ChevronDown size={12} />
          </button>
          {menuOpen && (
            <div className="wt-menu" role="menu">
              {hidden.map((w) => pill(w, true))}
            </div>
          )}
        </div>
      )}
      {/* invisible copy used only for measuring */}
      <div ref={measure} className="wt-measure" aria-hidden="true">
        {sorted.map((w) => pill(w, false))}
      </div>
    </div>
  );
}
