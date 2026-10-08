import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  hint?: string;
  onClick(): void;
  disabled?: boolean;
  danger?: boolean;
  /** Renders a separator above this item. */
  separator?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose(): void;
}

/** Popup menu at viewport coordinates; closes on outside click, Esc, or after an item runs. */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y]);

  useEffect(() => {
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div ref={root} className="menu-popup ctx-menu" role="menu" style={{ left: pos.x, top: pos.y }}>
      {items.map((it, i) => (
        <button
          key={i}
          role="menuitem"
          className={`menu-item ${it.danger ? "is-danger" : ""} ${it.separator ? "has-separator" : ""}`}
          disabled={it.disabled}
          onClick={() => {
            onClose();
            it.onClick();
          }}
        >
          <span>{it.label}</span>
          {it.hint && <span className="menu-hint">{it.hint}</span>}
        </button>
      ))}
    </div>
  );
}
