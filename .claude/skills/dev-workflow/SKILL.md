---
name: dev-workflow
description: Build, run, and test the tasklens VSCode extension locally — esbuild watch, Extension Development Host, packaging, and the VSCode Tasks API gotchas you keep hitting.
---

# tasklens dev workflow

Use this skill when working on tasklens itself: building, launching the Extension Development Host, debugging, running tests, packaging, or when you hit a Tasks-API quirk you've seen before.

## Build & run

The repo is bundled with esbuild (see [esbuild.js](../../../esbuild.js)). Three modes:

| Goal | Command |
|---|---|
| One-shot type-check + lint + bundle | `yarn compile` |
| Watch (recommended during dev) | `yarn watch` — runs `watch:esbuild` and `watch:tsc` in parallel via `npm-run-all` |
| Production bundle (minified) | `yarn package` |

To run the extension: open the repo in VSCode and hit **F5** (`Run > Start Debugging`). This launches the Extension Development Host using [.vscode/launch.json](../../../.vscode/launch.json), which depends on the `npm: watch` task. Set breakpoints in `src/`; they bind after the first build completes.

Reload the host after code changes with **Cmd+R** (host window) — esbuild watch produces a new `dist/extension.js` automatically.

## Tests

```bash
yarn pretest   # compiles tests to out/, bundles, lints
yarn test      # runs @vscode/test-cli (downloads VSCode if needed)
```

For pure-module tests (grouping, JSONC location), prefer plain Mocha — they don't need an Extension Host. Put VSCode-API-touching tests under [src/test/](../../../src/test/).

## Packaging a .vsix

```bash
yarn package
npx vsce package        # produces tasklens-<version>.vsix
```

Don't publish without bumping `version` in [package.json](../../../package.json) and updating [CHANGELOG.md](../../../CHANGELOG.md).

## VSCode Tasks API gotchas

These cost real time. Check here before guessing.

- **`fetchTasks()` is async and slow on first call.** It triggers task providers (npm, typescript, gulp). Cache the result; refresh on a `FileSystemWatcher('**/.vscode/tasks.json')` event, not on every tree expand.
- **Task identity is not the label.** Two tasks from different sources can share a label. Build a `TaskKey` from `source + name + scope`. See [BLUEPRINT.md §3](../../../BLUEPRINT.md).
- **`TaskExecution.terminate()` returns void, not a promise.** Wait for `onDidEndTask` to confirm the task actually stopped before re-running.
- **`tasks.json` is JSONC.** Trailing commas and `// comments` are valid. Use the `jsonc-parser` package, never `JSON.parse`.
- **No public Task → Terminal mapping.** "Tail logs" finds the terminal by name match against the task label. Tasks with `presentation.reveal: never` may have no visible terminal; show a "no terminal" notice rather than failing silently.
- **Multi-root**: `Task.scope` can be a `WorkspaceFolder`, `TaskScope.Workspace`, or `TaskScope.Global`. Don't assume `WorkspaceFolder`.
- **Reload trigger is save, not file-watch.** `onDidSaveTextDocument` filtered to `**/.vscode/tasks.json`. Don't swap in a `FileSystemWatcher` — it's deliberate.

## Where things live

- Entry point: [src/extension.ts](../../../src/extension.ts)
- Architecture: [BLUEPRINT.md](../../../BLUEPRINT.md)
- Project context (stack, conventions): [CLAUDE.md](../../../CLAUDE.md)
- Tasks under test: [.vscode/tasks.json](../../../.vscode/tasks.json)
