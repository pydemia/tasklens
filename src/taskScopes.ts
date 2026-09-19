import * as vscode from 'vscode';

let userTasksUri: vscode.Uri | undefined;

export function initTaskScopes(context: vscode.ExtensionContext): void {
	userTasksUri = vscode.Uri.joinPath(context.globalStorageUri, '..', '..', 'tasks.json');
}

export function getUserTasksUri(): vscode.Uri | undefined {
	return userTasksUri;
}

export function isGlobalScoped(task: vscode.Task): boolean {
	if (task.scope === vscode.TaskScope.Global) {
		return true;
	}
	if (task.scope && typeof task.scope === 'object') {
		return false;
	}
	if (task.source === 'User') {
		return true;
	}
	// Some VS Code versions report user tasks with Workspace scope.
	const config = vscode.workspace.getConfiguration('tasks').inspect<Array<{ label?: unknown }>>('tasks');
	return task.source === 'Workspace'
		&& Array.isArray(config?.globalValue)
		&& config.globalValue.some(t => t.label === task.name)
		&& !(Array.isArray(config.workspaceValue) && config.workspaceValue.some(t => t.label === task.name));
}

export function isWorkspaceScoped(task: vscode.Task): boolean {
	return task.source === 'Workspace' && !isGlobalScoped(task);
}

export function isTaskDefinitionDocument(uri: vscode.Uri): boolean {
	return uri.path.endsWith('/.vscode/tasks.json')
		|| uri.path.endsWith('.code-workspace')
		|| uri.toString() === userTasksUri?.toString();
}
