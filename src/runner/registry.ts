import * as vscode from 'vscode';
import { taskKey, type TaskKey, type TaskStatus } from '../types';

export class StatusRegistry implements vscode.Disposable {
	private executions = new Map<TaskKey, vscode.TaskExecution>();
	private lastResult = new Map<TaskKey, 'succeeded' | 'failed'>();
	private readonly _onChange = new vscode.EventEmitter<TaskKey>();
	readonly onChange = this._onChange.event;
	private readonly subs: vscode.Disposable[] = [];

	constructor() {
		this.subs.push(
			vscode.tasks.onDidStartTask(e => {
				const key = taskKey(e.execution.task);
				this.executions.set(key, e.execution);
				this.lastResult.delete(key);
				this._onChange.fire(key);
			}),
			vscode.tasks.onDidEndTask(e => {
				const key = taskKey(e.execution.task);
				this.executions.delete(key);
				this._onChange.fire(key);
			}),
			vscode.tasks.onDidEndTaskProcess(e => {
				const key = taskKey(e.execution.task);
				this.lastResult.set(key, e.exitCode === 0 ? 'succeeded' : 'failed');
				this._onChange.fire(key);
			}),
		);
	}

	isRunning(key: TaskKey): boolean {
		return this.executions.has(key);
	}

	getExecution(key: TaskKey): vscode.TaskExecution | undefined {
		return this.executions.get(key);
	}

	getStatus(key: TaskKey): TaskStatus {
		if (this.executions.has(key)) {
			return 'running';
		}
		return this.lastResult.get(key) ?? 'idle';
	}

	waitForEnd(key: TaskKey, timeoutMs = 10_000): Promise<void> {
		if (!this.executions.has(key)) {
			return Promise.resolve();
		}
		return new Promise<void>((resolve, reject) => {
			const sub = vscode.tasks.onDidEndTask(e => {
				if (taskKey(e.execution.task) === key) {
					sub.dispose();
					clearTimeout(timer);
					resolve();
				}
			});
			const timer = setTimeout(() => {
				sub.dispose();
				reject(new Error(`Timed out waiting for task ${key} to end`));
			}, timeoutMs);
		});
	}

	dispose(): void {
		this.subs.forEach(s => s.dispose());
		this._onChange.dispose();
	}
}
