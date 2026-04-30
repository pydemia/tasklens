# Change Log

All notable changes to the "tasklens" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.1.0]

### Added

- **Favorites** — pin any task to a synthetic `★ Favorites` group at the top of each view. Persisted per-workspace via `Memento` (`context.workspaceState`). New commands: `tasklens.addFavorite`, `tasklens.removeFavorite`. Inline star button and context-menu entries on every task row.

### Changed

- **Default group separator** is now `::` (was `:`). Tasks named `db::migrate::up` nest as `db` › `migrate` › `up`. Override with the `tasklens.groupSeparator` setting; switch back to `:` for legacy npm/gulp-style auto-nesting.
- **Task row description** now shows `task.definition.type` (e.g. `shell`, `process`, `npm`) instead of the previous `task.source` (which was usually just `Workspace`).

## [0.0.1]

- Initial release: workspace + auto-detected task views, run / re-run / stop / tail / reveal-definition, hierarchical grouping, save-driven reload, empty-state CTAs.
