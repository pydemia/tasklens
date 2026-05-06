import * as vscode from 'vscode';
import type { FavoritesStore } from './favorites/store';
import type { HistoryStore } from './history/store';
import { locateTaskInJsonc } from './jsonc/locate';
import { rerunTask, runTask, stopTask } from './runner/execute';
import type { StatusRegistry } from './runner/registry';
import { focusTaskTerminal } from './terminal/focus';
import { createTasksJson } from './tasksJson';
import type { TasksTreeProvider } from './tree/provider';
import { taskKey, type TaskNode } from './types';

export function registerCommands(
	context: vscode.ExtensionContext,
	providers: TasksTreeProvider[],
	registry: StatusRegistry,
	favorites: FavoritesStore,
	history: HistoryStore,
): void {
	const reloadAll = () => providers.forEach(p => p.reload());
	context.subscriptions.push(
		vscode.commands.registerCommand('tasklens.reload', () => {
			reloadAll();
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
		}),
		vscode.commands.registerCommand(
			'tasklens.runTask',
			async (node: TaskNode | undefined) => {
				const task = node?.task;
				if (!task) {
					return;
				}
				await runTask(task);
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
			(node: TaskNode | undefined) => {
				const task = node?.task;
				if (!task) {
					return;
				}
				focusTaskTerminal(task);
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
	const folder = resolveTasksJsonFolder(task);
	if (!folder) {
		vscode.window.showInformationMessage(
			`Cannot locate tasks.json — "${task.name}" has no associated workspace folder.`,
		);
		return;
	}

	const tasksJsonUri = vscode.Uri.joinPath(folder.uri, '.vscode', 'tasks.json');
	let doc: vscode.TextDocument;
	try {
		doc = await vscode.workspace.openTextDocument(tasksJsonUri);
	} catch {
		vscode.window.showInformationMessage(
			`No tasks.json found in ${folder.name}.`,
		);
		return;
	}

	const range = locateTaskInJsonc(doc.getText(), task.name);
	const editor = await vscode.window.showTextDocument(doc);
	if (!range) {
		vscode.window.showInformationMessage(
			`"${task.name}" is not defined in ${folder.name}/.vscode/tasks.json (it may be a contributed task).`,
		);
		return;
	}
	const start = doc.positionAt(range.offset);
	const end = doc.positionAt(range.offset + range.length);
	const sel = new vscode.Range(start, end);
	editor.selection = new vscode.Selection(start, start);
	editor.revealRange(sel, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

function resolveTasksJsonFolder(
	task: vscode.Task,
): vscode.WorkspaceFolder | undefined {
	const scope = task.scope;
	if (scope && typeof scope === 'object' && 'uri' in scope) {
		return scope;
	}
	const folders = vscode.workspace.workspaceFolders ?? [];
	return folders[0];
}
