/** Ignore patterns worth offering for a path inside the worktree: [pattern, label]. */
export function ignoreSuggestions(path: string): [string, string][] {
  const out: [string, string][] = [[`/${path}`, "this file"]];
  const slash = path.lastIndexOf("/");
  if (slash > 0) out.push([`/${path.slice(0, slash)}/`, `folder ${path.slice(0, slash)}/`]);
  const dot = path.lastIndexOf(".");
  if (dot > slash + 1 && dot < path.length - 1) out.push([`*.${path.slice(dot + 1)}`, `every *.${path.slice(dot + 1)}`]);
  return out;
}
