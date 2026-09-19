import * as assert from 'assert';
import { StatusRegistry } from '../runner/registry';
import { taskKey } from '../types';
import { MemoryState, TaskEvents, makeTask } from './helpers';
import { HistoryStore } from '../history/store';

suite('Task lifecycle and history', () => {
	let api: TaskEvents;
	let registry: StatusRegistry;
	setup(() => { api = new TaskEvents(); registry = new StatusRegistry(api); });
	teardown(() => { registry.dispose(); api.dispose(); });

	for (const [code, status] of [[0, 'succeeded'], [7, 'failed'], [undefined, 'stopped']] as const) {
		test(`process exit ${code} immediately shows ${status}`, () => {
			const exec = api.start();
			api.processEnd(exec, code);
			assert.strictEqual(registry.getStatus(taskKey(exec.task)), status);
			assert.strictEqual(registry.isRunning(taskKey(exec.task)), false);
			api.end(exec);
			assert.strictEqual(registry.getStatus(taskKey(exec.task)), status);
		});
	}

	test('task end without process event has an explicit unknown result', () => {
		const exec = api.start(); api.end(exec);
		assert.strictEqual(registry.getStatus(taskKey(exec.task)), 'ended');
	});

	test('process end after task end updates the same history record', () => {
		const history = new HistoryStore(new MemoryState(), registry);
		const exec = api.start(); api.end(exec); api.processEnd(exec, 7);
		assert.strictEqual(registry.getStatus(taskKey(exec.task)), 'failed');
		assert.strictEqual(history.list().length, 1);
		assert.strictEqual(history.list()[0].outcome, 'failed');
		history.dispose();
	});

	test('late events from an old run do not clear a newer run', () => {
		const first = api.start(); api.end(first);
		const second = api.start(); api.processEnd(first, 7); api.end(first);
		assert.strictEqual(registry.getExecution(taskKey(second.task)), second);
		assert.strictEqual(registry.getStatus(taskKey(second.task)), 'running');
		api.processEnd(second, 0); api.end(second); api.processEnd(first, 7);
		assert.strictEqual(registry.getStatus(taskKey(second.task)), 'succeeded');
	});

	test('overlapping executions remain running until all processes finish', () => {
		const history = new HistoryStore(new MemoryState(), registry);
		const first = api.start(); const second = api.start();
		api.processEnd(second, 7); api.end(second);
		assert.strictEqual(registry.getStatus(taskKey(first.task)), 'running');
		assert.strictEqual(registry.getExecution(taskKey(first.task)), first);
		api.processEnd(first, 0); api.end(first);
		assert.strictEqual(registry.getStatus(taskKey(first.task)), 'failed');
		assert.deepStrictEqual(history.list().map(r => r.outcome), ['failed', 'succeeded']);
		history.dispose();
	});

	test('activation restores executions already running', () => {
		registry.dispose(); const exec = api.start(); registry = new StatusRegistry(api);
		assert.strictEqual(registry.getExecution(taskKey(exec.task)), exec);
		assert.strictEqual(registry.getStatus(taskKey(exec.task)), 'running');
	});

	test('reconciliation removes a disappeared execution without inventing an exit code', () => {
		const exec = api.start(); api.taskExecutions = []; registry.reconcile();
		assert.strictEqual(registry.isRunning(taskKey(exec.task)), false);
		assert.strictEqual(registry.getStatus(taskKey(exec.task)), 'ended');
	});

	test('stop handles a synchronous end event and marks the run stopped', async () => {
		const exec = api.start(); await registry.stop(exec, 50);
		assert.strictEqual(registry.getStatus(taskKey(exec.task)), 'stopped');
	});

	test('wait is tied to the execution, not another run with the same key', async () => {
		const first = api.start(); const second = api.start();
		const ended = registry.waitForEnd(second, 20);
		api.end(first);
		await assert.rejects(ended, /Timed out/);
	});

	test('disposing releases pending waiters', async () => {
		const ended = registry.waitForEnd(api.start());
		registry.dispose(); await assert.rejects(ended, /disposed/);
	});

	test('stored running history is no longer shown as running after reload', () => {
		const state = new MemoryState();
		state.values.set('tasklens.history', [{ id: 'old', taskKey: 'old', taskName: 'old', taskSource: 'Workspace', startedAt: 1, outcome: 'running' }]);
		const history = new HistoryStore(state, registry);
		assert.strictEqual(history.list()[0].outcome, 'ended');
		assert.strictEqual(history.list()[0].endedAt, undefined);
		history.dispose();
	});

	test('cleared history is not resurrected when a running task ends', async () => {
		const history = new HistoryStore(new MemoryState(), registry);
		const exec = api.start(makeTask('clear-me')); await history.clear(); api.processEnd(exec, 0); api.end(exec);
		assert.deepStrictEqual(history.list(), []); history.dispose();
	});
});
