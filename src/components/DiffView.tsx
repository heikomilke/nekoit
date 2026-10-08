import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff, PatchDiff, type FileDiffOptions, type SelectedLineRange } from "@pierre/diffs/react";
import { useMemo } from "react";

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
      enableLineSelection: p.enableLineSelection ?? false,
      onLineSelected: p.onLineSelected,
    }),
    [p.diffStyle, p.dark, p.enableLineSelection, p.onLineSelected],
  );
}

/** Renders one or more files from a unified diff produced by git. */
export function PatchView(props: Common & { patch: string }) {
  const options = useDiffOptions(props);
  if (!props.patch.trim()) return <div className="diff-empty muted">No textual changes.</div>;
  return <PatchDiff patch={props.patch} options={options} selectedLines={props.selectedLines ?? null} className="diff" />;
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
