import * as vscode from 'vscode';
import type { TaskCatalog } from '../taskCatalog';
import { builtinTaskFilter, globalTaskFilter } from '../tree/filters';
import { analyzeSeparator, suggestSeparators, type SeparatorAnalysis, type TaskLabel } from './suggest';

interface SeparatorItem extends vscode.QuickPickItem {
	separator?: string;
	action?: 'custom' | 'reset';
}

export type GroupingWindow = Pick<typeof vscode.window,
	'createQuickPick' | 'showInputBox' | 'showInformationMessage' | 'showErrorMessage'>;

function preview(analysis: SeparatorAnalysis): string {
	return analysis.example
		? `${analysis.affectedTasks} task names split · ${analysis.example.name} → ${analysis.example.path.join(' › ')}`
		: 'No task names split; no groups will be created from task names.';
}

export function validateSeparator(value: string): string | undefined {
	if (value.length === 0) { return 'Enter at least one character.'; }
	if (/[\x00-\x1f\x7f]/u.test(value)) { return 'Use a single-line separator without control characters.'; }
	return undefined;
}

export async function changeGroupSeparator(
	catalog: TaskCatalog, context: vscode.ExtensionContext, window: GroupingWindow = vscode.window,
): Promise<void> {
	if (!vscode.workspace.workspaceFolders?.length && !vscode.workspace.workspaceFile) {
		await window.showInformationMessage('Open a folder or workspace to set its task separator.');
		return;
	}
	const config = vscode.workspace.getConfiguration('tasklens');
	const current = config.get<string>('groupSeparator', '::') || '::';
	const inspected = config.inspect<string>('groupSeparator');
	const inherited = inspected?.globalValue || inspected?.defaultValue || '::';
	const tasks = await catalog.getTasks();
	const labels: TaskLabel[] = tasks.map(task => ({
		name: task.name,
		scope: `${globalTaskFilter(task) ? 'global' : builtinTaskFilter(task) ? 'builtin' : 'workspace'}:${typeof task.scope === 'object' ? task.scope.uri.toString() : 'workspace'}`,
	}));
	const suggestions = suggestSeparators(labels);
	const separators = [current, ...suggestions.map(suggestion => suggestion.separator)]
		.filter((separator, index, all) => all.indexOf(separator) === index);
	const items: SeparatorItem[] = separators.map(separator => ({
		label: `$(list-tree) ${JSON.stringify(separator)}`,
		description: separator === current ? 'Current' : 'Suggested from task names',
		detail: preview(analyzeSeparator(labels, separator)), separator,
	}));
	items.push({ label: '$(edit) Enter a custom separator…', action: 'custom' });
	if (inspected?.workspaceValue !== undefined) {
		items.push({ label: `$(discard) Use inherited setting (${JSON.stringify(inherited)})`, action: 'reset' });
	}
	const picker = window.createQuickPick<SeparatorItem>();
	picker.title = 'TaskLens: Change Group Separator';
	picker.placeholder = `Choose a suggestion or type a separator and press Enter. Current: ${JSON.stringify(current)}`;
	picker.matchOnDescription = false;
	picker.matchOnDetail = false;
	picker.items = items;
	const subscriptions: vscode.Disposable[] = [];
	const lifetime = new vscode.Disposable(() => {
		picker.hide();
		subscriptions.forEach(subscription => subscription.dispose());
		picker.dispose();
	});
	context.subscriptions.push(lifetime);
	const selected = await new Promise<SeparatorItem | undefined>(resolve => {
		subscriptions.push(
			picker.onDidChangeValue(value => {
				const invalid = validateSeparator(value);
				const custom: SeparatorItem = {
					label: `$(edit) Use ${JSON.stringify(value)}`,
					detail: invalid ?? preview(analyzeSeparator(labels, value)), separator: value,
					alwaysShow: true,
				};
				picker.items = value.length > 0 ? [custom, ...items] : items;
				if (value.length > 0) { picker.activeItems = [custom]; }
			}),
			picker.onDidAccept(() => {
				const item = picker.selectedItems[0] ?? picker.activeItems[0];
				if (item?.separator !== undefined && validateSeparator(item.separator)) { return; }
				resolve(item);
				picker.hide();
			}),
			picker.onDidHide(() => resolve(undefined)),
		);
		picker.show();
	});
	lifetime.dispose();
	const lifetimeIndex = context.subscriptions.indexOf(lifetime);
	if (lifetimeIndex >= 0) { context.subscriptions.splice(lifetimeIndex, 1); }
	if (!selected) { return; }
	let separator = selected.separator;
	if (selected.action === 'custom') {
		separator = await window.showInputBox({
			title: 'TaskLens: Custom Group Separator', value: current,
			prompt: 'Saved for this workspace. Spaces are kept as part of the separator.',
			validateInput: validateSeparator,
		});
		if (separator === undefined) { return; }
	}
	try {
		await config.update('groupSeparator', selected.action === 'reset' ? undefined : separator, vscode.ConfigurationTarget.Workspace);
	} catch (error) {
		await window.showErrorMessage(`Could not save the workspace separator: ${error instanceof Error ? error.message : String(error)}`);
	}
}
