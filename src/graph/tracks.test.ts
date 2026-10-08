import { describe, expect, it } from "vitest";
import type { RefInfo } from "../api";
import { computeTracks } from "./tracks";

const ref = (short: string, sha: string, kind: RefInfo["kind"] = "branch"): RefInfo => ({ name: `refs/x/${short}`, short, kind, sha, upstream: null, ahead: 0, behind: 0 });

describe("computeTracks", () => {
  it("names side-lane commits after the merged branch", () => {
    // main: m -> b2 -> b1 ; feature f (merged into m) -> b1
    const commits = [
      { sha: "m", parents: ["b2", "f"] },
      { sha: "f", parents: ["b1"] },
      { sha: "b2", parents: ["b1"] },
      { sha: "b1", parents: [] },
    ];
    const refs = new Map([
      ["m", [ref("main", "m")]],
      ["f", [ref("feature", "f")]],
    ]);
    const t = computeTracks(commits, refs, new Map());
    expect(t.get("m")).toBe("main");
    expect(t.get("b2")).toBe("main");
    expect(t.get("f")).toBe("feature");
    expect(t.get("b1")).toBe("main"); // mainline owns shared history
  });

  it("prefers local over remote at a tip and stays unnamed without any tip", () => {
    const commits = [
      { sha: "a", parents: ["b"] },
      { sha: "b", parents: [] },
      { sha: "lost", parents: [] },
    ];
    const refs = new Map([["a", [ref("origin/dev", "a", "remote"), ref("dev", "a")]]]);
    const t = computeTracks(commits, refs, new Map());
    expect(t.get("a")).toBe("dev");
    expect(t.get("b")).toBe("dev");
    expect(t.get("lost")).toBeUndefined();
  });
});
