import * as vscode from 'vscode';
import { taskKey } from '../types';
import type { StatusRegistry } from './registry';

export async function runTask(task: vscode.Task): Promise<void> {
	await vscode.tasks.executeTask(task);
}

export async function stopTask(
	task: vscode.Task,
	registry: StatusRegistry,
): Promise<void> {
	const exec = registry.getExecution(taskKey(task));
	if (!exec) {
		vscode.window.showInformationMessage(
			`Task "${task.name}" is not running.`,
		);
		return;
	}
	exec.terminate();
}

export async function rerunTask(
	task: vscode.Task,
	registry: StatusRegistry,
): Promise<void> {
	const key = taskKey(task);
	const exec = registry.getExecution(key);

	if (exec) {
		const confirm = vscode.workspace
			.getConfiguration('tasklens')
			.get<boolean>('confirmRerunIfRunning', true);
		if (confirm) {
			const choice = await vscode.window.showWarningMessage(
				`"${task.name}" is already running. Restart it?`,
				{ modal: true },
				'Restart',
			);
			if (choice !== 'Restart') {
				return;
			}
		}
		exec.terminate();
		try {
			await registry.waitForEnd(key);
		} catch {
			vscode.window.showErrorMessage(
				`Could not stop "${task.name}" — it did not exit in time.`,
			);
			return;
		}
	}

	await vscode.tasks.executeTask(task);
}
