import * as assert from 'assert';
import * as vscode from 'vscode';
import { StatusRegistry } from '../runner/registry';
import { rerunTask } from '../runner/execute';
import { HistoryStore } from '../history/store';
import { taskKey } from '../types';
import { eventually, MemoryState } from './helpers';
import { isGlobalScoped, isWorkspaceScoped } from '../taskScopes';

suite('VS Code integration', () => {
	let registry: StatusRegistry;
	let history: HistoryStore;
	let tasks: vscode.Task[];
	setup(async () => {
		await vscode.extensions.getExtension('pydemia.tasklens')!.activate();
		registry = new StatusRegistry();
		history = new HistoryStore(new MemoryState(), registry);
		tasks = await vscode.tasks.fetchTasks();
	});
	teardown(async () => {
		await Promise.all(registry.getRunningExecutions().map(exec => registry.stop(exec)));
		history.dispose(); registry.dispose();
		for (const terminal of vscode.window.terminals) { terminal.dispose(); }
	});

	function fixture(name: string): vscode.Task {
		const task = tasks.find(task => task.name === name && typeof task.scope === 'object');
		assert.ok(task, `Missing fixture ${name}; found ${tasks.map(t => t.name).join(', ')}`);
		return task;
	}

	async function startProcess(task: vscode.Task): Promise<vscode.TaskExecution> {
		let started = false;
		const sub = vscode.tasks.onDidStartTaskProcess(e => {
			if (taskKey(e.execution.task) === taskKey(task)) { started = true; }
		});
		try {
			const execution = await vscode.tasks.executeTask(task);
			await eventually(() => started, 'The task process did not start');
			return execution;
		} finally { sub.dispose(); }
	}

	test('user tasks are classified globally and folder tasks keep their scope', () => {
		const global = tasks.find(task => task.name === 'test::global');
		assert.ok(global, 'User task fixture was not discovered');
		assert.ok(isGlobalScoped(global), `User task: source=${global.source} scope=${JSON.stringify(global.scope)}`);
		assert.ok(isWorkspaceScoped(fixture('test::success')));
	});

	test('activation registers task actions and loads configured tasks', async () => {
		const commands = await vscode.commands.getCommands(true);
		for (const id of ['tasklens.reload', 'tasklens.quickRun', 'tasklens.rerunHistory']) { assert.ok(commands.includes(id)); }
		assert.ok(fixture('test::success'));
		await vscode.commands.executeCommand('tasklens.reload');
	});

	for (const [name, status, exitCode] of [['test::success', 'succeeded', 0], ['test::failure', 'failed', 7]] as const) {
		test(`real shell ${name} updates registry and history`, async () => {
			const task = fixture(name); const execution = await vscode.tasks.executeTask(task);
			await eventually(() => registry.getStatus(taskKey(task)) === status, `Expected ${status}`);
			assert.strictEqual(history.list()[0].outcome, status);
			assert.strictEqual(history.list()[0].exitCode, exitCode);
			await registry.waitForEnd(execution);
		});
	}

	test('closing a running task terminal removes its running state', async () => {
		const task = fixture('test::long');
		await startProcess(task);
		await eventually(() => registry.isRunning(taskKey(task)), 'Task did not start');
		await eventually(() => vscode.window.terminals.some(t => t.name === task.name), 'Task terminal was not created');
		vscode.window.terminals.find(t => t.name === task.name)!.dispose();
		await eventually(() => !registry.isRunning(taskKey(task)), 'Closed terminal left a running icon');
		assert.notStrictEqual(history.list()[0].outcome, 'running');
		assert.notStrictEqual(registry.getStatus(taskKey(task)), 'idle');
	});

	test('restart waits for the old execution and tracks a new execution', async () => {
		const task = fixture('test::long');
		const first = await startProcess(task);
		await eventually(() => registry.isRunning(taskKey(task)), 'Task did not start');
		await rerunTask(task, registry);
		await eventually(() => registry.isRunning(taskKey(task)) && registry.getExecution(taskKey(task)) !== first, 'Task was not restarted');
		assert.strictEqual(history.list().length, 2);
		assert.strictEqual(history.list()[1].outcome, 'stopped');
		const current = registry.getExecution(taskKey(task))!;
		await registry.stop(current);
		assert.strictEqual(registry.getStatus(taskKey(task)), 'stopped');
	});
});
