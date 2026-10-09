import { create } from "zustand";
import {
  api,
  type AppConfig,
  type Commit,
  type CommandRecord,
  type RefInfo,
  type RepoInfo,
  type WorktreeInfo,
  type WorktreeStatus,
} from "./api";
import { computeTracks } from "./graph/tracks";
import { errorMessage } from "./util/format";

export type Screen = { kind: "dashboard" } | { kind: "repo"; repoId: string };

const PAGE = 500;

/** Pseudo-sha selecting the working changes of the active worktree. */
export const WORKDIR = "WORKDIR";

export interface RepoState {
  repo: RepoInfo;
  /** Worktree whose working directory is the context for status/commit. */
  worktree: WorktreeInfo | null;
  commits: Commit[];
  hasMore: boolean;
  loadingLog: boolean;
  refs: RefInfo[];
  refsBySha: Map<string, RefInfo[]>;
  worktreesBySha: Map<string, WorktreeInfo[]>;
  /** Branch name each commit's lane belongs to, by first-parent descent from the tips. */
  tracks: Map<string, string>;
  /** Status per worktree path, loaded lazily. */
  statuses: Record<string, WorktreeStatus | undefined>;
  /** Selected commit shas, newest-first as clicked; at most two. */
  selected: string[];
}

interface State {
  config: AppConfig | null;
  repos: RepoInfo[];
  loadingRepos: boolean;
  screen: Screen;
  current: RepoState | null;
  commandLog: CommandRecord[];
  logOpen: boolean;
  error: string | null;
  /** Transient success message, cleared automatically. */
  notice: string | null;
  /** Message prefilled into the commit box the next time the changes view opens. */
  commitDraft: string | null;

  init(): Promise<void>;
  saveConfig(patch: Partial<AppConfig>): Promise<void>;
  refreshRepos(): Promise<void>;
  addScanRoot(root: string): Promise<void>;
  removeScanRoot(root: string): Promise<void>;
  addRepo(path: string): Promise<void>;
  openRepo(repo: RepoInfo, worktree?: WorktreeInfo): Promise<void>;
  closeRepo(): void;
  selectWorktree(wt: WorktreeInfo): void;
  reloadLog(): Promise<void>;
  loadMore(): Promise<void>;
  refreshStatus(worktreePath: string): Promise<void>;
  select(sha: string, extend: boolean): void;
  pushCommand(rec: CommandRecord): void;
  /** Re-run git status for every worktree of the open repo. */
  refreshStatuses(): void;
  toggleLog(): void;
  setError(msg: string | null): void;
  setNotice(msg: string | null): void;
  setCommitDraft(msg: string | null): void;
}

function indexRefs(refs: RefInfo[]): Map<string, RefInfo[]> {
  const m = new Map<string, RefInfo[]>();
  for (const r of refs) {
    const list = m.get(r.sha) ?? [];
    list.push(r);
    m.set(r.sha, list);
  }
  const order = { branch: 0, remote: 1, tag: 2, stash: 3, other: 4 };
  for (const list of m.values()) list.sort((a, b) => order[a.kind] - order[b.kind] || a.short.localeCompare(b.short));
  return m;
}

function indexWorktrees(wts: WorktreeInfo[]): Map<string, WorktreeInfo[]> {
  const m = new Map<string, WorktreeInfo[]>();
  for (const w of wts) {
    const list = m.get(w.head) ?? [];
    list.push(w);
    m.set(w.head, list);
  }
  return m;
}

/** Pick the worktree to use as context: last used, else newest HEAD. */
function defaultWorktree(repo: RepoInfo, last: string | null): WorktreeInfo | null {
  if (repo.worktrees.length === 0) return null;
  const remembered = last ? repo.worktrees.find((w) => w.path === last) : undefined;
  return remembered ?? [...repo.worktrees].sort((a, b) => b.headTime - a.headTime)[0];
}

