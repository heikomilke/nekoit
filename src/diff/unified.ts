/**
 * Minimal unified-diff model for git patches, used to build partial patches
 * for line-level staging. The renderer (@pierre/diffs) has its own parser; this
 * one exists so we control exactly what we send to `git apply --cached`.
 */

export type LineKind = "context" | "add" | "del";

export interface DiffLine {
  kind: LineKind;
  /** Text without the leading marker; keeps the original line ending stripped. */
  text: string;
  /** 1-based line number in the old file (context and del), else null. */
  oldNo: number | null;
  /** 1-based line number in the new file (context and add), else null. */
  newNo: number | null;
  /** Row index in unified rendering order, across all hunks of the file. */
  row: number;
  /** `\ No newline at end of file` followed this line. */
  noNewline?: boolean;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  /** Text after the second `@@`, e.g. a function name. */
  context: string;
  lines: DiffLine[];
}

export interface DiffFile {
  /** Header lines up to (excluding) the first hunk: `diff --git`, `index`, `---`, `+++`, mode lines … */
  header: string[];
  oldPath: string | null;
  newPath: string | null;
  hunks: DiffHunk[];
  binary: boolean;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

function stripPrefix(p: string): string | null {
  if (p === "/dev/null") return null;
  return p.replace(/^[ab]\//, "");
}

/** Parse one or more files from a git unified diff. */
export function parseUnifiedDiff(patch: string): DiffFile[] {
  const lines = patch.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let row = 0;

  for (const raw of lines) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("diff --git ")) {
      file = { header: [line], oldPath: null, newPath: null, hunks: [], binary: false };
      files.push(file);
      hunk = null;
      row = 0;
      continue;
    }
    if (!file) continue;
    if (!hunk || line.startsWith("@@ ")) {
      const m = HUNK_RE.exec(line);
      if (m) {
        hunk = {
          oldStart: Number(m[1]),
          oldCount: m[2] === undefined ? 1 : Number(m[2]),
          newStart: Number(m[3]),
          newCount: m[4] === undefined ? 1 : Number(m[4]),
          context: m[5] ?? "",
          lines: [],
        };
        file.hunks.push(hunk);
        oldNo = hunk.oldStart;
        newNo = hunk.newStart;
        continue;
      }
      if (!hunk) {
        if (line.startsWith("--- ")) file.oldPath = stripPrefix(line.slice(4));
        else if (line.startsWith("+++ ")) file.newPath = stripPrefix(line.slice(4));
        else if (line.startsWith("Binary files ") || line === "GIT binary patch") file.binary = true;
        file.header.push(line);
        continue;
      }
    }
    if (line.startsWith("\\")) {
      const last = hunk.lines[hunk.lines.length - 1];
      if (last) last.noNewline = true;
      continue;
    }
    const marker = line[0];
    const text = line.slice(1);
    if (marker === "+") {
      hunk.lines.push({ kind: "add", text, oldNo: null, newNo: newNo++, row: row++ });
    } else if (marker === "-") {
      hunk.lines.push({ kind: "del", text, oldNo: oldNo++, newNo: null, row: row++ });
    } else if (marker === " " || line === "") {
      hunk.lines.push({ kind: "context", text, oldNo: oldNo++, newNo: newNo++, row: row++ });
    }
  }
  return files;
}

/**
 * Build a patch for `file` that applies only the change lines `keep` accepts.
 *
 * For staging (`forUnstage` false) the patch is applied forward onto the index,
 * whose content is the diff's old side: unselected additions are dropped and
 * unselected deletions become context. For unstaging it is applied with
 * `--reverse` onto the index, whose content is the diff's new side, so the
 * roles swap: unselected additions become context and unselected deletions
 * are dropped. Returns null if nothing is kept.
 */
export function buildPartialPatch(file: DiffFile, keep: (line: DiffLine) => boolean, forUnstage = false): string | null {
  if (file.binary) return null;
  const out: string[] = [];
  let kept = 0;
  for (const h of file.hunks) {
    const body: string[] = [];
    let oldCount = 0;
    let newCount = 0;
    let hunkKept = 0;
    for (const l of h.lines) {
      const selected = l.kind !== "context" && keep(l);
      let emitted = true;
      if (l.kind === "context") {
        body.push(" " + l.text);
        oldCount++;
        newCount++;
      } else if (selected) {
        body.push((l.kind === "add" ? "+" : "-") + l.text);
        if (l.kind === "add") newCount++;
        else oldCount++;
        hunkKept++;
      } else if ((l.kind === "del") !== forUnstage) {
        // unselected del when staging / unselected add when unstaging: present on both sides
        body.push(" " + l.text);
        oldCount++;
        newCount++;
      } else {
        emitted = false;
      }
      if (l.noNewline && emitted) body.push("\\ No newline at end of file");
    }
    if (hunkKept === 0) continue;
    kept += hunkKept;
    // A hunk for a brand-new or fully deleted file has start 0 on the empty side.
    const oldStart = h.oldCount === 0 && oldCount === 0 ? 0 : h.oldStart;
    const newStart = h.newCount === 0 && newCount === 0 ? 0 : Math.max(h.newStart, 1);
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${h.context ? " " + h.context : ""}`);
    out.push(...body);
  }
  if (kept === 0) return null;
  // Drop new-file/deleted-file mode lines: a partial patch always edits an existing index entry.
  const header = file.header.filter((l) => !/^(new|deleted) file mode /.test(l));
  // When the selection no longer creates the file from nothing, `--- /dev/null` must become a real path.
  const fixed = header.map((l) => (l.startsWith("--- /dev/null") && file.newPath ? `--- a/${file.newPath}` : l));
  return [...fixed, ...out].join("\n") + "\n";
}

/** Rows (unified order) whose change lines fall inside an inclusive row range. */
export function keepRows(from: number, to: number): (line: DiffLine) => boolean {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return (l) => l.row >= lo && l.row <= hi;
}

/** Map a (lineNumber, side) pair as reported by the renderer to a unified row index. */
export function rowFor(file: DiffFile, lineNumber: number, side: "deletions" | "additions"): number | null {
  for (const h of file.hunks) {
    for (const l of h.lines) {
      if (side === "additions" && l.newNo === lineNumber && l.kind !== "del") return l.row;
      if (side === "deletions" && l.oldNo === lineNumber && l.kind !== "add") return l.row;
    }
  }
  return null;
}
