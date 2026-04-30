# tasklens — Architecture Blueprint

This document is the load-bearing reference for what `tasklens` does and how it is built. It describes the **as-built** shape of the extension. Update it when the design changes; do not let the code drift from it silently.

## 1. Goals

`tasklens` surfaces VSCode tasks as a navigable, observable, actionable panel in its own activity-bar container. The extension supports:

1. **List** every task, hierarchically grouped by name pattern, split into two top-level views — **Workspace** (explicitly defined in `tasks.json`) and **Auto-detected** (contributed by npm/typescript/gulp/etc.).
2. **Run** a task.
3. **Re-run** a task — terminate the in-flight execution (with optional confirm), wait for end, then start fresh.
4. **Stop** a running task.
5. **See running status** at a glance — per-task status icon (idle / running spinner / succeeded / failed).
6. **Tail logs** — reveals the integrated terminal the task is running in (no output capture).
7. **Reveal definition** — opens `tasks.json` and selects the matching task object.
8. **Reload** the task list — automatic when `tasks.json` is saved; also user-invokable.
9. **Favorite** any task — pin to a synthetic `★ Favorites` group at the top of each view; persisted per-workspace.
10. **Empty-state CTAs** — when no folder is open, prompt to open one; when a folder is open but has no `tasks.json`, prompt to scaffold one with a starter template.

