import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { FavoritesStore } from './favorites/store';
import { HistoryTreeProvider } from './history/provider';
import { HistoryStore } from './history/store';
import { StatusRegistry } from './runner/registry';
import { refreshNoTasksJsonContext } from './tasksJson';
import { initTaskScopes, isTaskDefinitionDocument } from './taskScopes';
import {
	builtinTaskFilter,
	globalTaskFilter,
	workspaceTaskFilter,
} from './tree/filters';
import { TasksTreeProvider } from './tree/provider';

export function activate(context: vscode.ExtensionContext): void {
	initTaskScopes(context);
	const registry = new StatusRegistry();
	const favorites = new FavoritesStore(context.workspaceState);
	const history = new HistoryStore(context.workspaceState);
	const workspaceProvider = new TasksTreeProvider(
		registry,
		favorites,
		workspaceTaskFilter,
	);
	const globalProvider = new TasksTreeProvider(
		registry,
		favorites,
		globalTaskFilter,
	);
	const builtinProvider = new TasksTreeProvider(
		registry,
		favorites,
		builtinTaskFilter,
	);
	const providers = [workspaceProvider, globalProvider, builtinProvider];
	const reloadAll = () => providers.forEach(p => p.reload());

	const workspaceView = vscode.window.createTreeView('tasklens.workspace', {
		treeDataProvider: workspaceProvider,
		showCollapseAll: true,
	});
	const globalView = vscode.window.createTreeView('tasklens.global', {
		treeDataProvider: globalProvider,
		showCollapseAll: true,
	});
	const builtinView = vscode.window.createTreeView('tasklens.builtin', {
		treeDataProvider: builtinProvider,
		showCollapseAll: true,
	});

	const historyProvider = new HistoryTreeProvider(history);
	const historyView = vscode.window.createTreeView('tasklens.history', {
		treeDataProvider: historyProvider,
	});

	registerCommands(context, providers, registry, favorites, history);

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
		history,
		workspaceProvider,
		globalProvider,
		builtinProvider,
		historyProvider,
		workspaceView,
		globalView,
		builtinView,
		historyView,
		vscode.tasks.onDidStartTask(e => history.recordStart(e.execution.task)),
		vscode.tasks.onDidEndTaskProcess(e =>
			history.recordProcessEnd(e.execution.task, e.exitCode),
		),
		vscode.tasks.onDidEndTask(e => history.recordEnd(e.execution.task)),
		tasksJsonWatcher,
		tasksJsonWatcher.onDidCreate(onTasksJsonExistenceChanged),
		tasksJsonWatcher.onDidDelete(onTasksJsonExistenceChanged),
		vscode.workspace.onDidSaveTextDocument(doc => {
			if (isTaskDefinitionDocument(doc.uri)) {
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
