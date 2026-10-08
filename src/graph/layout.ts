/**
 * Lane layout for a topologically ordered commit list.
 *
 * Each row gets: the lane its node sits in, the set of lane-to-lane segments
 * that pass through or end/start at this row, and a colour index per lane so a
 * branch keeps its colour as it flows down. Lanes are never compacted, so a
 * segment's `from` and `to` only differ where a branch is created, merged, or
 * where a parent is picked up in another lane.
 */

export interface CommitLike {
  sha: string;
  parents: string[];
}

export interface Segment {
  /** Lane index at the top edge of this row (null = starts at the node). */
  from: number | null;
  /** Lane index at the bottom edge of this row (null = ends at the node). */
  to: number | null;
  color: number;
  /** Segment was drawn for a parent this page does not contain (dangling). */
  dangling?: boolean;
}

export interface RowLayout {
  lane: number;
  color: number;
  segments: Segment[];
  /** Number of lanes in use at this row (for sizing). */
  width: number;
  isMerge: boolean;
}

interface Lane {
  sha: string;
  color: number;
}

export interface GraphLayout {
  rows: RowLayout[];
  maxLanes: number;
}

export function layoutGraph(commits: readonly CommitLike[]): GraphLayout {
  const present = new Set(commits.map((c) => c.sha));
  let lanes: (Lane | null)[] = [];
  let nextColor = 0;
  const rows: RowLayout[] = [];
  let maxLanes = 0;

  const allocLane = (sha: string, color: number): number => {
    const free = lanes.indexOf(null);
    if (free >= 0) {
      lanes[free] = { sha, color };
      return free;
    }
    lanes.push({ sha, color });
    return lanes.length - 1;
  };

  for (const commit of commits) {
    const segments: Segment[] = [];
    const before = lanes.slice();

    // Lanes that were waiting for this commit.
    const incoming: number[] = [];
    before.forEach((l, i) => {
      if (l && l.sha === commit.sha) incoming.push(i);
    });

    let lane: number;
    let color: number;
    if (incoming.length > 0) {
      lane = incoming[0];
      color = before[lane]!.color;
      for (const i of incoming) {
        segments.push({ from: i, to: null, color: before[i]!.color });
        lanes[i] = null;
      }
    } else {
      color = nextColor++;
      lane = allocLane(commit.sha, color);
      lanes[lane] = null; // the node occupies it; parents decide what continues
    }

    // Pass-through lanes keep flowing straight down.
    before.forEach((l, i) => {
      if (l && l.sha !== commit.sha) segments.push({ from: i, to: i, color: l.color });
    });

    // Parents: the first one inherits our lane, others branch out or join an
    // existing lane already waiting for that parent.
    commit.parents.forEach((parent, idx) => {
      const existing = lanes.findIndex((l) => l && l.sha === parent);
      // Join a lane that already waits for this parent, unless we are the first
      // parent's child sitting further left: then keep our own lane waiting too,
      // so the main line stays left and the side lane only bends in at the
      // parent's row (where both lanes arrive).
      const keepOwnLane = idx === 0 && lanes[lane] === null && existing > lane;
      if (existing >= 0 && !keepOwnLane) {
        segments.push({ from: null, to: existing, color: lanes[existing]!.color });
        return;
      }
      if (idx === 0 && lanes[lane] === null) {
        lanes[lane] = { sha: parent, color };
        segments.push({ from: null, to: lane, color, dangling: !present.has(parent) });
      } else {
        const c = nextColor++;
        const target = allocLane(parent, c);
        segments.push({ from: null, to: target, color: c, dangling: !present.has(parent) });
      }
    });

    // Trim trailing empty lanes so width stays tight.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

    const width = Math.max(lane + 1, before.length, lanes.length);
    maxLanes = Math.max(maxLanes, width);
    rows.push({ lane, color, segments, width, isMerge: commit.parents.length > 1 });
  }

  return { rows, maxLanes };
}
