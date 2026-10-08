# nekoit

A git GUI for Linux (and later other desktops) that keeps the parts of Git
Extensions worth keeping: a dense revision graph across all branches, commit
details with a per-file diff right below, ad-hoc diffs between any two commits
or files, a keyboard-driven commit dialog with line-level staging, and a log of
every git command the app runs. Worktrees are first-class: a repository is one
git dir plus any number of worktrees, and the UI shows them as such.

Built by Heiko Milke with AI assistance (Claude Code). MIT licensed.

## Stack

- Tauri 2 shell (Rust) with a React 19 + TypeScript front end (Vite).
- All git access goes through the `git` CLI (`crates/nekoit-git`), never libgit2,
  so hooks, credential helpers, config and new git features behave exactly as
  on the command line.
- Diffs are rendered by [`@pierre/diffs`](https://diffs.com) (Shiki based).

## Layout

```
crates/nekoit-git/   pure Rust: discovery, worktrees, log/refs, diff, status, staging
src-tauri/           thin Tauri command layer, config file, command-log events
src/                 React UI: dashboard, repo view (graph + details), diff pane
```

## Develop

Prerequisites on Ubuntu:

```
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
curl https://sh.rustup.rs -sSf | sh      # Rust toolchain
```

Then:

```
npm install
npm run tauri dev        # hot-reloading app
npm run typecheck        # tsc
npm test                 # vitest (graph layout etc.)
cargo test -p nekoit-git # Rust unit tests
npm run release          # optimised build, installed to ~/.local/bin/nekoit for the desktop launcher
cargo run -p nekoit-git --example probe -- ~/projects ~/projects/app/main   # exercise the git layer
```

Config lives in `~/.config/nekoit/config.json` (scan roots, added repos, last
opened repo/worktree, theme).

## Keyboard

| Key | Action |
| --- | --- |
| `↑` `↓` / `j` `k` | move commit selection |
| `shift`+arrow, `ctrl`+click | select a second commit → diff the range |
| `ctrl`+click in file list | select a second file → diff the two files |
| `F5` | reload log |
| `Esc` | back to the dashboard |
| ``ctrl+` `` | toggle the git command log |

Fetch, pull (merge, rebase or fast-forward only) and push (plain, set
upstream, force-with-lease) live in the repo header and act on the active
worktree.

## License

MIT, see `LICENSE`.
