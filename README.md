# tasklens

A VSCode extension that turns `.vscode/tasks.json` into a first-class, navigable surface in its own activity-bar container — list, run, re-run, stop, tail, favorite, and jump-to-definition for every task.

## Features

- **Two views, one panel**:
  - **Workspace** — tasks defined in `.vscode/tasks.json`.
  - **Auto-detected** — contributed tasks (npm, gulp, typescript, …).
- **Hierarchical grouping** — task labels are split on a configurable separator (default `::`) into nested, foldable groups. A task named `db::migrate::up` shows under `db` › `migrate` › `up`.
- **Favorites** — pin frequently-used tasks to a `★ Favorites` group at the top of each view. Per-workspace, persisted across reloads.
- **Live status** — each task row shows an icon for its current state: idle, running (spinner), succeeded, failed.
- **Inline actions** — run / stop / show-terminal / star buttons appear on hover. Context menu has the same actions plus *Re-run* and *Reveal Definition*.
- **Re-run** — terminates the in-flight execution (with optional confirm), waits for it to end, then starts fresh.
- **Tail logs** — reveals the integrated terminal hosting the task. No output capture, no buffering.
- **Reveal definition** — opens `tasks.json` and selects the matching task object (JSONC-aware: comments and trailing commas are fine).
- **Auto-reload on save** — saving `tasks.json` refreshes both views. Manual `Reload Tasks` button is also available.
- **Empty-state CTAs** — prompts to open a folder or scaffold `tasks.json` when missing.
- **Multi-root aware** — workspaces with multiple folders bucket tasks by folder before grouping.

Out of scope: editing tasks, scheduling, debugging a task (use `launch.json` / F5).

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `tasklens.groupSeparator` | string | `"::"` | Separator used to derive the hierarchical task tree from task labels. E.g. with `::`, a task named `root::branch1::task1` is nested under `root` › `branch1` › `task1`. |
| `tasklens.confirmRerunIfRunning` | boolean | `true` | Show a confirmation prompt when re-running a task that is already running. |

## Commands

| Command | Title | Surface |
|---|---|---|
| `tasklens.reload` | Reload Tasks | View title bar, palette |
| `tasklens.createTasksJson` | Create tasks.json | Welcome view, palette |
| `tasklens.runTask` | Run Task | Inline ▶ on idle tasks |
| `tasklens.stopTask` | Stop Task | Inline ⏹ on running tasks |
| `tasklens.tailLogs` | Show Task Terminal | Inline 🖥 on running tasks |
| `tasklens.rerunTask` | Re-run Task | Context menu |
| `tasklens.addFavorite` | Add to Favorites | Inline ☆ / context menu (un-favorited) |
| `tasklens.removeFavorite` | Remove from Favorites | Inline ★ / context menu (favorited) |
| `tasklens.revealDefinition` | Reveal Definition | Default click, context menu |

## How grouping works

The grouping separator is applied to each task's `label`. A task named `npm: watch:tsc` (the source-prefixed form VSCode uses for contributed tasks) with the default `::` separator stays as a flat leaf. Switch the separator to `:` if you prefer the legacy npm/gulp-style nesting.

Multi-root workspaces bucket by folder first, then group by separator within each bucket. Tasks scoped to `Workspace` / `Global` go into a synthetic *Workspace* group.

## Architecture

See [BLUEPRINT.md](BLUEPRINT.md) for the as-built architecture: module layout, data model, runner/status registry, log-tailing strategy, JSONC reveal-definition, and resolved design decisions.

## Development

```bash
yarn install
yarn watch         # esbuild + tsc in watch mode
# F5 in VSCode to launch the Extension Development Host
yarn test          # @vscode/test-cli + Mocha
yarn package       # production bundle
```

Source lives under [src/](src/); entry point is [src/extension.ts](src/extension.ts). Pure modules ([src/tree/group.ts](src/tree/group.ts), [src/jsonc/locate.ts](src/jsonc/locate.ts), [src/favorites/store.ts](src/favorites/store.ts)) take plain data and import nothing from `vscode` so they are unit-testable without a VSCode instance.
