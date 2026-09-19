import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskCatalog } from '../taskCatalog';
import { FavoritesStore } from '../favorites/store';
import { StatusRegistry } from '../runner/registry';
import { TasksTreeProvider } from '../tree/provider';
import { taskKey } from '../types';
import { deferred, makeTask, MemoryState, TaskEvents } from './helpers';

suite('Task discovery and tree', () => {
	test('concurrent views share a single fetch and favorites keep the snapshot', async () => {
		let calls = 0;
		const task = makeTask('build::app');
		const catalog = new TaskCatalog(async () => { calls++; return [task]; });
		const events = new TaskEvents(); const registry = new StatusRegistry(events);
		const favorites = new FavoritesStore(new MemoryState());
		const providers = [1, 2, 3].map(() => new TasksTreeProvider(registry, favorites, () => true, catalog));
		try {
			const roots = await Promise.all(providers.map(p => p.getChildren()));
			assert.strictEqual(calls, 1);
			const originalId = providers[0].getTreeItem(roots[0][0]).id;
			await favorites.add(taskKey(task));
			const next = await providers[0].getChildren();
			assert.strictEqual(calls, 1);
			assert.strictEqual(providers[0].getTreeItem(next[1]).id, originalId);
			assert.notStrictEqual(next[0].children[0].id, next[1].children[0].id);
		} finally { providers.forEach(p => p.dispose()); favorites.dispose(); registry.dispose(); events.dispose(); catalog.dispose(); }
	});

	test('an obsolete fetch cannot overwrite a newer reload', async () => {
		const first = deferred<vscode.Task[]>(); const second = deferred<vscode.Task[]>();
		let calls = 0; const catalog = new TaskCatalog(() => ++calls === 1 ? first.promise : second.promise);
		const old = catalog.getTasks(); await Promise.resolve(); await Promise.resolve();
		const fresh = catalog.reload(); second.resolve([makeTask('new')]); await fresh;
		first.resolve([makeTask('old')]);
		assert.strictEqual((await old)[0].name, 'new');
		assert.strictEqual((await catalog.getTasks())[0].name, 'new'); catalog.dispose();
	});

	test('a failed reload retains previous tasks and can be retried', async () => {
		let fail = false;
		const catalog = new TaskCatalog(async () => { if (fail) { throw new Error('provider failed'); } return [makeTask()]; });
		await catalog.getTasks(); fail = true; const stale = await catalog.reload();
		assert.strictEqual(stale.length, 1); assert.match(catalog.error!, /provider failed/);
		fail = false; await catalog.reload(); assert.strictEqual(catalog.error, undefined); catalog.dispose();
	});

	test('a hung provider becomes a retryable error', async () => {
		const catalog = new TaskCatalog(() => new Promise(() => {}), 10);
		assert.deepStrictEqual(await catalog.getTasks(), []);
		assert.match(catalog.error!, /timed out/); assert.strictEqual(catalog.loading, false); catalog.dispose();
	});

	test('reload releases readers waiting on a superseded hung provider', async () => {
		let calls = 0;
		const catalog = new TaskCatalog(() => ++calls === 1 ? new Promise(() => {}) : Promise.resolve([makeTask('recovered')]));
		const old = catalog.getTasks(); await Promise.resolve(); await Promise.resolve();
		await catalog.reload();
		assert.strictEqual((await old)[0].name, 'recovered'); catalog.dispose();
	});

	test('disposal releases pending discovery without waiting for its timeout', async () => {
		const catalog = new TaskCatalog(() => new Promise(() => {}));
		const waiting = catalog.getTasks(); await Promise.resolve();
		catalog.dispose(); assert.deepStrictEqual(await waiting, []);
	});

	test('empty views return no placeholder favorites so VS Code welcome actions can appear', async () => {
		const events = new TaskEvents(); const registry = new StatusRegistry(events);
		const catalog = new TaskCatalog(async () => []); const favorites = new FavoritesStore(new MemoryState());
		const provider = new TasksTreeProvider(registry, favorites, () => true, catalog);
		assert.deepStrictEqual(await provider.getChildren(), []);
		provider.dispose(); favorites.dispose(); catalog.dispose(); registry.dispose(); events.dispose();
	});
});