Non-goals: editing tasks, scheduling, cross-workspace sharing, remote-SSH-specific behavior, **debugging a task** (VSCode's `launch.json` / F5 surface owns that).

## 2. Module Layout

```
src/
  extension.ts             # activate/deactivate; wires modules; registers FS watchers and event subscriptions
  commands.ts              # registers tasklens.* commands; thin handler glue
  tasksJson.ts             # detect / scaffold .vscode/tasks.json; exposes the noTasksJson context-key updater
  types.ts                 # TaskKey, TaskStatus, TaskNode + taskKey()
  tree/
    provider.ts            # TreeDataProvider<TaskNode> with a TaskFilter predicate
    filters.ts             # workspaceTaskFilter / builtinTaskFilter (source-based discriminator)
    group.ts               # pure: flat tasks → hierarchical TaskNode tree (split-by-separator)
    icons.ts               # status → ThemeIcon mapping (+ folder/group icons)
  runner/
    registry.ts            # Map<TaskKey, TaskExecution> + onChange event + waitForEnd helper
    execute.ts             # runTask / rerunTask / stopTask wrappers
  logs/
    focus.ts               # finds the Terminal hosting a running task and reveals it
  jsonc/
    locate.ts              # pure: parse JSONC tasks.json + label → byte offset/length of the matching object
  favorites/
    store.ts               # pure-ish: Set<TaskKey> backed by Memento; emits onDidChange
  test/
    group.test.ts          # unit tests for grouping
    locate.test.ts         # unit tests for JSONC location
    extension.test.ts      # smoke
media/
  tasklens.svg             # 24×24 currentColor SVG used as the activity-bar container icon
```

Pure modules (`tree/group.ts`, `jsonc/locate.ts`) take plain data, return plain data, and import nothing from `vscode`. They are unit-testable with Mocha alone.

## 3. Data Model

```ts
type TaskKey = string;       // `${source}::${name}::${scope}` — stable across refreshes

type TaskStatus = 'idle' | 'running' | 'succeeded' | 'failed';

interface TaskNode {
  kind: 'group' | 'task';
  label: string;             // display text — segment for groups, leaf label for tasks
  children: TaskNode[];      // empty for leaf tasks
  fullLabel?: string;        // tasks only — original `Task.name`
  task?: vscode.Task;        // tasks only
  key?: TaskKey;             // tasks only
  folderName?: string;       // groups only — present when this group represents a workspace folder
  favorite?: boolean;        // tasks only — drives the .favorite contextValue suffix
  favoritesGroup?: boolean;  // groups only — flags the synthetic "Favorites" root group
}
```

`TaskKey` is built from `Task.source + Task.name + scope` because labels can collide across sources (e.g. an `npm`-source task and a workspace-source task with the same name). The `scope` portion serializes to `global` / `workspace` / `folder:<uri>` / `undefined`.

## 4. Tree & Hierarchy

- **Source**: `vscode.tasks.fetchTasks()` returns user, workspace, and contributed tasks. The same fetch feeds both views; each view's provider applies its own `TaskFilter` after the fetch.
- **View split** (top-level):
  - **Workspace** — `task.source === 'Workspace'` (tasks defined in `.vscode/tasks.json`).
  - **Auto-detected** — everything else (npm, typescript, gulp, …).
- **Within each view**: groups derive from the leaf `Task.name` by splitting on a separator (default `::`, configurable via `tasklens.groupSeparator`):
  - `"db::migrate::up"` → `db` › `migrate` › `up`
  - `"build"` → top-level leaf
  - With separator `:`, `"npm: watch:tsc"` → `npm` › `watch` › `tsc`
- **Favorites**: a synthetic `★ Favorites` group is prepended to the root when the workspace has any favorited tasks for the view. Children are flat task leaves (no nested grouping inside the favorites group). Favorited tasks still appear in their normal grouped location, with the same star indicator. The group only renders when non-empty.
- **Leaf description** — `Task.definition.type` (e.g. `shell`, `process`, `npm`) is shown to the right of the leaf label.
- **Multi-root scoping**: when `workspaceFolders.length > 1`, each view first buckets tasks by their owning folder (top-level groups become folder nodes), then groups by separator within each bucket. Tasks with non-folder scope (`Workspace` / `Global`) bucket into a synthetic "Workspace" group. Single-folder workspaces render flat.
- **Leaf icons**: status-driven — `circle-large-outline` (idle), `sync~spin` blue (running), `pass` green (succeeded), `error` red (failed). Group icons are `folder`; folder-named groups use `root-folder`; the favorites group uses `star-full` tinted with `charts.yellow`.

## 5. Runner & Status Registry

`runner/registry.ts` owns the canonical state for "is this task running":

- `Map<TaskKey, TaskExecution>` — live executions.
- `Map<TaskKey, 'succeeded' | 'failed'>` — last-result cache; cleared when the task starts again.
- `EventEmitter<TaskKey>` — fires on every state transition; both tree providers subscribe.
- Subscriptions (registered once at activation):
  - `vscode.tasks.onDidStartTask` → register execution, clear last-result, fire.
  - `vscode.tasks.onDidEndTask` → drop execution, fire.
  - `vscode.tasks.onDidEndTaskProcess` → record exit-code-derived status, fire.
- `waitForEnd(key, timeoutMs = 10_000)` — promise that resolves on the next end-event for the key, or rejects on timeout. Used by `rerunTask`.

`runner/execute.ts` wraps the registry:

```ts
runTask(task)               // vscode.tasks.executeTask(task)
stopTask(task, registry)    // execution.terminate(); info-message if not running
rerunTask(task, registry)   // if running: optional confirm → terminate → waitForEnd → executeTask
```

`tasklens.confirmRerunIfRunning` (boolean, default `true`) gates the modal restart confirmation.

## 6. Log tailing — terminal focus

We do **not** capture task output. "Tail logs" reveals the terminal the task is already running in.

1. VSCode runs each task in a dedicated integrated terminal whose name embeds the task label.
2. On invoke, scan `vscode.window.terminals` for the terminal matching the task. Match heuristic, in order:
   a. Exact name match against `task.name`.
   b. Substring match (`terminal.name.includes(task.name)`).
3. Call `terminal.show(false)` to reveal and focus it.
4. If no terminal is found (task already ended, or `presentation.reveal: never`), show an info message: "No terminal for `<label>` — task may have ended or been launched without a visible terminal."

No `OutputChannel`, no `shellIntegration`, no per-task buffering. The terminal is the source of truth.

## 7. Reveal definition (JSONC)

`jsonc/locate.ts` is a pure function:

```ts
locateTaskInJsonc(text: string, label: string): { offset: number; length: number } | null
```

It uses `jsonc-parser`'s `parseTree` + `findNodeAtLocation` to walk `$.tasks[*].label` and return the byte range of the first matching task object — tolerant of comments and trailing commas.

The `tasklens.revealDefinition` handler:

1. Resolves the owning `WorkspaceFolder` via `task.scope` (folder scope → that folder; otherwise the first workspace folder).
2. Opens `<folder>/.vscode/tasks.json` (info-message if missing).
3. Locates the task; reveals + selects the range. If the label isn't in `tasks.json` (i.e., a contributed task), opens the file and shows an info message instead.

## 7a. Favorites

`favorites/store.ts` owns favorite-task state:

- Backing storage: `vscode.Memento` — passed in as `context.workspaceState`, so favorites are per-workspace and survive reloads but do not leak across projects.
- Storage key: `tasklens.favorites` → `TaskKey[]`.
- API: `has(key)`, `list()`, `add(key)`, `remove(key)` — write paths persist via `Memento.update` and fire `onDidChange`.
- Each `TasksTreeProvider` subscribes to `onDidChange` and calls `reload()` so both views refresh in lockstep when favorites change.

**ContextValue scheme** for task leaves:

| State | `viewItem` |
|---|---|
| idle, not favorited | `task` |
| running, not favorited | `task.running` |
| idle, favorited | `task.favorite` |
| running, favorited | `task.running.favorite` |

`view/item/context` `when` clauses match these via regex (e.g. `viewItem =~ /\.favorite$/` shows the *Remove from Favorites* item; `viewItem =~ /^task(\.running)?$/` shows *Add to Favorites*).

## 8. Empty-state and `tasks.json` lifecycle

`src/tasksJson.ts` owns three concerns:

- **Detection** — `anyFolderHasTasksJson()` stats `<folder>/.vscode/tasks.json` for every workspace folder.
- **Context-key sync** — `refreshNoTasksJsonContext()` sets `tasklens.noTasksJson` (boolean) via `setContext`. This drives the welcome view's `when` clause.
- **Scaffold** — `createTasksJson()` (a) picks a folder (auto when single-root, picker when multi-root), (b) creates `.vscode/` if needed, (c) writes a starter `tasks.json` with one `echo` task and the standard JSONC header comment, (d) opens it.

The context key is refreshed at activation, on workspace-folder changes, and via a `FileSystemWatcher('**/.vscode/tasks.json')` listening **only to create/delete** (`ignoreChangeEvents: true`). Save-triggered reloads stay on `onDidSaveTextDocument` — the watcher exists purely for existence-tracking.

`viewsWelcome` entries on the `tasklens.workspace` view:

| Condition | Content |
|---|---|
| `workbenchState == empty` | "No folder is open. **[Open Folder]**" |
| `tasklens.noTasksJson && workbenchState != empty` | "No tasks.json found. **[Create tasks.json]**" + Learn more link |

The auto-detected view has no welcome content; if it's empty, it simply renders empty.

## 9. Activation, reload, and event wiring

- **Activation**: declared `activationEvents: []`. VSCode auto-activates on the contributed view's first reveal and on any registered command. No `*` activation.
- **Subscriptions registered in `activate`** (all pushed onto `context.subscriptions`):
  - `StatusRegistry` (subscribes to task lifecycle events).
  - `FavoritesStore` (Memento-backed; injected into both providers).
  - Two `TasksTreeProvider` instances + their `TreeView`s (`tasklens.workspace`, `tasklens.builtin`).
  - `FileSystemWatcher('**/.vscode/tasks.json')` with `onDidCreate` / `onDidDelete` → refresh context key + reload both providers.
  - `onDidSaveTextDocument` → if path ends with `/.vscode/tasks.json`, reload both providers.
  - `onDidChangeWorkspaceFolders` → refresh context key + reload both providers.
  - `onDidChangeConfiguration('tasklens.groupSeparator')` → reload both providers.
- **`reloadAll()`** — single helper that calls `reload()` on every provider. The `tasklens.reload` command, all FS/config events, and folder-change events all funnel through it.

## 10. Commands, views, menus, configuration (package.json)

**Activity-bar container** `tasklens` (icon: [media/tasklens.svg](media/tasklens.svg)) hosts two views:

- `tasklens.workspace` — Workspace
- `tasklens.builtin` — Auto-detected

**Commands**:

| Command | Title | Use |
|---|---|---|
| `tasklens.reload` | Reload Tasks | Title-bar refresh button + palette |
| `tasklens.createTasksJson` | Create tasks.json | Welcome-view button + palette |
| `tasklens.runTask` | Run Task | Inline button + context menu (idle tasks) |
| `tasklens.rerunTask` | Re-run Task | Context menu |
| `tasklens.stopTask` | Stop Task | Inline button + context menu (running tasks) |
| `tasklens.tailLogs` | Show Task Terminal | Inline button + context menu (running tasks) |
| `tasklens.addFavorite` | Add to Favorites | Inline button + context menu (un-favorited tasks) |
| `tasklens.removeFavorite` | Remove from Favorites | Inline button + context menu (favorited tasks) |
| `tasklens.revealDefinition` | Reveal Definition | Default click + context menu |

Per-task-action commands are hidden from the command palette (`when: "false"`) — they require a tree-node argument and would crash if invoked unbound.

**Menu wiring** — `view/item/context` clauses use a regex match `view =~ /^tasklens\.(workspace|builtin)$/` so both views share the same actions. Inline groups: `inline@1` (run / stop), `inline@2` (tail), `inline@3` (add/remove favorite). Context groups: `1_run` (rerun, stop), `2_logs` (tail), `3_nav` (favorite, reveal definition). The favorite/un-favorite items are mutually exclusive — they discriminate on the `.favorite` suffix in `viewItem`.

**Configuration**:

```jsonc
"tasklens.groupSeparator":        { "type": "string",  "default": "::"  }
"tasklens.confirmRerunIfRunning": { "type": "boolean", "default": true  }
```

## 11. Build & bundling notes

- esbuild bundles `src/extension.ts` → `dist/extension.js`, `platform: node`, `format: cjs`, `external: ['vscode']`.
- **`mainFields: ['module', 'main']`** is required: `jsonc-parser`'s default `main` is a UMD wrapper whose dynamic `require("./impl/...")` calls survive bundling and crash at runtime ("Cannot find module './impl/format'"). Preferring the ESM entry yields a fully-bundled output.
- `media/` is whitelisted in [.vscodeignore](.vscodeignore) (`!media/**`) so the activity-bar icon ships in the `.vsix`.

## 12. Resolved Decisions

Recording resolutions so future-you doesn't re-litigate them.

- **Log tail strategy** — focus the existing terminal (§6). No output capture.
- **Debug a task** — out of scope. VSCode's debug surface owns it.
- **Multi-root scoping** — folder buckets at the top of each view when `workspaceFolders.length > 1`; flat otherwise (§4).
- **Reload trigger** — `onDidSaveTextDocument` filtered to `tasks.json` paths. The `FileSystemWatcher` is used **only** for create/delete events feeding the welcome-view context key; it is not a reload trigger. Manual `tasklens.reload` exists for external-edit edge cases.
- **Two views vs. one filtered view** — explicit task discoverability is the headline feature; auto-detected tasks dilute the workspace surface. The split mirrors the user mental model ("things I wrote" vs. "things VSCode found").
- **Workspace/built-in discriminator** — `task.source === 'Workspace'`. Documented as the contract; if VSCode ever changes the source string, this single predicate in [src/tree/filters.ts](src/tree/filters.ts) is the only place to adjust.
- **Welcome-view scope** — only on the Workspace view. The auto-detected view has nothing actionable to offer when empty.
- **Favorites storage** — `context.workspaceState`, not `globalState`. Favorites are about *this* repo's tasks; cross-workspace favorites don't make sense because `TaskKey` includes workspace-folder URIs.
- **Favorites UX placement** — synthetic `Favorites` group at the top of each view, plus a star indicator on the regular grouped occurrence of each favorited task. Two surfaces because favoriting is about *quick access without searching* (the top group) but you also need to see favorite state when discovering tasks (the inline indicator).
- **Default group separator** — `::`. Distinct enough from typical task names (which often contain `:` from npm/gulp prefixes) that nesting is opt-in via the user's task naming. Switch back to `:` for legacy npm/gulp-style auto-nesting.
