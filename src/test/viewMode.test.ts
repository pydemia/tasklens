import * as assert from 'assert';
import * as vscode from 'vscode';
import { FavoritesStore } from '../favorites/store';
import { StatusRegistry } from '../runner/registry';
import { TaskCatalog } from '../taskCatalog';
import { TasksTreeProvider } from '../tree/provider';
import { getTaskViewMode, TaskViewModeStore, type TaskViewMode } from '../tree/viewMode';
import { taskKey } from '../types';
import { eventually, makeTask, MemoryState, TaskEvents } from './helpers';

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

	test('an actual unregistered-setting rejection switches the cached tree and restores the choice after reactivation', async () => {
		const config = vscode.workspace.getConfiguration('tasklens');
		const save = () => config.update('unregisteredViewModeRegression', 'list', vscode.ConfigurationTarget.Workspace);
		await assert.rejects(async () => save(), /not a registered configuration/);
		const state = new MemoryState();
		const errors: string[] = [];
		let published: TaskViewMode | undefined;
		const overrides = {
			read: (): TaskViewMode => 'tree', save, isRegistered: () => false,
			publish: async (mode: TaskViewMode) => { published = mode; },
			reportError: async (message: string) => { errors.push(message); },
		};
		const store = new TaskViewModeStore(state, overrides);
		const tasks = [makeTask('app::build'), makeTask('app::test')];
		let fetches = 0;
		const catalog = new TaskCatalog(async () => { fetches++; return tasks; });
		const events = new TaskEvents();
		const registry = new StatusRegistry(events);
		const favorites = new FavoritesStore(new MemoryState());
		const provider = new TasksTreeProvider(registry, favorites, () => true, catalog, () => store.mode);
		const originalMode = config.inspect('viewMode')?.workspaceValue;
		try {
			await favorites.add(taskKey(tasks[0]));
			events.start(tasks[0]);
			assert.strictEqual((await provider.getChildren())[1].label, 'app');
			await store.set('list');
			assert.strictEqual(published, 'list');
			const list = await provider.getChildren();
			assert.deepStrictEqual(list.slice(1).map(node => node.label), ['app::build', 'app::test']);
			assert.strictEqual(provider.getTreeItem(list[1]).contextValue, 'task.running.favorite');
			assert.strictEqual(fetches, 1);
			assert.strictEqual(config.inspect('viewMode')?.workspaceValue, originalMode);
			store.dispose();
			const restored = new TaskViewModeStore(state, overrides);
			try {
				assert.strictEqual(restored.mode, 'list');
				await restored.set('tree');
				assert.strictEqual(published, 'tree');
				assert.strictEqual(restored.mode, 'tree');
			} finally { restored.dispose(); }
			assert.deepStrictEqual(errors, []);
		} finally {
			store.dispose(); provider.dispose(); favorites.dispose(); registry.dispose(); events.dispose(); catalog.dispose();
		}
	});

	test('renderer registration errors use workspace storage even when the host reports the setting registered', async () => {
		const state = new MemoryState();
		const store = new TaskViewModeStore(state, {
			read: () => 'tree', isRegistered: () => true,
			save: async () => { throw new Error('Unable to write to Workspace Settings because tasklens.viewMode is not a registered configuration.'); },
			publish: async () => {}, reportError: async message => { assert.fail(message); },
		});
		try { await store.set('list'); assert.strictEqual(store.mode, 'list'); }
		finally { store.dispose(); }
	});

	test('a successful settings write clears the fallback and later settings edits take effect', async () => {
		const state = new MemoryState();
		let registered = false;
		const errors: string[] = [];
		const store = new TaskViewModeStore(state, {
			save: async mode => {
				if (!registered) { throw new Error('Unregistered configuration'); }
				await vscode.workspace.getConfiguration('tasklens').update('viewMode', mode, vscode.ConfigurationTarget.Workspace);
			},
			isRegistered: () => registered, publish: async () => {},
			reportError: async message => { errors.push(message); },
		});
		try {
			await store.set('list');
			registered = true;
			await store.set('tree');
			const restored = new TaskViewModeStore(state, { publish: async () => {} });
			try { assert.strictEqual(restored.mode, 'tree'); } finally { restored.dispose(); }
			await vscode.workspace.getConfiguration('tasklens').update('viewMode', 'list', vscode.ConfigurationTarget.Workspace);
			await eventually(() => store.mode === 'list', 'Settings changes must update the effective mode');
			assert.deepStrictEqual(errors, []);
		} finally { store.dispose(); }
	});

	test('ordinary settings write failures do not silently use the fallback', async () => {
		const state = new MemoryState();
		const errors: string[] = [];
		const store = new TaskViewModeStore(state, {
			read: () => 'tree', isRegistered: () => true,
			save: async () => { throw new Error('Permission denied'); },
			publish: async () => {}, reportError: async message => { errors.push(message); },
		});
		try {
			await store.set('list');
			assert.strictEqual(store.mode, 'tree');
			assert.strictEqual(state.keys().length, 0);
			assert.ok(errors[0].includes('Permission denied'));
		} finally { store.dispose(); }
	});

	test('a changed configured mode replaces the fallback while delimiter edits preserve it', async () => {
		await vscode.workspace.getConfiguration('tasklens').update('viewMode', 'tree', vscode.ConfigurationTarget.Workspace);
		const state = new MemoryState();
		const store = new TaskViewModeStore(state, {
			isRegistered: () => false, save: async () => { throw new Error('Unregistered configuration'); },
			publish: async () => {}, reportError: async message => { assert.fail(message); },
		});
		try {
			await store.set('list');
			await vscode.workspace.getConfiguration('tasklens').update('groupSeparator', ':', vscode.ConfigurationTarget.Workspace);
			assert.strictEqual(store.mode, 'list');
			await vscode.workspace.getConfiguration('tasklens').update('viewMode', 'list', vscode.ConfigurationTarget.Workspace);
			await eventually(() => state.get('tasklens.viewMode.fallback') === undefined, 'An explicit settings change must remove the fallback');
			const restored = new TaskViewModeStore(state, { read: () => 'tree', publish: async () => {} });
			try { assert.strictEqual(restored.mode, 'tree'); } finally { restored.dispose(); }
		} finally { store.dispose(); }
	});

	test('a workspace storage failure leaves the visible mode unchanged and reports the error', async () => {
		const state = new MemoryState();
		state.update = async () => { throw new Error('Workspace storage unavailable'); };
		const errors: string[] = [];
		const store = new TaskViewModeStore(state, {
			read: () => 'tree', isRegistered: () => false,
			save: async () => { throw new Error('Unregistered configuration'); },
			publish: async () => {}, reportError: async message => { errors.push(message); },
		});
		try {
			await store.set('list');
			assert.strictEqual(store.mode, 'tree');
			assert.ok(errors[0].includes('Workspace storage unavailable'));
		} finally { store.dispose(); }
	});
});
