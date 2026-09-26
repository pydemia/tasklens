import * as assert from 'assert';
import * as vscode from 'vscode';
import { FavoritesStore } from '../favorites/store';
import { StatusRegistry } from '../runner/registry';
import { TaskCatalog } from '../taskCatalog';
import { TasksTreeProvider } from '../tree/provider';
import { getTaskViewMode } from '../tree/viewMode';
import { taskKey } from '../types';
import { makeTask, MemoryState, TaskEvents } from './helpers';

suite('Workspace Tree/List view switching', () => {
	const config = vscode.workspace.getConfiguration('tasklens');
	let originalMode: string | undefined;
	let originalSeparator: string | undefined;
	let originalSettings: Uint8Array;
	let settingsUri: vscode.Uri;
	setup(async () => {
		await vscode.extensions.getExtension('pydemia.tasklens')!.activate();
		originalMode = config.inspect<string>('viewMode')?.workspaceValue;
		originalSeparator = config.inspect<string>('groupSeparator')?.workspaceValue;
		settingsUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, '.vscode', 'settings.json');
		originalSettings = await vscode.workspace.fs.readFile(settingsUri);
		await config.update('groupSeparator', '::', vscode.ConfigurationTarget.Workspace);
	});
	teardown(async () => {
		await config.update('viewMode', originalMode, vscode.ConfigurationTarget.Workspace);
		await config.update('groupSeparator', originalSeparator, vscode.ConfigurationTarget.Workspace);
		await vscode.workspace.fs.writeFile(settingsUri, originalSettings);
	});

	test('switching preserves favorites, running state, separator and the cached task snapshot', async () => {
		const userMode = config.inspect<string>('viewMode')?.globalValue;
		const tasks = [makeTask('app::build'), makeTask('app::test')];
		let fetches = 0;
		const catalog = new TaskCatalog(async () => { fetches++; return tasks; });
		const events = new TaskEvents();
		const registry = new StatusRegistry(events);
		const favorites = new FavoritesStore(new MemoryState());
		const provider = new TasksTreeProvider(registry, favorites, () => true, catalog);
		try {
			await favorites.add(taskKey(tasks[0]));
			events.start(tasks[0]);
			await vscode.commands.executeCommand('tasklens.showTreeView');
			const tree = await provider.getChildren();
			assert.strictEqual(tree[1].label, 'app');
			assert.strictEqual(tree[1].children[0].label, 'build');
			await vscode.commands.executeCommand('tasklens.showListView');
			assert.strictEqual(config.inspect<string>('viewMode')?.workspaceValue, 'list');
			assert.strictEqual(config.inspect<string>('viewMode')?.globalValue, userMode);
			const list = await provider.getChildren();
			assert.ok(list[0].favoritesGroup);
			assert.deepStrictEqual(list.slice(1).map(node => node.label), ['app::build', 'app::test']);
			assert.ok(list.slice(1).every(node => node.children.length === 0));
			assert.strictEqual(list[1].favorite, true);
			assert.strictEqual(provider.getTreeItem(list[1]).contextValue, 'task.running.favorite');
			assert.notStrictEqual(list[0].children[0].id, list[1].id);
			await vscode.commands.executeCommand('tasklens.toggleViewMode');
			assert.strictEqual(getTaskViewMode(), 'tree');
			assert.strictEqual((await provider.getChildren())[1].children[0].label, 'build');
			assert.strictEqual(vscode.workspace.getConfiguration('tasklens').get('groupSeparator'), '::');
			assert.strictEqual(fetches, 1);
		} finally {
			provider.dispose(); favorites.dispose(); registry.dispose(); events.dispose(); catalog.dispose();
		}
	});

	test('delimiter changes keep List View selected until the user switches back to Tree View', async () => {
		await vscode.commands.executeCommand('tasklens.showListView');
		await config.update('groupSeparator', ':', vscode.ConfigurationTarget.Workspace);
		assert.strictEqual(getTaskViewMode(), 'list');
		await vscode.commands.executeCommand('tasklens.showTreeView');
		assert.strictEqual(getTaskViewMode(), 'tree');
		assert.strictEqual(vscode.workspace.getConfiguration('tasklens').get('groupSeparator'), ':');
	});
});