export const useStore = create<State>((set, get) => ({
  config: null,
  repos: [],
  loadingRepos: false,
  screen: { kind: "dashboard" },
  current: null,
  commandLog: [],
  logOpen: false,
  error: null,
  notice: null,
  commitDraft: null,

  async init() {
    try {
      const config = await api.getConfig();
      set({ config });
      await get().refreshRepos();
      const { repos } = get();
      const last = config.lastRepo ? repos.find((r) => r.id === config.lastRepo) : undefined;
      if (last) await get().openRepo(last);
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  async saveConfig(patch) {
    const base = get().config ?? { scanRoots: [], repos: [], lastRepo: null, lastWorktree: null, theme: "system" as const, editor: "" };
    const config = { ...base, ...patch };
    set({ config });
    await api.setConfig(config);
  },

  async refreshRepos() {
    set({ loadingRepos: true });
    try {
      const repos = await api.listRepos();
      set({ repos });
    } catch (e) {
      set({ error: errorMessage(e) });
    } finally {
      set({ loadingRepos: false });
    }
  },

  async addScanRoot(root) {
    const roots = get().config?.scanRoots ?? [];
    if (roots.includes(root)) return;
    await get().saveConfig({ scanRoots: [...roots, root] });
    await get().refreshRepos();
  },

  async removeScanRoot(root) {
    const roots = get().config?.scanRoots ?? [];
    await get().saveConfig({ scanRoots: roots.filter((r) => r !== root) });
    await get().refreshRepos();
  },

  async addRepo(path) {
    const repos = get().config?.repos ?? [];
    if (repos.includes(path)) return;
    await get().saveConfig({ repos: [...repos, path] });
    await get().refreshRepos();
  },

  async openRepo(repo, worktree) {
    const wt = worktree ?? defaultWorktree(repo, get().config?.lastWorktree ?? null);
    set({
      screen: { kind: "repo", repoId: repo.id },
      current: {
        repo,
        worktree: wt,
        commits: [],
        hasMore: false,
        loadingLog: true,
        refs: [],
        refsBySha: new Map(),
        worktreesBySha: indexWorktrees(repo.worktrees),
        tracks: new Map(),
        statuses: {},
        // Land on the working changes of the active worktree, changed or not.
        selected: wt ? [WORKDIR] : [],
      },
    });
    void get().saveConfig({ lastRepo: repo.id, lastWorktree: wt?.path ?? null });
    await get().reloadLog();
    for (const w of repo.worktrees) void get().refreshStatus(w.path);
  },

  closeRepo() {
    set({ screen: { kind: "dashboard" }, current: null });
    void get().saveConfig({ lastRepo: null });
    void get().refreshRepos();
  },

  selectWorktree(wt) {
    const cur = get().current;
    if (!cur) return;
    set({ current: { ...cur, worktree: wt } });
    void get().saveConfig({ lastWorktree: wt.path });
  },

  async reloadLog() {
    const cur = get().current;
    if (!cur) return;
    const dir = cur.repo.commonDir;
    set({ current: { ...cur, loadingLog: true } });
    try {
      const [page, refs, worktrees] = await Promise.all([
        api.log(dir, { all: true, limit: PAGE, revs: cur.repo.worktrees.map((w) => w.head).filter((h) => !/^0+$/.test(h)) }),
        api.refs(dir),
        api.worktrees(dir),
      ]);
      const now = get().current;
      if (!now || now.repo.id !== cur.repo.id) return;
      const repo = { ...now.repo, worktrees };
      for (const w of worktrees) void get().refreshStatus(w.path);
      const refsBySha = indexRefs(refs);
      const worktreesBySha = indexWorktrees(worktrees);
      const worktree = worktrees.find((w) => w.path === now.worktree?.path) ?? now.worktree;
      set({
        current: {
          ...now,
          repo,
          worktree,
          commits: page.commits,
          hasMore: page.hasMore,
          loadingLog: false,
          refs,
          refsBySha,
          worktreesBySha,
          tracks: computeTracks(page.commits, refsBySha, worktreesBySha),
          selected: now.selected.filter((s) => s === WORKDIR || page.commits.some((c) => c.sha === s)),
        },
      });
    } catch (e) {
      set({ error: errorMessage(e), current: { ...cur, loadingLog: false } });
    }
  },

  async loadMore() {
    const cur = get().current;
    if (!cur || cur.loadingLog || !cur.hasMore) return;
    set({ current: { ...cur, loadingLog: true } });
    try {
      const page = await api.log(cur.repo.commonDir, {
        all: true,
        limit: PAGE,
        skip: cur.commits.length,
        revs: cur.repo.worktrees.map((w) => w.head).filter((h) => !/^0+$/.test(h)),
      });
      const now = get().current;
      if (!now || now.repo.id !== cur.repo.id) return;
      const commits = [...now.commits, ...page.commits];
      set({ current: { ...now, commits, hasMore: page.hasMore, loadingLog: false, tracks: computeTracks(commits, now.refsBySha, now.worktreesBySha) } });
    } catch (e) {
      set({ error: errorMessage(e), current: { ...cur, loadingLog: false } });
    }
  },

  async refreshStatus(worktreePath) {
    try {
      const st = await api.status(worktreePath);
      const cur = get().current;
      if (!cur) return;
      set({ current: { ...cur, statuses: { ...cur.statuses, [worktreePath]: st } } });
    } catch {
      // unborn or broken worktree: leave status empty
    }
  },

  select(sha, extend) {
    const cur = get().current;
    if (!cur) return;
    let selected: string[];
    if (!extend) selected = [sha];
    else if (cur.selected.includes(sha)) selected = cur.selected.filter((s) => s !== sha);
    else selected = [sha, ...cur.selected].slice(0, 2);
    set({ current: { ...cur, selected } });
  },

  pushCommand(rec) {
    set((s) => ({ commandLog: [...s.commandLog.slice(-499), rec] }));
  },

  refreshStatuses() {
    const cur = get().current;
    if (!cur) return;
    for (const w of cur.repo.worktrees) void get().refreshStatus(w.path);
  },

  toggleLog() {
    set((s) => ({ logOpen: !s.logOpen }));
  },

  setError(msg) {
    set({ error: msg });
  },

  setCommitDraft(msg) {
    set({ commitDraft: msg });
  },

  setNotice(msg) {
    set({ notice: msg });
    if (msg) setTimeout(() => get().notice === msg && set({ notice: null }), 6000);
  },
}));
