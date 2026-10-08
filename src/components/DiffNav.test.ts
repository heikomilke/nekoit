import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../diff/unified";
import { changeBlocks } from "./DiffNav";

const PATCH = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1,8 +1,8 @@
 one
-two
+TWO
 three
 four
-five
 six
+seven
 eight
`;

describe("changeBlocks", () => {
  it("groups adjacent changed lines and keeps context between blocks", () => {
    const { blocks, totalRows } = changeBlocks(parseUnifiedDiff(PATCH));
    expect(totalRows).toBe(9);
    expect(blocks.map((b) => [b.kind, b.side, b.line, b.row])).toEqual([
      ["mixed", "deletions", 2, 1],
      ["del", "deletions", 5, 5],
      ["add", "additions", 6, 7],
    ]);
    expect(blocks[0].lines).toEqual([
      { line: 2, side: "deletions" },
      { line: 2, side: "additions" },
    ]);
  });

  it("offsets rows across files", () => {
    const two = PATCH + PATCH.replace(/a\.txt/g, "b.txt");
    const { blocks, totalRows } = changeBlocks(parseUnifiedDiff(two));
    expect(totalRows).toBe(18);
    expect(blocks.length).toBe(6);
    expect(blocks[3]).toMatchObject({ file: 1, row: 10 });
  });
});
