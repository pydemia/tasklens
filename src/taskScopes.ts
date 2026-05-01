import * as vscode from 'vscode';
import { parse } from 'jsonc-parser';

const WORKSPACE_SOURCE = 'Workspace';

let userTasksUri: vscode.Uri | undefined;
let globalLabels: Set<string> = new Set();
let workspaceLabels: Set<string> = new Set();
let output: vscode.OutputChannel | undefined;

export function initTaskScopes(context: vscode.ExtensionContext): void {
	userTasksUri = vscode.Uri.joinPath(
		context.globalStorageUri,
		'..',
		'..',
		'tasks.json',
	);
	output = vscode.window.createOutputChannel('Tasklens');
	context.subscriptions.push(output);
	output.appendLine(`[init] userTasksUri=${userTasksUri.toString()}`);
}

export function getUserTasksUri(): vscode.Uri | undefined {
	return userTasksUri;
}

export async function refreshTaskScopes(): Promise<void> {
	const fromConfig = readLabelsFromConfig();
	const [diskUserLabels, diskFolderLabels, diskWsFileLabels] =
		await Promise.all([
			readUserTaskLabels(),
			readWorkspaceFolderTaskLabels(),
			readWorkspaceFileTaskLabels(),
		]);

	globalLabels = new Set([...fromConfig.global, ...diskUserLabels]);
	workspaceLabels = new Set([
		...fromConfig.workspace,
		...fromConfig.workspaceFolders.flat(),
		...diskFolderLabels,
		...diskWsFileLabels,
	]);

	output?.appendLine(
		`[refresh] global=[${[...globalLabels].join(', ')}] workspace=[${[...workspaceLabels].join(', ')}]`,
	);
	output?.appendLine(
		`[refresh] config.global=[${fromConfig.global.join(', ')}] config.workspace=[${fromConfig.workspace.join(', ')}] config.folders=${JSON.stringify(fromConfig.workspaceFolders)}`,
	);
	output?.appendLine(
		`[refresh] disk.user=[${diskUserLabels.join(', ')}] disk.folders=[${diskFolderLabels.join(', ')}] disk.wsFile=[${diskWsFileLabels.join(', ')}]`,
	);
}

export function isGlobalScoped(task: vscode.Task): boolean {
	const result = classify(task);
	output?.appendLine(
		`[classify] name="${task.name}" source="${task.source}" scope=${describeScope(task.scope)} → ${result}`,
	);
	return result === 'global';
}

export function isWorkspaceScoped(task: vscode.Task): boolean {
	return classify(task) === 'workspace';
}

function classify(task: vscode.Task): 'global' | 'workspace' | 'other' {
	if (task.source !== WORKSPACE_SOURCE) {
		return 'other';
	}
	if (workspaceLabels.has(task.name)) {
		return 'workspace';
	}
	if (globalLabels.has(task.name)) {
		return 'global';
	}
	return task.scope === vscode.TaskScope.Global ? 'global' : 'workspace';
}

function describeScope(scope: vscode.Task['scope']): string {
	if (scope === undefined) {
		return 'undefined';
	}
	if (scope === vscode.TaskScope.Global) {
		return 'Global';
	}
	if (scope === vscode.TaskScope.Workspace) {
		return 'Workspace';
	}
	if (typeof scope === 'object' && 'uri' in scope) {
		return `Folder(${scope.name})`;
	}
	return String(scope);
}

export function isTaskDefinitionDocument(uri: vscode.Uri): boolean {
	const path = uri.path;
	if (path.endsWith('/.vscode/tasks.json')) {
		return true;
	}
	if (path.endsWith('.code-workspace')) {
		return true;
	}
	return userTasksUri ? uri.toString() === userTasksUri.toString() : false;
}

function readLabelsFromConfig(): {
	global: string[];
	workspace: string[];
	workspaceFolders: string[][];
} {
	const inspected = vscode.workspace
		.getConfiguration('tasks')
		.inspect<Array<{ label?: unknown }>>('tasks');
	const folders = vscode.workspace.workspaceFolders ?? [];
	const wfArrs = folders.map(f => {
		const i = vscode.workspace
			.getConfiguration('tasks', f.uri)
			.inspect<Array<{ label?: unknown }>>('tasks');
		return extractLabels(i?.workspaceFolderValue);
	});
	return {
		global: extractLabels(inspected?.globalValue),
		workspace: extractLabels(inspected?.workspaceValue),
		workspaceFolders: wfArrs,
	};
}

async function readUserTaskLabels(): Promise<string[]> {
	if (!userTasksUri) {
		return [];
	}
	return readTaskLabels(userTasksUri);
}

async function readWorkspaceFolderTaskLabels(): Promise<string[]> {
	const folders = vscode.workspace.workspaceFolders ?? [];
	const all = await Promise.all(
		folders.map(f =>
			readTaskLabels(vscode.Uri.joinPath(f.uri, '.vscode', 'tasks.json')),
		),
	);
	return all.flat();
}

async function readWorkspaceFileTaskLabels(): Promise<string[]> {
	const wsFile = vscode.workspace.workspaceFile;
	if (!wsFile || wsFile.scheme === 'untitled') {
		return [];
	}
	const text = await readText(wsFile);
	if (!text) {
		return [];
	}
	const parsed = parse(text) as
		| { tasks?: { tasks?: Array<{ label?: unknown }> } }
		| undefined;
	return extractLabels(parsed?.tasks?.tasks);
}

async function readTaskLabels(uri: vscode.Uri): Promise<string[]> {
	const text = await readText(uri);
	if (!text) {
		return [];
	}
	const parsed = parse(text) as
		| { tasks?: Array<{ label?: unknown }> }
		| undefined;
	return extractLabels(parsed?.tasks);
}

function extractLabels(
	tasks: Array<{ label?: unknown }> | undefined,
): string[] {
	const out: string[] = [];
	for (const t of tasks ?? []) {
		if (typeof t?.label === 'string') {
			out.push(t.label);
		}
	}
	return out;
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
	try {
		const buf = await vscode.workspace.fs.readFile(uri);
		return new TextDecoder('utf-8').decode(buf);
	} catch {
		return undefined;
	}
}
