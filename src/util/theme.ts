import { useEffect, useState } from "react";
import { useStore } from "../store";

/** True when the UI should render dark, honouring the config and the OS preference. */
export function useDarkTheme(): boolean {
  const pref = useStore((s) => s.config?.theme ?? "system");
  const [osDark, setOsDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = (e: MediaQueryListEvent) => setOsDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const dark = pref === "dark" || (pref === "system" && osDark);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  return dark;
}
