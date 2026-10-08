import { Filter, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

/**
 * Turn a filter string into a path predicate. Regex, case-insensitive; an
 * invalid pattern degrades to a substring match; empty matches everything.
 */
export function usePathFilter(query: string): (path: string) => boolean {
  return useMemo(() => {
    const q = query.trim();
    if (!q) return () => true;
    try {
      const re = new RegExp(q, "i");
      return (p: string) => re.test(p);
    } catch {
      const lower = q.toLowerCase();
      return (p: string) => p.toLowerCase().includes(lower);
    }
  }, [query]);
}

function isValidRegex(q: string): boolean {
  try {
    new RegExp(q);
    return true;
  } catch {
    return false;
  }
}

interface Props {
  value: string;
  onChange(v: string): void;
  placeholder?: string;
  /** Key that focuses this box: "/" (outside text fields) or "ctrl+f". */
  hotkey?: "/" | "ctrl+f" | null;
}

export function FilterBox({ value, onChange, placeholder = "filter (regex)", hotkey = "/" }: Props) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const inText = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
      const hit = hotkey === "/" ? e.key === "/" && !inText : e.key === "f" && e.ctrlKey && !e.shiftKey;
      if (hit) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey]);
  const invalid = value.trim() !== "" && !isValidRegex(value.trim());
  return (
    <label className={`filter ${invalid ? "is-plain" : ""}`} title={invalid ? "Not a valid regex: matching as plain text" : `Regular expression, case-insensitive.${hotkey ? ` Press ${hotkey} to focus,` : ""} Esc to clear.`}>
      <Filter size={12} className="muted" />
      <input
        ref={input}
        className="filter-input"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            if (value) onChange("");
            else (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {value && (
        <button className="filter-clear" onClick={() => onChange("")} aria-label="Clear filter" tabIndex={-1}>
          <X size={11} />
        </button>
      )}
    </label>
  );
}
