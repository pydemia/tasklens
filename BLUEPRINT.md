# tasklens — Architecture Blueprint

This document describes the extension as built. Read it before changing task discovery, the tree, execution tracking, or terminal focus.

## Scope

TaskLens lists VS Code tasks, groups labels, runs/stops/restarts tasks, shows their results, opens existing terminals, reveals definitions, and keeps workspace favorites and run history. The activity bar contains Workspace, Global, Auto-detected, and History views.

Task debugging, task-output capture, scheduling, and custom task providers are out of scope. The VS Code Tasks API supplies task objects; JSONC files are read only for definition navigation. No `OutputChannel` or shell integration is used to capture output.

## Task discovery

`TaskCatalog` in `src/taskCatalog.ts` shares one `vscode.tasks.fetchTasks()` snapshot across the three task views and the quick picker. Concurrent readers share one promise. A reload increments a generation so older requests cannot overwrite newer results. A failed or timed-out request retains the previous snapshot and exposes an error with a retry action. Discovery times out after 30 seconds; the Tasks API does not support cancelling the underlying provider request.

Favorite changes, status changes, and grouping changes rebuild the tree from the snapshot without fetching tasks again. Views show a loading message while discovery is pending. Empty favorites groups are omitted so VS Code can render welcome actions.

Reload triggers:

- The Reload Tasks command and creation of a tasks.json through TaskLens.
- Saving folder/user tasks.json, a .code-workspace file, or package.json.
- Workspace-folder and task-provider configuration changes, and granting workspace trust.

Save/configuration events are debounced by 200 ms to let VS Code update its task configuration. A `FileSystemWatcher` listens only to tasks.json creation/deletion for welcome-state existence tracking; it does not reload task content. External edits can be picked up with Reload Tasks.

## Scope and identity

`taskKey(task)` combines source, name, and scope (folder URI, workspace, global, or undefined). Favorites retain these keys across reloads. `taskScopes.ts` uses public task scope/source and VS Code's inspected task configuration to classify user tasks. It never scans task files to build the list. Folder scope takes precedence over any matching user-level label.

The views apply these predicates:

- Global: global scope, user source, or the user-task fallback for versions reporting workspace scope.
- Workspace: Workspace source and not classified as Global.
- Auto-detected: remaining tasks, including extension-provided tasks.

## Tree

`tree/group.ts` is pure: flat labels become nested groups using `tasklens.groupSeparator` (default `::`). Multi-root views first bucket tasks by their owning workspace folder. Favorites appear in a separate group above the ordinary tree; the task is available in both places.

Every group and task occurrence has a stable tree-item ID. Folder IDs include the URI, and favorite occurrences have a separate path from ordinary occurrences. This lets VS Code preserve selection and expansion during refresh. Status descriptions and tooltips provide text equivalents for the icons, including the exit code when known.

The tree uses native VS Code TreeItems, ThemeIcons, menus, and QuickPick. No webview is required.

`tasklens.viewMode` is a workspace setting with `tree` (default) and `list` values. Each task view has a button to switch to the other mode and a separate Task View submenu with checked Tree View/List View commands. List mode uses the pure `buildList` function: task names stay intact and folder buckets are removed; multi-root rows identify the owning folder. Favorites retain their section and execution state comes from the same registry in either mode. Configuration changes rebuild the cached snapshot without refetching tasks. Changing the separator never changes the view mode.

`tasklens.changeGroupSeparator` opens a QuickPick from its separate string-icon toolbar button or the palette. The current separator appears in the Tree View header. Users can select a recommendation, type a literal separator and press Enter, enter a custom value in an InputBox, or remove the workspace override. A selection is written to `ConfigurationTarget.Workspace`; cancellation does not modify settings. The existing configuration event rebuilds all three views from the cached task snapshot.

`grouping/suggest.ts` analyzes labels with the same pure `splitTaskName` function as the tree. It ranks punctuation candidates by the number of task names placed into shared prefix groups, removes candidates producing an identical hierarchy, and provides a real task-name preview. Separate views/folders and duplicate labels do not inflate a candidate's evidence. Recommendations require a shared group with at least two distinct tasks; no LLM or network request is used.

## Execution and results

`StatusRegistry` is the only lifecycle interpreter. It subscribes before seeding itself from `vscode.tasks.taskExecutions` so activation during a run does not miss it.

- A `Map<TaskKey, TaskExecution>` identifies the current live execution for each key.
- A live execution set preserves overlapping instances of the same task.
- A weak map associates each execution object with its own run record.
- The latest run per key supplies its result after all instances stop running.

