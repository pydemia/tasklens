import * as vscode from 'vscode';

export type TaskViewMode = 'tree' | 'list';

export function getTaskViewMode(): TaskViewMode {
	return vscode.workspace.getConfiguration('tasklens').get<string>('viewMode') === 'list' ? 'list' : 'tree';
}

export async function setTaskViewMode(mode: TaskViewMode): Promise<void> {
	if (!vscode.workspace.workspaceFolders?.length && !vscode.workspace.workspaceFile) {
		await vscode.window.showInformationMessage('Open a folder or workspace to choose its task view.');
		return;
	}
	try {
		await vscode.workspace.getConfiguration('tasklens').update('viewMode', mode, vscode.ConfigurationTarget.Workspace);
	} catch (error) {
		await vscode.window.showErrorMessage(`Could not save the workspace task view: ${error instanceof Error ? error.message : String(error)}`);
	}
}
