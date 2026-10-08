import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// --- Types mirrored from crates/nekoit-git (serde camelCase) -------------

export interface WorktreeInfo {
  path: string;
  name: string;
  head: string;
  branch: string | null;
  detached: boolean;
  isMain: boolean;
  locked: boolean;
  prunable: boolean;
  headTime: number;
}

export interface RepoInfo {
  id: string;
  name: string;
  path: string;
  commonDir: string;
  bare: boolean;
  worktrees: WorktreeInfo[];
  lastActivity: number;
}

export interface Commit {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorTime: number;
  committerName: string;
  commitTime: number;
  subject: string;
}

export interface CommitDetails extends Commit {
  committerEmail: string;
  body: string;
}

export type RefKind = "branch" | "remote" | "tag" | "stash" | "other";

export interface RefInfo {
  name: string;
  short: string;
  kind: RefKind;
  sha: string;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface LogOptions {
  all: boolean;
  revs: string[];
  limit: number;
  skip: number;
  path: string | null;
  firstParent: boolean;
}

export interface LogPage {
  commits: Commit[];
  hasMore: boolean;
}

export interface FileChange {
  status: string;
  score: number | null;
  path: string;
  oldPath: string | null;
}

export interface BranchStatus {
  head: string | null;
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface StatusEntry {
  path: string;
  origPath: string | null;
  index: string;
  worktree: string;
  untracked: boolean;
  ignored: boolean;
  unmerged: boolean;
  submodule: boolean;
}

export interface WorktreeStatus {
  branch: BranchStatus;
  entries: StatusEntry[];
}

export interface CommandRecord {
  id: number;
  cwd: string;
  args: string[];
  exitCode: number | null;
  durationMs: number;
  startedAtMs: number;
  stderr: string;
}

export type PullMode = "merge" | "rebase" | "ff-only";

export interface RemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface RemoteResult {
  stdout: string;
  stderr: string;
}

export type Theme = "system" | "light" | "dark";

export interface AppConfig {
  scanRoots: string[];
  repos: string[];
  lastRepo: string | null;
  lastWorktree: string | null;
  theme: Theme;
  /** Editor command, `{file}` placeholder; empty = xdg-open. */
  editor: string;
}

// --- Commands ------------------------------------------------------------

export const api = {
  getConfig: () => invoke<AppConfig>("get_config"),
  setConfig: (config: AppConfig) => invoke<void>("set_config", { config }),
  listRepos: () => invoke<RepoInfo[]>("list_repos"),
  scanFolder: (root: string, depth = 1) => invoke<RepoInfo[]>("scan_folder", { root, depth }),
  inspectRepo: (path: string) => invoke<RepoInfo>("inspect_repo", { path }),
  worktrees: (repo: string) => invoke<WorktreeInfo[]>("worktrees", { repo }),
  log: (repo: string, options: Partial<LogOptions>) =>
    invoke<LogPage>("log", {
      repo,
      options: { all: true, revs: [], limit: 1000, skip: 0, path: null, firstParent: false, ...options },
    }),
  refs: (repo: string) => invoke<RefInfo[]>("refs", { repo }),
  refsContaining: (repo: string, sha: string) => invoke<string[]>("refs_containing", { repo, sha }),
  commitDetails: (repo: string, rev: string) => invoke<CommitDetails>("commit_details", { repo, rev }),
  commitChanges: (repo: string, sha: string) => invoke<FileChange[]>("commit_changes", { repo, sha }),
  changesBetween: (repo: string, base: string, target: string) =>
    invoke<FileChange[]>("changes_between", { repo, base, target }),
  commitPatch: (repo: string, sha: string, path?: string) =>
    invoke<string>("commit_patch", { repo, sha, path: path ?? null }),
  rangePatch: (repo: string, base: string, target: string, path?: string) =>
    invoke<string>("range_patch", { repo, base, target, path: path ?? null }),
  worktreePatch: (worktree: string, path: string | null, staged: boolean, untracked: boolean) =>
    invoke<string>("worktree_patch", { worktree, path, staged, untracked }),
  fileAt: (worktree: string, rev: string | null, path: string) => invoke<string>("file_at", { worktree, rev, path }),
  status: (worktree: string) => invoke<WorktreeStatus>("status", { worktree }),
  stage: (worktree: string, paths: string[]) => invoke<void>("stage", { worktree, paths }),
  unstage: (worktree: string, paths: string[]) => invoke<void>("unstage", { worktree, paths }),
  applyToIndex: (worktree: string, patch: string, reverse: boolean) =>
    invoke<void>("apply_to_index", { worktree, patch, reverse }),
  discard: (worktree: string, tracked: string[], untracked: string[]) =>
    invoke<void>("discard", { worktree, tracked, untracked }),
  commit: (worktree: string, message: string, amend: boolean, author?: string) =>
    invoke<string>("commit", { worktree, message, amend, author: author ?? null }),
  resolve: (repo: string, rev: string) => invoke<string>("resolve", { repo, rev }),
  addToGitignore: (worktree: string, pattern: string, openEditor = true) => invoke<string>("add_to_gitignore", { worktree, pattern, openEditor }),
  openTerminal: (dir: string) => invoke<string>("open_terminal", { dir }),
  remotes: (repo: string) => invoke<RemoteInfo[]>("remotes", { repo }),
  fetch: (repo: string, remote: string | null, prune = true) => invoke<RemoteResult>("fetch", { repo, remote, prune }),
  pull: (worktree: string, mode: PullMode, remote: string | null = null, branch: string | null = null) =>
    invoke<RemoteResult>("pull", { worktree, mode, remote, branch }),
  push: (worktree: string, opts: { remote?: string | null; branch?: string | null; setUpstream?: boolean; forceWithLease?: boolean } = {}) =>
    invoke<RemoteResult>("push", {
      worktree,
      remote: opts.remote ?? null,
      branch: opts.branch ?? null,
      setUpstream: opts.setUpstream ?? false,
      forceWithLease: opts.forceWithLease ?? false,
    }),
};

export function onGitCommand(handler: (record: CommandRecord) => void): Promise<UnlistenFn> {
  return listen<CommandRecord>("git-command", (e) => handler(e.payload));
}

