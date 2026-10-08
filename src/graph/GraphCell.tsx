import { memo } from "react";
import { laneColor } from "./colors";
import type { RowLayout } from "./layout";

export const LANE_WIDTH = 14;
export const NODE_RADIUS = 3.5;

interface Props {
  row: RowLayout;
  height: number;
  /** Total lanes in the visible page, so every row shares the same width. */
  lanes: number;
  highlighted?: boolean;
  /** This commit is a worktree HEAD: draw a ring. */
  worktree?: boolean;
}

function x(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2;
}

/**
 * One row of the revision graph as SVG. Segments that change lane bend with a
 * cubic curve so merges and branch-offs read as flowing tracks rather than
 * kinks.
 */
export const GraphCell = memo(function GraphCell({ row, height, lanes, highlighted, worktree }: Props) {
  const width = Math.max(lanes, row.width) * LANE_WIDTH;
  const mid = height / 2;
  const nx = x(row.lane);
  const paths: React.ReactNode[] = [];

  row.segments.forEach((s, i) => {
    const color = laneColor(s.color);
    let d: string;
    if (s.from !== null && s.to !== null) {
      // pass-through; straight in practice since lanes are stable
      const fx = x(s.from);
      const tx = x(s.to);
      d = fx === tx ? `M${fx} 0 L${tx} ${height}` : `M${fx} 0 C${fx} ${mid} ${tx} ${mid} ${tx} ${height}`;
    } else if (s.from !== null) {
      // arrives from above into the node
      const fx = x(s.from);
      d = fx === nx ? `M${fx} 0 L${nx} ${mid}` : `M${fx} 0 C${fx} ${mid * 0.9} ${nx} ${mid * 0.2} ${nx} ${mid}`;
    } else if (s.to !== null) {
      // leaves the node downwards
      const tx = x(s.to);
      d = tx === nx ? `M${nx} ${mid} L${tx} ${height}` : `M${nx} ${mid} C${nx} ${mid + mid * 0.8} ${tx} ${mid + mid * 0.1} ${tx} ${height}`;
    } else {
      return;
    }
    paths.push(<path key={i} d={d} stroke={color} strokeWidth={2} fill="none" strokeDasharray={s.dangling ? "2 3" : undefined} strokeLinecap="round" />);
  });

  const color = laneColor(row.color);
  return (
    <svg className="graph-cell" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {paths}
      {worktree && <circle cx={nx} cy={mid} r={NODE_RADIUS + 3.5} fill="none" stroke={color} strokeWidth={1.5} opacity={0.9} />}
      {row.isMerge ? (
        <circle cx={nx} cy={mid} r={NODE_RADIUS} fill="var(--bg-panel)" stroke={color} strokeWidth={2} />
      ) : (
        <circle cx={nx} cy={mid} r={highlighted ? NODE_RADIUS + 1 : NODE_RADIUS} fill={color} />
      )}
    </svg>
  );
});
