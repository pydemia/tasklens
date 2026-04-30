import type * as vscode from 'vscode';
import type { TaskFilter } from './provider';

const WORKSPACE_SOURCE = 'Workspace';

export const workspaceTaskFilter: TaskFilter = (task: vscode.Task) =>
	task.source === WORKSPACE_SOURCE;

export const builtinTaskFilter: TaskFilter = (task: vscode.Task) =>
	task.source !== WORKSPACE_SOURCE;
