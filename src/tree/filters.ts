import * as vscode from 'vscode';
import { isGlobalScoped, isWorkspaceScoped } from '../taskScopes';
import type { TaskFilter } from './provider';

const WORKSPACE_SOURCE = 'Workspace';

export const workspaceTaskFilter: TaskFilter = isWorkspaceScoped;

export const globalTaskFilter: TaskFilter = isGlobalScoped;

export const builtinTaskFilter: TaskFilter = (task: vscode.Task) =>
	task.source !== WORKSPACE_SOURCE;
