import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { FavoritesStore } from './favorites/store';
import { HistoryTreeProvider } from './history/provider';
import { HistoryStore } from './history/store';
import { StatusRegistry } from './runner/registry';
import { TaskCatalog } from './taskCatalog';
import { refreshNoTasksJsonContext } from './tasksJson';
import { initTaskScopes, isTaskDefinitionDocument } from './taskScopes';
import { builtinTaskFilter, globalTaskFilter, workspaceTaskFilter } from './tree/filters';
import { TasksTreeProvider } from './tree/provider';

export function activate(context: vscode.ExtensionContext): void {
	initTaskScopes(context);
	const registry = new StatusRegistry();
	const catalog = new TaskCatalog();
	const favorites = new FavoritesStore(context.workspaceState);
	const history = new HistoryStore(context.workspaceState, registry);
	const providers = [workspaceTaskFilter, globalTaskFilter, builtinTaskFilter]
		.map(filter => new TasksTreeProvider(registry, favorites, filter, catalog));
	const views = ['tasklens.workspace', 'tasklens.global', 'tasklens.builtin']
		.map((id, index) => vscode.window.createTreeView(id, {
			treeDataProvider: providers[index], showCollapseAll: true,
		}));
	const historyProvider = new HistoryTreeProvider(history);
	const historyView = vscode.window.createTreeView('tasklens.history', { treeDataProvider: historyProvider });
	const reloadAll = async () => {
		registry.reconcile();
		await Promise.all([catalog.reload(), refreshNoTasksJsonContext()]);
	};
	registerCommands(context, catalog, reloadAll, registry, favorites, history);

	let reloadTimer: NodeJS.Timeout | undefined;
	const scheduleReload = () => {
		clearTimeout(reloadTimer);
		// Let VS Code update its task configuration before calling fetchTasks().
		reloadTimer = setTimeout(() => void reloadAll(), 200);
	};
	const tasksJsonWatcher = vscode.workspace.createFileSystemWatcher('**/.vscode/tasks.json', false, true, false);
	context.subscriptions.push(
		registry, catalog, favorites, history, ...providers, ...views, historyProvider, historyView,
		new vscode.Disposable(() => clearTimeout(reloadTimer)),
		catalog.onDidChange(() => {
			for (const view of views) {
				view.message = catalog.loading ? 'Loading tasks…'
					: catalog.error ? 'Task discovery failed. Reload to try again.' : undefined;
			}
		}),
		...views.map(view => view.onDidChangeVisibility(e => {
			if (e.visible) {
				registry.reconcile();
			}
		})),
		tasksJsonWatcher,
		// Existence tracking only; task contents reload on save or an explicit command.
		tasksJsonWatcher.onDidCreate(() => void refreshNoTasksJsonContext()),
		tasksJsonWatcher.onDidDelete(() => void refreshNoTasksJsonContext()),
		vscode.workspace.onDidSaveTextDocument(doc => {
			if (isTaskDefinitionDocument(doc.uri) || doc.uri.path.endsWith('/package.json')) {
				scheduleReload();
			}
		}),
		vscode.workspace.onDidChangeWorkspaceFolders(scheduleReload),
		vscode.workspace.onDidGrantWorkspaceTrust(scheduleReload),
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('tasks') || e.affectsConfiguration('npm.autoDetect')
				|| e.affectsConfiguration('typescript.tsc.autoDetect')) {
				scheduleReload();
			} else if (e.affectsConfiguration('tasklens')) {
				providers.forEach(provider => provider.reload());
			}
		}),
	);
	void refreshNoTasksJsonContext();
}

export function deactivate(): void {}
