import * as vscode from 'vscode';

export const NO_TASKS_JSON_CONTEXT = 'tasklens.noTasksJson';

const TEMPLATE = `{
	// See https://go.microsoft.com/fwlink/?LinkId=733558
	// for the documentation about the tasks.json format
	"version": "2.0.0",
	"tasks": [
		{
			"label": "echo",
			"type": "shell",
			"command": "echo Hello",
			"problemMatcher": []
		}
	]
}
`;

export async function anyFolderHasTasksJson(): Promise<boolean> {
	const folders = vscode.workspace.workspaceFolders ?? [];
	for (const folder of folders) {
		const uri = tasksJsonUri(folder);
		try {
			await vscode.workspace.fs.stat(uri);
			return true;
		} catch {
			// not present in this folder; keep checking
		}
	}
	return false;
}

export async function refreshNoTasksJsonContext(): Promise<void> {
	const has = await anyFolderHasTasksJson();
	await vscode.commands.executeCommand(
		'setContext',
		NO_TASKS_JSON_CONTEXT,
		!has,
	);
}

export async function createTasksJson(): Promise<void> {
	const folders = vscode.workspace.workspaceFolders ?? [];
	if (folders.length === 0) {
		await vscode.commands.executeCommand('vscode.openFolder');
		return;
	}

	const folder =
		folders.length === 1
			? folders[0]
			: await vscode.window.showWorkspaceFolderPick({
					placeHolder: 'Select a folder for the new tasks.json',
				});
	if (!folder) {
		return;
	}

	const uri = tasksJsonUri(folder);
	try {
		await vscode.workspace.fs.stat(uri);
	} catch {
		const dir = vscode.Uri.joinPath(folder.uri, '.vscode');
		await vscode.workspace.fs.createDirectory(dir);
		await vscode.workspace.fs.writeFile(
			uri,
			new TextEncoder().encode(TEMPLATE),
		);
	}
	const doc = await vscode.workspace.openTextDocument(uri);
	await vscode.window.showTextDocument(doc);
}

function tasksJsonUri(folder: vscode.WorkspaceFolder): vscode.Uri {
	return vscode.Uri.joinPath(folder.uri, '.vscode', 'tasks.json');
}
