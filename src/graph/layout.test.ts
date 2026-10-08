import { describe, expect, it } from "vitest";
import { layoutGraph } from "./layout";

describe("layoutGraph", () => {
  it("keeps a linear history in lane 0", () => {
    const { rows, maxLanes } = layoutGraph([
      { sha: "c", parents: ["b"] },
      { sha: "b", parents: ["a"] },
      { sha: "a", parents: [] },
    ]);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(maxLanes).toBe(1);
    expect(rows[0].segments).toEqual([{ from: null, to: 0, color: 0, dangling: false }]);
  });

  it("opens a second lane for a merge and closes it at the fork point", () => {
    // m merges f into base: m -> [b2, f]; f -> [b1]; b2 -> [b1]; b1 -> []
    const { rows, maxLanes } = layoutGraph([
      { sha: "m", parents: ["b2", "f"] },
      { sha: "f", parents: ["b1"] },
      { sha: "b2", parents: ["b1"] },
      { sha: "b1", parents: [] },
    ]);
    expect(maxLanes).toBe(2);
    expect(rows[0].isMerge).toBe(true);
    expect(rows[1].lane).toBe(1); // f sits in the side lane
    expect(rows[2].lane).toBe(0);
    // b1 receives both lanes
    expect(rows[3].segments.filter((s) => s.to === null).map((s) => s.from).sort()).toEqual([0, 1]);
  });

  it("marks parents outside the page as dangling", () => {
    const { rows } = layoutGraph([{ sha: "x", parents: ["missing"] }]);
    expect(rows[0].segments[0].dangling).toBe(true);
  });
});
