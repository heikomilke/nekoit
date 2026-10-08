import type { FileChange } from "../api";
import { basename, dirname } from "../util/format";

interface Props {
  files: FileChange[];
  /** Selected paths; at most two. */
  selected: string[];
  onSelect(path: string, extend: boolean): void;
  title: string;
}

const STATUS_LABEL: Record<string, string> = { A: "added", M: "modified", D: "deleted", R: "renamed", C: "copied", T: "type changed", U: "unmerged" };

/** Changed files of a commit or range; ctrl-click a second file to compare the two. */
export function FileList({ files, selected, onSelect, title }: Props) {
  return (
    <div className="file-list" role="listbox" aria-label={title}>
      <div className="pane-title">
        {title} <span className="muted">{files.length}</span>
      </div>
      {files.map((f) => {
        const sel = selected.includes(f.path);
        return (
          <div
            key={f.path}
            role="option"
            aria-selected={sel}
            className={`file-row ${sel ? "is-selected" : ""}`}
            onClick={(e) => onSelect(f.path, e.ctrlKey || e.metaKey)}
            title={`${STATUS_LABEL[f.status] ?? f.status}${f.oldPath ? ` from ${f.oldPath}` : ""}`}
          >
            <span className={`status status-${f.status}`}>{f.status}</span>
            <span className="file-name">{basename(f.path)}</span>
            <span className="file-dir muted">{dirname(f.path)}</span>
          </div>
        );
      })}
      {files.length === 0 && <div className="muted pad">No changes.</div>}
    </div>
  );
}
