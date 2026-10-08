import { ChevronDown, ChevronUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { parseUnifiedDiff, type DiffFile } from "../diff/unified";

/** One run of consecutive changed lines inside a patch. */
export interface ChangeBlock {
  /** Index of the file within the patch. */
  file: number;
  /** Row index across the whole patch, for the scrollbar marks. */
  row: number;
  /** Line number and side of the block's first line, for locating it in the rendered diff. */
  line: number;
  side: "additions" | "deletions";
  kind: "add" | "del" | "mixed";
  /** Every changed line of the block, for highlighting it after a jump. */
  lines: { line: number; side: "additions" | "deletions" }[];
}

/** Group changed lines into blocks; `totalRows` counts every rendered line across all files. */
export function changeBlocks(files: DiffFile[]): { blocks: ChangeBlock[]; totalRows: number } {
  const blocks: ChangeBlock[] = [];
  let offset = 0;
  files.forEach((f, fi) => {
    let open: ChangeBlock | null = null;
    let lastRow = -2;
    let rows = 0;
    for (const h of f.hunks) {
      for (const l of h.lines) {
        rows = Math.max(rows, l.row + 1);
        if (l.kind === "context") {
          open = null;
          continue;
        }
        const kind = l.kind;
        const at = { line: kind === "add" ? (l.newNo ?? 0) : (l.oldNo ?? 0), side: kind === "add" ? ("additions" as const) : ("deletions" as const) };
        if (open && l.row === lastRow + 1) {
          if (open.kind !== kind) open.kind = "mixed";
          open.lines.push(at);
        } else {
          open = { file: fi, row: offset + l.row, line: at.line, side: at.side, kind, lines: [at] };
          blocks.push(open);
        }
        lastRow = l.row;
      }
    }
    offset += rows;
  });
  return { blocks, totalRows: offset };
}

function scrollerOf(wrap: HTMLElement): HTMLElement | null {
  return wrap.querySelector<HTMLElement>(":scope > .diff-files, :scope > .diff");
}

function lineElements(host: HTMLElement | undefined, line: number, side: "additions" | "deletions"): HTMLElement[] {
  const type = side === "additions" ? "change-addition" : "change-deletion";
  return Array.from(host?.shadowRoot?.querySelectorAll<HTMLElement>(`[data-line="${line}"][data-line-type="${type}"]`) ?? []);
}

/** Attribute the renderer's `unsafeCSS` animates; see DiffView. */
export const FLASH_ATTR = "data-nekoit-flash";
let flashTimer: ReturnType<typeof setTimeout> | undefined;

/** Highlight the block's lines once so the eye finds it among neighbours already on screen. */
function flash(host: HTMLElement | undefined, b: ChangeBlock) {
  const root = host?.shadowRoot;
  if (!root) return;
  clearTimeout(flashTimer);
  for (const el of root.querySelectorAll(`[${FLASH_ATTR}]`)) el.removeAttribute(FLASH_ATTR);
  const els = b.lines.flatMap((l) => lineElements(host, l.line, l.side));
  // Re-adding the attribute in the next frame restarts the animation on a repeated jump.
  requestAnimationFrame(() => {
    for (const el of els) el.setAttribute(FLASH_ATTR, "");
    flashTimer = setTimeout(() => els.forEach((el) => el.removeAttribute(FLASH_ATTR)), 1200);
  });
}

/** Scroll the diff so the block sits mid-pane; falls back to a proportional position. */
function jumpToBlock(wrap: HTMLElement, b: ChangeBlock, totalRows: number) {
  const pane = scrollerOf(wrap);
  if (!pane) return;
  const hosts = wrap.querySelectorAll<HTMLElement>(":scope > .diff-files > .diff, :scope > .diff");
  const host = hosts[b.file];
  const el = lineElements(host, b.line, b.side)[0];
  if (el) {
    const r = el.getBoundingClientRect();
    const pr = pane.getBoundingClientRect();
    pane.scrollTop += r.top - pr.top - pane.clientHeight / 2 + r.height / 2;
    flash(host, b);
  } else if (totalRows > 0) {
    pane.scrollTop = (b.row / totalRows) * pane.scrollHeight - pane.clientHeight / 2;
  }
}

export interface DiffNav {
  blocks: ChangeBlock[];
  totalRows: number;
  /** Index of the block last jumped to, -1 before any jump. */
  cur: number;
  jump(i: number): void;
  next(): void;
  prev(): void;
}

/** Change-to-change navigation for the patch rendered inside `wrap` (a `.diff-wrap` element). */
export function useDiffNav(patch: string, wrap: RefObject<HTMLElement | null>): DiffNav {
  const { blocks, totalRows } = useMemo(() => changeBlocks(patch.trim() ? parseUnifiedDiff(patch) : []), [patch]);
  const [cur, setCur] = useState(-1);
  useEffect(() => setCur(-1), [patch]);
  const jump = useCallback(
    (i: number) => {
      const b = blocks[i];
      if (!b || !wrap.current) return;
      setCur(i);
      jumpToBlock(wrap.current, b, totalRows);
    },
    [blocks, totalRows, wrap],
  );
  const next = useCallback(() => jump(cur + 1 < blocks.length ? cur + 1 : 0), [jump, cur, blocks.length]);
  const prev = useCallback(() => jump(cur > 0 ? cur - 1 : blocks.length - 1), [jump, cur, blocks.length]);
  return { blocks, totalRows, cur, jump, next, prev };
}

/** Previous / next buttons with a position readout. */
export function DiffNavButtons({ nav }: { nav: DiffNav }) {
  const n = nav.blocks.length;
  return (
    <span className="diff-nav">
      <button className="btn btn-icon" onClick={nav.prev} disabled={n === 0} title="Previous change (b, or shift+n)">
        <ChevronUp size={14} />
      </button>
      <span className="diff-nav-pos muted" title="Change blocks in this diff">
        {n === 0 ? "–" : `${nav.cur < 0 ? "·" : nav.cur + 1}/${n}`}
      </span>
      <button className="btn btn-icon" onClick={nav.next} disabled={n === 0} title="Next change (n)">
        <ChevronDown size={14} />
      </button>
    </span>
  );
}

/** Tick marks along the right edge showing where the changes sit in the document. */
export function DiffMarks({ nav }: { nav: DiffNav }) {
  if (nav.blocks.length === 0 || nav.totalRows === 0) return null;
  return (
    <div className="diff-marks" aria-hidden>
      {nav.blocks.map((b, i) => (
        <span
          key={i}
          className={`diff-mark mark-${b.kind} ${i === nav.cur ? "is-current" : ""}`}
          style={{ top: `${(b.row / nav.totalRows) * 100}%` }}
          onClick={() => nav.jump(i)}
        />
      ))}
    </div>
  );
}
