import { parseDiffFromFile, processPatch } from "@pierre/diffs";
import { FileDiff, type FileDiffOptions, type SelectedLineRange } from "@pierre/diffs/react";
import { useMemo } from "react";
import { FLASH_ATTR } from "./DiffNav";

/** One-shot highlight for the line a jump landed on; the attribute is set by DiffNav. */
const FLASH_CSS = `@keyframes nekoit-flash { from { box-shadow: inset 0 0 0 999px color-mix(in srgb, #6c9cff 45%, transparent); } to { box-shadow: inset 0 0 0 999px transparent; } }
  [${FLASH_ATTR}] { animation: nekoit-flash 1.1s ease-out; }`;

export type DiffStyle = "unified" | "split";

interface Common {
  diffStyle: DiffStyle;
  /** Dark or light rendering, following the app theme. */
  dark: boolean;
  selectedLines?: SelectedLineRange | null;
  onLineSelected?(range: SelectedLineRange | null): void;
  enableLineSelection?: boolean;
}

type Options = FileDiffOptions<undefined, undefined>;

function useDiffOptions(p: Common): Options {
  return useMemo<Options>(
    () => ({
      diffStyle: p.diffStyle,
      theme: { dark: "pierre-dark", light: "pierre-light" },
      themeType: p.dark ? "dark" : "light",
      hunkSeparators: "line-info",
      lineDiffType: "word-alt",
      diffIndicators: "bars",
      overflow: "scroll",
      stickyHeader: true,
      // Past these sizes a file renders as plain text (library defaults: 1000 / 100k); keeps generated and minified files from stalling the UI.
      tokenizeMaxLineLength: 400,
      tokenizeMaxLength: 60_000,
      enableLineSelection: p.enableLineSelection ?? false,
      onLineSelected: p.onLineSelected,
      // Selected lines must be unmistakable: accent tint plus a bar in the gutter.
      unsafeCSS: p.enableLineSelection
        ? `[data-selected-line] { background: color-mix(in srgb, #6c9cff 26%, transparent) !important; box-shadow: inset 3px 0 0 #6c9cff; }
           [data-selected-line] [data-line-number], [data-selected-line] .line-number { color: #6c9cff !important; font-weight: 700; }
           ${FLASH_CSS}`
        : FLASH_CSS,
    }),
    [p.diffStyle, p.dark, p.enableLineSelection, p.onLineSelected],
  );
}

/** Renders one or more files from a unified diff produced by git. */
export function PatchView(props: Common & { patch: string }) {
  const options = useDiffOptions(props);
  const files = useMemo(() => (props.patch.trim() ? processPatch(props.patch).files : []), [props.patch]);
  if (files.length === 0) return <div className="diff-empty muted">No textual changes.</div>;
  return (
    <div className="diff-files">
      {files.map((f) => (
        <FileDiff key={f.name} fileDiff={f} options={options} selectedLines={files.length === 1 ? (props.selectedLines ?? null) : null} className="diff" />
      ))}
    </div>
  );
}

/** Ad-hoc diff between two arbitrary file contents. */
export function FilesView(props: Common & { oldName: string; oldContents: string; newName: string; newContents: string }) {
  const options = useDiffOptions(props);
  const fileDiff = useMemo(
    () => parseDiffFromFile({ name: props.oldName, contents: props.oldContents }, { name: props.newName, contents: props.newContents }),
    [props.oldName, props.oldContents, props.newName, props.newContents],
  );
  return <FileDiff fileDiff={fileDiff} options={options} selectedLines={props.selectedLines ?? null} className="diff" />;
}
