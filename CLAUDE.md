# Project Overview

`tasklens` is a VSCode extension that turns `.vscode/tasks.json` into a first-class, navigable surface. It lists every configured task in a hierarchical tree (grouped by name pattern), shows live running status, and exposes run / re-run / stop / tail / focus-definition actions per task. Reloads automatically when `tasks.json` is saved.

**Out of scope**: debugging a task. VSCode's debug surface (`launch.json`, F5) handles that.

Architectural detail and open design questions live in [BLUEPRINT.md](BLUEPRINT.md). Read it before changing the runner, tree, or log-tail subsystems.

# Stack

- **Language**: TypeScript (strict, target ES2022)
- **Bundler**: esbuild via [esbuild.js](esbuild.js) — single `dist/extension.js`
- **Package manager**: yarn classic (see [.yarnrc](.yarnrc))
- **Test**: `@vscode/test-cli` + Mocha (see [.vscode-test.mjs](.vscode-test.mjs))
- **Lint**: ESLint 9 flat config in [eslint.config.mjs](eslint.config.mjs)
- **VSCode engine**: ^1.118.0

# Code Conventions

- Source lives under [src/](src/); entry point is [src/extension.ts](src/extension.ts) exporting `activate` / `deactivate`.
- Group cohesive logic into folders: `src/tree/` (TreeDataProvider + grouping), `src/runner/` (execution + status registry), `src/logs/` (terminal focus), `src/jsonc/` (tasks.json parsing for focus-definition).
- Keep VSCode API calls at the edges; pure functions for parsing and grouping so they're unit-testable without a VSCode instance.
- Every event subscription, command registration, and disposable must be pushed onto `context.subscriptions`.
- Multi-root is supported. Always iterate `vscode.workspace.workspaceFolders ?? []`; no folder is a valid runtime state.
- Command IDs are namespaced under `tasklens.*` and declared in `package.json` `contributes.commands`.

# DO NOT

- Do not read `tasks.json` from disk to build the task list — use `vscode.tasks.fetchTasks()` so contributed tasks (npm, gulp, typescript) are included. The disk file is only consulted for **focus-definition**.
- Do not parse `tasks.json` with `JSON.parse` — it is JSONC (comments, trailing commas allowed). Use a JSONC parser that yields offsets, e.g., the `jsonc-parser` package.
- Do not capture or buffer task output. "Tail logs" reveals the existing terminal — see [BLUEPRINT.md §6](BLUEPRINT.md). No `OutputChannel`, no `shellIntegration`.
- Do not implement task debugging. It was explicitly removed from scope; do not re-add it without a design conversation.
- Do not use `FileSystemWatcher` for the reload trigger — use `onDidSaveTextDocument` filtered to `tasks.json`. Save-driven semantics are intentional.
- Do not commit `out/`, `dist/`, or `node_modules/`.
- Do not skip hooks (`--no-verify`) on commits.

# Key Patterns

- **Hierarchy**: derive a tree from flat task names by splitting `label` on a configurable separator (default `:`). E.g. `npm: watch:tsc` → `npm` > `watch` > `tsc`. Leaves are the actual tasks; intermediate nodes are synthetic groups.
- **Status registry**: a single `Map<TaskKey, TaskExecution>` is the source of truth for "is this task running". Updated from `vscode.tasks.onDidStartTask` / `onDidEndTask`. Tree refresh fires on every change.
- **Re-run**: re-run is `executeTask` against the same `Task` object. If a run is already in flight, terminate the existing `TaskExecution` first, then `executeTask` — surface a confirm prompt unless the user opts out.
- **Focus definition**: locate the task by `label` in the workspace's `tasks.json` using the JSONC parse tree, then `showTextDocument` + reveal the property range.
