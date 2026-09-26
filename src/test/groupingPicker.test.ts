import * as assert from 'assert';
import * as vscode from 'vscode';
import { changeGroupSeparator, type GroupingWindow } from '../grouping/picker';
import { TaskCatalog } from '../taskCatalog';
import { makeTask } from './helpers';

interface PickItem extends vscode.QuickPickItem { separator?: string; action?: string }

/** A local input stand-in; configuration writes still use the real isolated VS Code workspace. */
class Picker {
	items: readonly PickItem[] = [];
	activeItems: readonly PickItem[] = [];
	selectedItems: readonly PickItem[] = [];
	readonly changed = new vscode.EventEmitter<string>();
	readonly accepted = new vscode.EventEmitter<void>();
	readonly hidden = new vscode.EventEmitter<void>();
	onDidChangeValue = this.changed.event;
	onDidAccept = this.accepted.event;
	onDidHide = this.hidden.event;
	disposed = false;
	constructor(private readonly interact: (picker: Picker) => void) {}
	show(): void { queueMicrotask(() => this.interact(this)); }
	hide(): void { this.hidden.fire(); }
	dispose(): void { this.disposed = true; this.changed.dispose(); this.accepted.dispose(); this.hidden.dispose(); }
}

suite('Group separator input and workspace persistence', () => {
	const config = vscode.workspace.getConfiguration('tasklens');
	let original: string | undefined;
	let originalSettings: Uint8Array;
	let settingsUri: vscode.Uri;
	let catalog: TaskCatalog;
	setup(async () => {
		original = config.inspect<string>('groupSeparator')?.workspaceValue;
		settingsUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, '.vscode', 'settings.json');
		originalSettings = await vscode.workspace.fs.readFile(settingsUri);
		catalog = new TaskCatalog(async () => [makeTask('app::build'), makeTask('app::test')]);
	});
	teardown(async () => {
		await config.update('groupSeparator', original, vscode.ConfigurationTarget.Workspace);
		await vscode.workspace.fs.writeFile(settingsUri, originalSettings);
		catalog.dispose();
	});

	async function interact(action: (picker: Picker) => void, input?: string): Promise<void> {
		const picker = new Picker(action);
		const errors: string[] = [];
		const window = {
			createQuickPick: () => picker,
			showInputBox: async () => input,
			showErrorMessage: async (message: string) => { errors.push(message); },
		} as unknown as GroupingWindow;
		const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
		await changeGroupSeparator(catalog, context, window);
		assert.deepStrictEqual(errors, []);
		assert.ok(picker.disposed);
		assert.strictEqual(context.subscriptions.length, 0);
	}

	test('typed separator is saved at workspace scope, without changing the user setting', async () => {
		const userValue = config.inspect<string>('groupSeparator')?.globalValue;
		await interact(picker => {
			picker.changed.fire(' - ');
			assert.strictEqual(picker.activeItems[0].separator, ' - ');
			picker.accepted.fire();
		});
		assert.strictEqual(config.inspect<string>('groupSeparator')?.workspaceValue, ' - ');
		assert.strictEqual(config.inspect<string>('groupSeparator')?.globalValue, userValue);
	});

	test('cancelling a typed candidate keeps the previous separator', async () => {
		await config.update('groupSeparator', '::', vscode.ConfigurationTarget.Workspace);
		await interact(picker => { picker.changed.fire(':'); picker.hide(); });
		assert.strictEqual(config.inspect<string>('groupSeparator')?.workspaceValue, '::');
	});

	test('selecting a suggestion applies that candidate', async () => {
		await config.update('groupSeparator', '-', vscode.ConfigurationTarget.Workspace);
		await interact(picker => {
			picker.selectedItems = [picker.items.find(item => item.separator === '::')!];
			picker.accepted.fire();
		});
		assert.strictEqual(config.inspect<string>('groupSeparator')?.workspaceValue, '::');
	});

	test('reset removes only the workspace override', async () => {
		await config.update('groupSeparator', ':', vscode.ConfigurationTarget.Workspace);
		await interact(picker => {
			picker.selectedItems = [picker.items.find(item => item.action === 'reset')!];
			picker.accepted.fire();
		});
		assert.strictEqual(config.inspect<string>('groupSeparator')?.workspaceValue, undefined);
	});

	test('custom-input fallback accepts a literal separator and cancellation leaves it alone', async () => {
		const chooseCustom = (picker: Picker) => {
			picker.selectedItems = [picker.items.find(item => item.action === 'custom')!];
			picker.accepted.fire();
		};
		await interact(chooseCustom, '@@');
		assert.strictEqual(config.inspect<string>('groupSeparator')?.workspaceValue, '@@');
		await interact(chooseCustom);
		assert.strictEqual(config.inspect<string>('groupSeparator')?.workspaceValue, '@@');
	});
});
