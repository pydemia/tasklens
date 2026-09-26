# Change Log

All notable changes to the "tasklens" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.3.0] - 2026-09-26

### Added

- Workspace-specific Tree View and List View. List View keeps full task names and shows folder names for multi-root workspaces.
- A Tree/List switch button and a checked Task View menu in each task view. Switching uses the cached task snapshot and preserves favorites, execution status, and the tree separator.
- Separate view and delimiter controls: tree/list icons select the presentation; the string icon changes the separator. Delimiter changes do not change the selected view.

## [1.2.0] - 2026-09-26

### Added

- Change Group Separator in each task view's toolbar and the command palette. Select a suggestion or type a custom delimiter and press Enter.
- Local, deterministic suggestions based on repeated punctuation and shared task-name prefixes, with split counts and actual hierarchy examples.
- Workspace-only persistence, an action to restore the inherited separator, and the current separator in each view header. Changes rebuild cached trees immediately; cancelling leaves the configuration untouched.

## [1.1.0] - 2026-09-19

### Fixed

- Update status immediately on process exit; distinguish success, failure, termination, and an end without an exit code.
- Track existing executions at activation, reconcile missed end events, and handle overlapping runs and out-of-order lifecycle events without leaving a running icon behind.
- Register the termination waiter before stopping a task; prevent repeated clicks from starting concurrent restarts.
- Use one shared task discovery request for all views. Ignore obsolete responses, retain the previous list after an error, and offer retry after errors or timeouts.
- Refresh history from execution-specific results, including late exit codes. Old persisted runs no longer appear to run forever after a window reload.
- Avoid disk scans for task classification and preserve folder scope when user tasks share a label.
- Show empty-view actions by omitting empty Favorites groups. Keep tree expansion stable during refresh.
- Reveal the correct user or workspace task definition instead of falling back to an unrelated folder.

### Added

- Find and Run Task: search fetched tasks from the palette or view toolbar, with favorites first.
- Re-run Task from History, and Show Task Terminal for completed tasks.
- Status text and exit-code tooltips alongside task icons; loading and retry states in the task views.
- Regression tests plus actual VS Code shell-task tests for completion, failure, terminal disposal, and restart.

## [0.1.0]

### Added

- **Favorites** — pin any task to a synthetic `★ Favorites` group at the top of each view. Persisted per-workspace via `Memento` (`context.workspaceState`). New commands: `tasklens.addFavorite`, `tasklens.removeFavorite`. Inline star button and context-menu entries on every task row.

### Changed

- **Default group separator** is now `::` (was `:`). Tasks named `db::migrate::up` nest as `db` › `migrate` › `up`. Override with the `tasklens.groupSeparator` setting; switch back to `:` for legacy npm/gulp-style auto-nesting.
- **Task row description** now shows `task.definition.type` (e.g. `shell`, `process`, `npm`) instead of the previous `task.source` (which was usually just `Workspace`).

## [0.0.1]

- Initial release: workspace + auto-detected task views, run / re-run / stop / tail / reveal-definition, hierarchical grouping, save-driven reload, empty-state CTAs.
