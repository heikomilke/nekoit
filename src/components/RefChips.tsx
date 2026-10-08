import { Cloud, FolderGit2, GitBranch, Tag } from "lucide-react";
import type { RefInfo, WorktreeInfo } from "../api";

interface Props {
  refs: RefInfo[] | undefined;
  worktrees: WorktreeInfo[] | undefined;
  activeWorktree: string | null;
  color: string;
}

/** Branch, remote, tag and worktree labels next to a commit subject. */
export function RefChips({ refs, worktrees, activeWorktree, color }: Props) {
  if (!refs?.length && !worktrees?.length) return null;
  const style = { "--chip-color": color } as React.CSSProperties;
  // A branch checked out in a worktree is shown once, merged into the worktree chip.
  const checkedOut = new Set((worktrees ?? []).map((w) => w.branch).filter(Boolean));
  return (
    <span className="chips" style={style}>
      {worktrees?.map((w) => (
        <span key={w.path} className={`chip chip-worktree ${w.path === activeWorktree ? "is-active" : ""}`} title={w.path}>
          <FolderGit2 size={11} />
          {w.name}
          {w.branch && w.branch !== w.name && <span className="chip-sub">{w.branch}</span>}
        </span>
      ))}
      {refs
        ?.filter((r) => !(r.kind === "branch" && checkedOut.has(r.short)))
        .map((r) => (
          <span key={r.name} className={`chip chip-${r.kind}`} title={r.upstream ? `tracks ${r.upstream}` : r.name}>
            {r.kind === "branch" && <GitBranch size={11} />}
            {r.kind === "remote" && <Cloud size={11} />}
            {r.kind === "tag" && <Tag size={11} />}
            {r.short}
            {r.kind === "branch" && (r.ahead > 0 || r.behind > 0) && (
              <span className="chip-sub">
                {r.ahead > 0 && `↑${r.ahead}`}
                {r.behind > 0 && `↓${r.behind}`}
              </span>
            )}
          </span>
        ))}
    </span>
  );
}
