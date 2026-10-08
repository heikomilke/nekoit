import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

interface Props {
  direction: "horizontal" | "vertical";
  /** Initial size of the first pane in px. */
  initial: number;
  min?: number;
  storageKey?: string;
  first: ReactNode;
  second: ReactNode;
  className?: string;
}

function readStored(key: string | undefined, fallback: number): number {
  if (!key) return fallback;
  try {
    const v = localStorage.getItem(`split:${key}`);
    return v ? Number(v) || fallback : fallback;
  } catch {
    return fallback;
  }
}

/** Two panes with a draggable divider; the first pane has a fixed size, the second flexes. */
export function SplitPane({ direction, initial, min = 120, storageKey, first, second, className }: Props) {
  const [size, setSize] = useState(() => readStored(storageKey, initial));
  const dragging = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const horizontal = direction === "horizontal";

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current || !container.current) return;
      const rect = container.current.getBoundingClientRect();
      const raw = horizontal ? e.clientX - rect.left : e.clientY - rect.top;
      const max = (horizontal ? rect.width : rect.height) - min;
      setSize(Math.max(min, Math.min(max, raw)));
    };
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      setSize((s) => {
        if (storageKey) {
          try {
            localStorage.setItem(`split:${storageKey}`, String(s));
          } catch {
            // ignore
          }
        }
        return s;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [horizontal, min, storageKey]);

  return (
    <div ref={container} className={`split split-${direction} ${className ?? ""}`}>
      <div className="split-first" style={horizontal ? { width: size } : { height: size }}>
        {first}
      </div>
      <div className="split-divider" onPointerDown={onPointerDown} role="separator" aria-orientation={horizontal ? "vertical" : "horizontal"} />
      <div className="split-second">{second}</div>
    </div>
  );
}
