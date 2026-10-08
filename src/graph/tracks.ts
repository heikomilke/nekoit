import type { RefInfo, WorktreeInfo } from "../api";
import type { CommitLike } from "./layout";

const MAINLINE = ["main", "master", "trunk", "develop", "dev"];

/**
 * Name the "track" each commit sits on: walk the first-parent chain down from
 * every tip, in priority order, and stop where a higher-priority track already
 * owns the commit. Side-lane commits therefore get the name of the branch that
 * was merged, and shared history belongs to the most important branch.
 *
 * Priority: branches checked out in a worktree, mainline names, local
 * branches, remote branches, tags; ties keep graph order (newest tip first).
 */
export function computeTracks(commits: readonly CommitLike[], refsBySha: Map<string, RefInfo[]>, worktreesBySha: Map<string, WorktreeInfo[]>): Map<string, string> {
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const kindRank = { branch: 2, remote: 3, tag: 4, stash: 5, other: 6 };
  const tips: { sha: string; name: string; rank: number; pos: number }[] = [];
  commits.forEach((c, pos) => {
    for (const w of worktreesBySha.get(c.sha) ?? []) if (w.branch) tips.push({ sha: c.sha, name: w.branch, rank: 0, pos });
    for (const r of refsBySha.get(c.sha) ?? []) {
      const base = r.short.replace(/^[^/]+\//, "");
      const rank = r.kind === "branch" && MAINLINE.includes(r.short) ? 1 : r.kind === "remote" && MAINLINE.includes(base) ? 2.5 : kindRank[r.kind];
      tips.push({ sha: c.sha, name: r.short, rank, pos });
    }
  });
  tips.sort((a, b) => a.rank - b.rank || a.pos - b.pos);

  const track = new Map<string, string>();
  for (const tip of tips) {
    let sha: string | undefined = tip.sha;
    while (sha && !track.has(sha)) {
      track.set(sha, tip.name);
      sha = bySha.get(sha)?.parents[0];
    }
  }
  return track;
}
