import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPartialPatch, keepRows, parseUnifiedDiff, rowFor } from "./unified";

const SAMPLE = `diff --git a/f.txt b/f.txt
index 1111111..2222222 100644
--- a/f.txt
+++ b/f.txt
@@ -1,4 +1,5 @@ fn main
 one
-two
+TWO
+two and a half
 three
 four
`;

describe("parseUnifiedDiff", () => {
  it("parses hunks with line numbers and rows", () => {
    const [f] = parseUnifiedDiff(SAMPLE);
    expect(f.oldPath).toBe("f.txt");
    expect(f.newPath).toBe("f.txt");
    expect(f.hunks).toHaveLength(1);
    const h = f.hunks[0];
    expect([h.oldStart, h.oldCount, h.newStart, h.newCount, h.context]).toEqual([1, 4, 1, 5, "fn main"]);
    expect(h.lines.map((l) => `${l.kind}:${l.oldNo}:${l.newNo}:${l.row}`)).toEqual([
      "context:1:1:0",
      "del:2:null:1",
      "add:null:2:2",
      "add:null:3:3",
      "context:3:4:4",
      "context:4:5:5",
    ]);
    expect(rowFor(f, 2, "deletions")).toBe(1);
    expect(rowFor(f, 3, "additions")).toBe(3);
  });
});

describe("buildPartialPatch", () => {
  it("keeps only selected change lines and turns unselected deletions into context", () => {
    const [f] = parseUnifiedDiff(SAMPLE);
    const p = buildPartialPatch(f, keepRows(3, 3)); // only "+two and a half"
    expect(p).toBe(`diff --git a/f.txt b/f.txt
index 1111111..2222222 100644
--- a/f.txt
+++ b/f.txt
@@ -1,4 +1,5 @@ fn main
 one
 two
+two and a half
 three
 four
`);
  });

  it("returns null when nothing is selected", () => {
    const [f] = parseUnifiedDiff(SAMPLE);
    expect(buildPartialPatch(f, () => false)).toBeNull();
  });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } });
}

describe("round trip through git apply --cached", () => {
  it("stages a subset of lines of a modified file and of a new file", () => {
    const dir = mkdtempSync(join(tmpdir(), "nekoit-"));
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "t@example.com");
    git(dir, "config", "user.name", "t");
    writeFileSync(join(dir, "f.txt"), "one\ntwo\nthree\nfour\n");
    git(dir, "add", "f.txt");
    git(dir, "commit", "-q", "-m", "init");
    writeFileSync(join(dir, "f.txt"), "one\nTWO\ntwo and a half\nthree\nfour\nfive\n");
    writeFileSync(join(dir, "n.txt"), "a\nb\nc\n");
    git(dir, "add", "-N", "n.txt"); // intent-to-add so the new file shows up in `git diff`

    const files = parseUnifiedDiff(git(dir, "diff", "--no-color", "--no-ext-diff"));
    const f = files.find((x) => x.newPath === "f.txt")!;
    const n = files.find((x) => x.newPath === "n.txt")!;

    // stage "+two and a half" and "+five" but not the two -> TWO change
    const pf = buildPartialPatch(f, (l) => l.kind === "add" && (l.text === "two and a half" || l.text === "five"))!;
    execFileSync("git", ["apply", "--cached", "--recount", "-"], { cwd: dir, input: pf });
    expect(git(dir, "show", ":f.txt")).toBe("one\ntwo\ntwo and a half\nthree\nfour\nfive\n");

    // stage only line "b" of the new file
    const pn = buildPartialPatch(n, (l) => l.text === "b")!;
    execFileSync("git", ["apply", "--cached", "--recount", "-"], { cwd: dir, input: pn });
    expect(git(dir, "show", ":n.txt")).toBe("b\n");

    // discard only "two and a half" from the working tree: the unstage-flavoured patch's
    // new side matches the file on disk, so reverse-applying it removes just that line
    const work = parseUnifiedDiff(git(dir, "diff", "--no-color", "--no-ext-diff")).find((x) => x.newPath === "f.txt")!;
    const drop = buildPartialPatch(work, (l) => l.text === "two" || l.text === "TWO", true)!;
    execFileSync("git", ["apply", "--recount", "--reverse", "-"], { cwd: dir, input: drop });
    expect(readFileSync(join(dir, "f.txt"), "utf8")).toBe("one\ntwo\ntwo and a half\nthree\nfour\nfive\n");

    // discard only "c" from the new file (intent-to-add diff): reverse-apply the unstage flavour
    const nd = parseUnifiedDiff(git(dir, "diff", "--no-color", "--no-ext-diff", "--", "n.txt"))[0];
    const dropC = buildPartialPatch(nd, (l) => l.text === "c", true)!;
    execFileSync("git", ["apply", "--recount", "--reverse", "-"], { cwd: dir, input: dropC });
    expect(readFileSync(join(dir, "n.txt"), "utf8")).toBe("a\nb\n");

    // unstage "five" again via reverse
    const staged = parseUnifiedDiff(git(dir, "diff", "--cached", "--no-color", "--no-ext-diff"));
    const sf = staged.find((x) => x.newPath === "f.txt")!;
    const back = buildPartialPatch(sf, (l) => l.text === "five", true)!;
    execFileSync("git", ["apply", "--cached", "--recount", "--reverse", "-"], { cwd: dir, input: back });
    expect(git(dir, "show", ":f.txt")).toBe("one\ntwo\ntwo and a half\nthree\nfour\n");
  });
});