Process-end updates the result immediately, independently of the task-end event. Task-end removes only its own execution; delayed events from a previous run cannot erase a newer run. If any instance remains running, the task still displays Running.

| Status | Meaning | Icon |
|---|---|---|
| idle | No run observed in this host session | File icon |
| running | At least one live run has not ended | Blue spinner |
| succeeded | Exit code 0 | Green pass |
| failed | Nonzero exit code | Red error |
| stopped | TaskLens requested termination, or VS Code reported a terminated process without an exit code | Yellow stop |
| ended | Task ended without a process result | Neutral question mark |

An unavailable exit code is never treated as a proven success or failure. A process result received after task-end updates the same run. While executions are live, a 1.5-second timer reconciles them against VS Code's public active-execution snapshot, recovering missed end events. Reconciliation also occurs on manual reload and view reveal. No terminal-name heuristic is used to decide whether a task is running.

`registry.stop(execution)` registers an execution-specific waiter before calling `terminate()`, then waits up to 10 seconds. Restart waits for all instances of the task to stop before executing the same Task object. Run/stop/restart commands are guarded per task against repeated clicks; rejected operations show the task name and error. Restart re-reads executions after its optional confirmation dialog.

All subscriptions, timers, emitters, waiters, providers, and views have disposal paths owned by `context.subscriptions`.

## History

`HistoryStore` consumes normalized registry run events, rather than interpreting raw lifecycle events again. Records have an ID per execution, source/name/key, start/end timestamps, outcome, and optional exit code. Up to 500 records are stored in `context.workspaceState`; writes are serialized.

Persisted Running records become Ended after host reload because the old result cannot be inferred. Executions that VS Code reports as still active get new observed records. Unknown end times remain unavailable instead of fabricating a duration. Clearing history prevents later lifecycle events from restoring cleared records.

The History view uses the same status icons and offers Re-run Task. It resolves the stored key against the current catalog; a removed task shows a notice rather than executing a stale definition.

## Terminal focus

`terminal/focus.ts` reveals an existing terminal without buffering its output. It prefers exact task-name matches, followed by known task-name prefixes/suffixes. Multiple candidates produce a terminal picker; absent candidates show a notice. It does not select an arbitrary substring match such as choosing build-prod for build.

Show Task Terminal is available after completion as well as during execution, so users can inspect failure output. A task may reuse a shared terminal; the public Tasks API does not expose a reliable Task-to-Terminal mapping.

## Definition navigation

Folder tasks open their own .vscode/tasks.json. Workspace-scoped tasks open the .code-workspace file; user tasks open user tasks.json. `jsonc/locate.ts` uses `jsonc-parser` to locate the label in either `tasks[]` or `tasks.tasks[]`. The complete object is selected and revealed. Missing or provider-generated definitions show a notice without opening an unrelated folder's file.

## Commands and activation

TaskLens activates on `onStartupFinished`, view reveal, or command invocation. Startup activation tracks tasks before users open the panel; discovery remains lazy.

Commands are declared in package.json. Per-row actions require their tree-node arguments and stay hidden in the palette. Find and Run Task is available in the palette and view title bars; it searches every fetched task with favorites first and focuses the terminal when a selected task is already running. Reload Tasks and Create tasks.json remain available in the palette.

Configuration:

- `tasklens.groupSeparator`: string, default `::`.
- `tasklens.confirmRerunIfRunning`: boolean, default `true`.

## Build and verification

esbuild bundles `src/extension.ts` into `dist/extension.js`. Keep `mainFields: ['module', 'main']`: jsonc-parser's UMD entry otherwise leaves dynamic requires that fail in the packaged extension.

`yarn test` runs Mocha in an isolated VS Code 1.118.1 Extension Host with a fixture workspace and user task. Tests exercise registry event ordering, concurrent executions, termination, history recovery, discovery races/errors/timeouts, tree IDs, and real shell success/failure/terminal disposal/restart. No task output is captured by the extension.

`yarn package` type-checks, lints, and builds the production bundle. The VSIX excludes source, test fixtures, local agent instructions, caches, and development files.

## Product references for 1.1

- [Task Explorer](https://marketplace.visualstudio.com/items?itemName=spmeesseman.vscode-taskexplorer): retained tree expansion and cached discovery informed stable IDs and a shared task catalog.
- [Hunter's Task Explorer](https://marketplace.visualstudio.com/items?itemName=huntertran.hunter-task-explorer): direct run/stop/terminal access and visible execution information informed task-row status text and terminal access after completion.

These are behavior references. TaskLens retains its existing native tree and Tasks API implementation; no code was copied.
