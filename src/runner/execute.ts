import * as vscode from 'vscode';
import { taskKey } from '../types';
import type { StatusRegistry } from './registry';

const pending = new Set<string>();

async function guarded(task: vscode.Task, action: () => Promise<void>): Promise<void> {
	const key = taskKey(task);
	if (pending.has(key)) {
		return;
	}
	pending.add(key);
	try {
		await action();
	} catch (error) {
		await vscode.window.showErrorMessage(
			`Task "${task.name}": ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		pending.delete(key);
	}
}

export async function runTask(task: vscode.Task, registry: StatusRegistry): Promise<void> {
	await guarded(task, async () => {
		if (registry.isRunning(taskKey(task))) {
			return;
		}
		await vscode.tasks.executeTask(task);
	});
}

export async function stopTask(task: vscode.Task, registry: StatusRegistry): Promise<void> {
	await guarded(task, async () => {
		await Promise.all(registry.getRunningExecutions(taskKey(task)).map(exec => registry.stop(exec)));
	});
}

export async function rerunTask(task: vscode.Task, registry: StatusRegistry): Promise<void> {
	await guarded(task, async () => {
		const key = taskKey(task);
		if (registry.isRunning(key)) {
			const confirm = vscode.workspace.getConfiguration('tasklens')
				.get<boolean>('confirmRerunIfRunning', true);
			if (confirm) {
				const choice = await vscode.window.showWarningMessage(
					`"${task.name}" is already running. Restart it?`, { modal: true }, 'Restart',
				);
				if (choice !== 'Restart') {
					return;
				}
			}
		}
		// Re-read after confirmation: a run may have ended or been replaced while the dialog was open.
		const executions = registry.getRuns().filter(run => run.key === key).map(run => run.execution);
		await Promise.all(executions.map(exec => registry.stop(exec)));
		await vscode.tasks.executeTask(task);
	});
}
