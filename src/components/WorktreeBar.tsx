import { FolderGit2, Lock } from "lucide-react";
import type { WorktreeInfo } from "../api";
import { useStore } from "../store";
import { laneColor } from "../graph/colors";

interface Props {
  colorBySha: Map<string, number>;
  onJump(sha: string): void;
}

/**
 * Every worktree of the repo as a pill: folder name, branch, dirty count.
 * The active pill is the context for status and commits; clicking a pill
 * selects it, clicking its sha jumps to the commit in the graph.
 */
export function WorktreeBar({ colorBySha, onJump }: Props) {
  const current = useStore((s) => s.current);
  const selectWorktree = useStore((s) => s.selectWorktree);
  if (!current) return null;
  const { repo, worktree, statuses } = current;
  const sorted = [...repo.worktrees].sort((a, b) => b.headTime - a.headTime);

  return (
    <div className="wt-bar" role="tablist" aria-label="Worktrees">
      {sorted.map((w: WorktreeInfo) => {
        const st = statuses[w.path];
        const dirty = st ? st.entries.filter((e) => !e.ignored).length : 0;
        const active = worktree?.path === w.path;
        const color = colorBySha.get(w.head);
        return (
          <button
            key={w.path}
            role="tab"
            aria-selected={active}
            className={`wt-pill ${active ? "is-active" : ""}`}
            style={color !== undefined ? ({ "--wt-color": laneColor(color) } as React.CSSProperties) : undefined}
            onClick={() => selectWorktree(w)}
            onDoubleClick={() => onJump(w.head)}
            title={`${w.path}\n${w.branch ?? "detached"} @ ${w.head.slice(0, 8)}`}
          >
            <FolderGit2 size={13} className="wt-icon" />
            <span className="wt-name">{w.name}</span>
            {w.branch && w.branch !== w.name && <span className="wt-branch">{w.branch}</span>}
            {w.detached && <span className="wt-branch muted">detached</span>}
            {w.locked && <Lock size={11} className="muted" />}
            {st && st.branch.ahead > 0 && <span className="wt-ab">↑{st.branch.ahead}</span>}
            {st && st.branch.behind > 0 && <span className="wt-ab">↓{st.branch.behind}</span>}
            {dirty > 0 && <span className="wt-dirty">{dirty}</span>}
          </button>
        );
      })}
    </div>
  );
}
