export function shortSha(sha: string, len = 8): string {
  return sha.slice(0, len);
}

const units: [string, number][] = [
  ["y", 365 * 24 * 3600],
  ["mo", 30 * 24 * 3600],
  ["w", 7 * 24 * 3600],
  ["d", 24 * 3600],
  ["h", 3600],
  ["m", 60],
];

/** Compact relative time like "3h", "2d", "5mo"; "now" under a minute. */
export function relativeTime(unixSeconds: number, now = Date.now() / 1000): string {
  if (!unixSeconds) return "";
  const diff = Math.max(0, now - unixSeconds);
  for (const [label, secs] of units) {
    if (diff >= secs) return `${Math.floor(diff / secs)}${label}`;
  }
  return "now";
}

export function absoluteTime(unixSeconds: number): string {
  if (!unixSeconds) return "";
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
