import * as vscode from 'vscode';
import type { FavoritesStore } from './favorites/store';
import type { HistoryStore } from './history/store';
import { locateTaskInJsonc } from './jsonc/locate';
import { rerunTask, runTask, stopTask } from './runner/execute';
import type { StatusRegistry } from './runner/registry';
import { focusTaskTerminal } from './terminal/focus';
import { createTasksJson } from './tasksJson';
import type { TaskCatalog } from './taskCatalog';
import { getUserTasksUri, isGlobalScoped } from './taskScopes';
import type { HistoryNode } from './history/provider';
import { taskKey, type TaskNode } from './types';
import { changeGroupSeparator } from './grouping/picker';
import { getTaskViewMode, setTaskViewMode } from './tree/viewMode';

export function registerCommands(
	context: vscode.ExtensionContext,
	catalog: TaskCatalog,
	reloadAll: () => Promise<void>,
	registry: StatusRegistry,
	favorites: FavoritesStore,
	history: HistoryStore,
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('tasklens.reload', reloadAll),
		vscode.commands.registerCommand('tasklens.changeGroupSeparator', () => changeGroupSeparator(catalog, context)),
		vscode.commands.registerCommand('tasklens.showTreeView', () => setTaskViewMode('tree')),
		vscode.commands.registerCommand('tasklens.showListView', () => setTaskViewMode('list')),
		vscode.commands.registerCommand('tasklens.toggleViewMode', () => setTaskViewMode(getTaskViewMode() === 'list' ? 'tree' : 'list')),
		vscode.commands.registerCommand('tasklens.quickRun', async () => {
			const tasks = await catalog.getTasks();
			if (catalog.error) {
				const choice = await vscode.window.showErrorMessage(`Could not load tasks: ${catalog.error}`, 'Retry');
				if (choice === 'Retry') { await reloadAll(); }
				return;
			}
			const items = tasks.map(task => ({
				label: `${favorites.has(taskKey(task)) ? '$(star-full) ' : ''}${task.name}`,
				description: `${typeof task.scope === 'object' ? task.scope.name : task.source} · ${registry.getStatus(taskKey(task))}`,
				detail: task.detail, task,
			})).sort((a, b) => Number(favorites.has(taskKey(b.task))) - Number(favorites.has(taskKey(a.task))));
			const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Find a task to run', matchOnDescription: true, matchOnDetail: true });
			if (selected) {
				if (registry.isRunning(taskKey(selected.task))) { await focusTaskTerminal(selected.task); }
				else { await runTask(selected.task, registry); }
			}
		}),
		vscode.commands.registerCommand('tasklens.rerunHistory', async (node: HistoryNode | undefined) => {
			if (!node?.record) { return; }
			const tasks = await catalog.getTasks();
			const task = tasks.find(task => taskKey(task) === node.record!.taskKey);
			if (task) { await rerunTask(task, registry); }
			else { await vscode.window.showInformationMessage('This task is no longer available. Reload tasks to refresh the list.'); }
		}),
		vscode.commands.registerCommand(
			'tasklens.addFavorite',
			async (node: TaskNode | undefined) => {
				const task = node?.task;
				if (!task) {
					return;
				}
				await favorites.add(taskKey(task));
			},
		),
		vscode.commands.registerCommand(
			'tasklens.removeFavorite',
			async (node: TaskNode | undefined) => {
				const task = node?.task;
				if (!task) {
					return;
				}
				await favorites.remove(taskKey(task));
			},
		),
		vscode.commands.registerCommand('tasklens.createTasksJson', async () => {
			await createTasksJson();
			await reloadAll();
		}),
		vscode.commands.registerCommand(
			'tasklens.runTask',
			async (node: TaskNode | undefined) => {
				const task = node?.task;
				if (!task) {
					return;
				}
				await runTask(task, registry);
			},
		),
		vscode.commands.registerCommand(
			'tasklens.rerunTask',
			async (node: TaskNode | undefined) => {
				const task = node?.task;
				if (!task) {
					return;
				}
				await rerunTask(task, registry);
			},
		),
		vscode.commands.registerCommand(
			'tasklens.stopTask',
			async (node: TaskNode | undefined) => {
				const task = node?.task;
				if (!task) {
					return;
				}
				await stopTask(task, registry);
			},
		),
		vscode.commands.registerCommand(
			'tasklens.tailLogs',
			async (node: TaskNode | undefined) => {
				const task = node?.task;
				if (!task) {
					return;
				}
				await focusTaskTerminal(task);
			},
		),
		vscode.commands.registerCommand(
			'tasklens.revealDefinition',
			async (node: TaskNode | undefined) => {
				const task = node?.task;
				if (!task) {
					return;
				}
				await revealTaskDefinition(task);
			},
		),
		vscode.commands.registerCommand('tasklens.clearHistory', async () => {
			const choice = await vscode.window.showWarningMessage(
				'Clear all task run history?',
				{ modal: true },
				'Clear',
			);
			if (choice === 'Clear') {
				await history.clear();
			}
		}),
	);
}

async function revealTaskDefinition(task: vscode.Task): Promise<void> {
	const scope = task.scope;
	const folder = typeof scope === 'object' ? scope : undefined;
	const uri = isGlobalScoped(task) ? getUserTasksUri()
		: task.scope === vscode.TaskScope.Workspace ? vscode.workspace.workspaceFile
		: folder ? vscode.Uri.joinPath(folder.uri, '.vscode', 'tasks.json') : undefined;
	if (!uri) {
		await vscode.window.showInformationMessage(`No definition file is available for "${task.name}".`);
		return;
	}
	let doc: vscode.TextDocument;
	try {
		doc = await vscode.workspace.openTextDocument(uri);
	} catch {
		await vscode.window.showInformationMessage(`No task definition file found for "${task.name}".`);
		return;
	}
	const range = locateTaskInJsonc(doc.getText(), task.name, uri.path.endsWith('.code-workspace'));
	if (!range) {
		await vscode.window.showInformationMessage(`"${task.name}" is supplied by ${task.source} and has no matching definition in this file.`);
		return;
	}
	const editor = await vscode.window.showTextDocument(doc);
	const start = doc.positionAt(range.offset);
	const end = doc.positionAt(range.offset + range.length);
	editor.selection = new vscode.Selection(start, end);
	editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}
