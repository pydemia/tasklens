import * as vscode from 'vscode';
import { getUserTasksUri, isGlobalScoped } from '../taskScopes';
import type { TaskStatus } from '../types';

export function statusIcon(status: TaskStatus): vscode.ThemeIcon | undefined {
	switch (status) {
		case 'running':
			return new vscode.ThemeIcon(
				'sync~spin',
				new vscode.ThemeColor('charts.blue'),
			);
		case 'succeeded':
			return new vscode.ThemeIcon(
				'pass',
				new vscode.ThemeColor('charts.green'),
			);
		case 'failed':
			return new vscode.ThemeIcon(
				'error',
				new vscode.ThemeColor('charts.red'),
			);
		case 'idle':
		default:
			return undefined;
	}
}

export const idleTaskIcon = vscode.ThemeIcon.File;
export const groupIcon = vscode.ThemeIcon.Folder;
export const folderIcon = vscode.ThemeIcon.Folder;
export const favoritesIcon = new vscode.ThemeIcon(
	'star-full',
	new vscode.ThemeColor('editorWarning.foreground'),
);

export function groupResourceUri(label: string): vscode.Uri | undefined {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return undefined;
	}
	return vscode.Uri.joinPath(folder.uri, label);
}

export function folderResourceUri(folderName: string): vscode.Uri | undefined {
	const match = vscode.workspace.workspaceFolders?.find(
		f => f.name === folderName,
	);
	return match?.uri;
}

export function taskResourceUri(task: vscode.Task): vscode.Uri | undefined {
	if (isGlobalScoped(task)) {
		return getUserTasksUri();
	}
	const folder = taskWorkspaceFolder(task);
	if (!folder) {
		return undefined;
	}
	const filename = representativeFile(task);
	return filename
		? vscode.Uri.joinPath(folder.uri, filename)
		: folder.uri;
}

function taskWorkspaceFolder(
	task: vscode.Task,
): vscode.WorkspaceFolder | undefined {
	const scope = task.scope;
	if (scope && typeof scope === 'object' && 'uri' in scope) {
		return scope as vscode.WorkspaceFolder;
	}
	return vscode.workspace.workspaceFolders?.[0];
}

function representativeFile(task: vscode.Task): string | undefined {
	const type = task.definition?.type;
	switch (type) {
		case 'npm':
			return 'package.json';
		case 'gulp':
			return 'gulpfile.js';
		case 'grunt':
			return 'Gruntfile.js';
		case 'typescript':
		case 'tsc':
			return 'tsconfig.json';
	}
	if (task.source === 'Workspace') {
		return '.vscode/tasks.json';
	}
	return undefined;
}
