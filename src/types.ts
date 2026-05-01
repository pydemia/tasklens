import * as vscode from 'vscode';

export type TaskKey = string;

export type TaskStatus = 'idle' | 'running' | 'succeeded' | 'failed';

export interface TaskNode {
	kind: 'group' | 'task';
	label: string;
	children: TaskNode[];
	fullLabel?: string;
	task?: vscode.Task;
	key?: TaskKey;
	folderName?: string;
	favorite?: boolean;
	favoritesGroup?: boolean;
	placeholder?: boolean;
}

export function taskKey(task: vscode.Task): TaskKey {
	const scope = task.scope;
	let scopePart: string;
	if (scope === undefined) {
		scopePart = 'undefined';
	} else if (scope === vscode.TaskScope.Global) {
		scopePart = 'global';
	} else if (scope === vscode.TaskScope.Workspace) {
		scopePart = 'workspace';
	} else {
		scopePart = `folder:${scope.uri.toString()}`;
	}
	return `${task.source}::${task.name}::${scopePart}`;
}
