import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { FavoritesStore } from './favorites/store';
import { StatusRegistry } from './runner/registry';
import { refreshNoTasksJsonContext } from './tasksJson';
import { builtinTaskFilter, workspaceTaskFilter } from './tree/filters';
import { TasksTreeProvider } from './tree/provider';

export function activate(context: vscode.ExtensionContext): void {
	const registry = new StatusRegistry();
	const favorites = new FavoritesStore(context.workspaceState);
	const workspaceProvider = new TasksTreeProvider(
		registry,
		favorites,
		workspaceTaskFilter,
	);
	const builtinProvider = new TasksTreeProvider(
		registry,
		favorites,
		builtinTaskFilter,
	);
	const providers = [workspaceProvider, builtinProvider];
	const reloadAll = () => providers.forEach(p => p.reload());

	const workspaceView = vscode.window.createTreeView('tasklens.workspace', {
		treeDataProvider: workspaceProvider,
		showCollapseAll: true,
	});
	const builtinView = vscode.window.createTreeView('tasklens.builtin', {
		treeDataProvider: builtinProvider,
		showCollapseAll: true,
	});

	registerCommands(context, providers, registry, favorites);

	const tasksJsonWatcher = vscode.workspace.createFileSystemWatcher(
		'**/.vscode/tasks.json',
		false,
		true,
		false,
	);
	const onTasksJsonExistenceChanged = () => {
		void refreshNoTasksJsonContext();
		reloadAll();
	};

	context.subscriptions.push(
		registry,
		favorites,
		workspaceProvider,
		builtinProvider,
		workspaceView,
		builtinView,
		tasksJsonWatcher,
		tasksJsonWatcher.onDidCreate(onTasksJsonExistenceChanged),
		tasksJsonWatcher.onDidDelete(onTasksJsonExistenceChanged),
		vscode.workspace.onDidSaveTextDocument(doc => {
			if (matchesTasksJson(doc.uri.path)) {
				reloadAll();
			}
		}),
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			void refreshNoTasksJsonContext();
			reloadAll();
		}),
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('tasklens.groupSeparator')) {
				reloadAll();
			}
		}),
	);

	void refreshNoTasksJsonContext();
}

export function deactivate(): void {}

function matchesTasksJson(path: string): boolean {
	return path.endsWith('/.vscode/tasks.json');
}
