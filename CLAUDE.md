# nekoit

Own git GUI replacing Git Extensions on Linux. Tauri 2 + React/TS; git via CLI only.

- `crates/nekoit-git` is pure Rust with no Tauri dependency so it builds and tests without the WebKitGTK headers; keep git parsing there, keep `src-tauri/src/commands.rs` a 1:1 thin mapping.
- Every git call goes through `Git::run*` so it lands in the UI command log. Never spawn `git` elsewhere.
- Rust structs are `serde(rename_all = "camelCase")`; mirror them by hand in `src/api.ts`.
- Worktrees are first-class: a repo = common git dir + N worktrees (user layout: `<project>/.bare` + sibling worktree folders, folder name often differs from branch). Graph/log run against `commonDir`; status/staging/commit run against a worktree path.
- Graph lane layout is `src/graph/layout.ts` (pure, unit-tested); rendering is `GraphCell.tsx`.
- Diff rendering is `@pierre/diffs` (`PatchDiff` for git patches, `FileDiff` + `parseDiffFromFile` for two arbitrary files). It renders in shadow DOM; style via its options, not CSS.
- Verify with `npm run typecheck`, `npm test`, `cargo test -p nekoit-git`. Don't run `cargo build` for the Tauri crate unless asked (slow, needs system headers).
