import * as vscode from 'vscode';
import { taskKey, type TaskKey, type TaskStatus } from '../types';

export interface TaskRun {
	id: string;
	execution: vscode.TaskExecution;
	key: TaskKey;
	startedAt: number;
	endedAt?: number;
	exitCode?: number;
	status: Exclude<TaskStatus, 'idle'>;
}

type TaskEvents = Pick<typeof vscode.tasks,
	'taskExecutions' | 'onDidStartTask' | 'onDidEndTask' | 'onDidEndTaskProcess'>;

export class StatusRegistry implements vscode.Disposable {
	private readonly executions = new Map<TaskKey, vscode.TaskExecution>();
	private readonly live = new Set<vscode.TaskExecution>();
	private readonly runs = new WeakMap<vscode.TaskExecution, TaskRun>();
	private readonly latest = new Map<TaskKey, TaskRun>();
	private readonly stopping = new WeakSet<vscode.TaskExecution>();
	private readonly _onChange = new vscode.EventEmitter<TaskKey>();
	readonly onChange = this._onChange.event;
	private readonly _onRunChange = new vscode.EventEmitter<TaskRun>();
	readonly onRunChange = this._onRunChange.event;
	private readonly _onEnd = new vscode.EventEmitter<vscode.TaskExecution>();
	private readonly subs: vscode.Disposable[] = [];
	private readonly waiters = new Set<() => void>();
	private ticker: NodeJS.Timeout | undefined;
	private sequence = 0;

	constructor(private readonly api: TaskEvents = vscode.tasks) {
		this.subs.push(
			api.onDidStartTask(e => this.start(e.execution)),
			api.onDidEndTask(e => this.end(e.execution)),
			api.onDidEndTaskProcess(e => this.processEnd(e.execution, e.exitCode)),
		);
		for (const execution of api.taskExecutions) {
			this.start(execution);
		}
	}

	private start(execution: vscode.TaskExecution): TaskRun {
		const known = this.runs.get(execution);
		if (known) {
			return known;
		}
		const key = taskKey(execution.task);
		const run: TaskRun = {
			id: `${Date.now()}-${++this.sequence}`,
			execution, key, startedAt: Date.now(), status: 'running',
		};
		this.runs.set(execution, run);
		this.live.add(execution);
		this.executions.set(key, execution);
		this.latest.set(key, run);
		if (!this.ticker) {
			this.ticker = setInterval(() => this.reconcile(), 1500);
		}
		this.changed(run);
		return run;
	}

	private processEnd(execution: vscode.TaskExecution, exitCode: number | undefined): void {
		const run = this.runs.get(execution) ?? this.start(execution);
		run.exitCode = exitCode;
		run.endedAt ??= Date.now();
		run.status = this.stopping.has(execution) || exitCode === undefined
			? 'stopped' : exitCode === 0 ? 'succeeded' : 'failed';
		// Process exit is authoritative for the icon even if task-end is delayed.
		this.changed(run);
	}

	private end(execution: vscode.TaskExecution): void {
		const run = this.runs.get(execution) ?? this.start(execution);
		this.live.delete(execution);
		if (run.status === 'running') {
			run.status = this.stopping.has(execution) ? 'stopped' : 'ended';
			run.endedAt = Date.now();
		}
		if (this.executions.get(run.key) === execution) {
			this.executions.delete(run.key);
			// VS Code can run multiple instances of the same task.
			for (const other of this.live) {
				if (this.runs.get(other)?.key === run.key) {
					this.executions.set(run.key, other);
				}
			}
		}
		if (this.live.size === 0 && this.ticker) {
			clearInterval(this.ticker);
			this.ticker = undefined;
		}
		this.changed(run);
		this._onEnd.fire(execution);
	}

	private changed(run: TaskRun): void {
		this._onRunChange.fire({ ...run });
		this._onChange.fire(run.key);
	}

	/** Recover missed events, including activation during an existing run. */
	reconcile(): void {
		const actual = new Set(this.api.taskExecutions);
		for (const execution of actual) {
			if (!this.runs.has(execution)) {
				this.start(execution);
			}
		}
		for (const execution of this.live) {
			if (!actual.has(execution)) {
				this.end(execution);
			}
		}
	}

	getRuns(): TaskRun[] {
		return [...this.live].map(execution => ({ ...this.runs.get(execution)! }));
	}

	getRunningExecutions(key?: TaskKey): vscode.TaskExecution[] {
		return [...this.live].filter(execution => {
			const run = this.runs.get(execution)!;
			return run.status === 'running' && (key === undefined || run.key === key);
		});
	}

	isRunning(key: TaskKey): boolean {
		return this.getStatus(key) === 'running';
	}

	getExecution(key: TaskKey): vscode.TaskExecution | undefined {
		return this.executions.get(key);
	}

	getStatus(key: TaskKey): TaskStatus {
		if (this.getRunningExecutions(key).length > 0) {
			return 'running';
		}
		return this.latest.get(key)?.status ?? 'idle';
	}

	getLastRun(key: TaskKey): TaskRun | undefined {
		return this.latest.get(key);
	}

	/** Subscribe before terminating: terminate() may deliver an end event immediately. */
	async stop(execution: vscode.TaskExecution, timeoutMs = 10_000): Promise<void> {
		if (!this.live.has(execution)) {
			return;
		}
		const ended = this.waitForEnd(execution, timeoutMs);
		this.stopping.add(execution);
		try {
			execution.terminate();
		} catch (error) {
			this.stopping.delete(execution);
			void ended.catch(() => {});
			throw error;
		}
		await ended;
	}

	waitForEnd(execution: vscode.TaskExecution, timeoutMs = 10_000): Promise<void> {
		if (!this.live.has(execution)) {
			return Promise.resolve();
		}
		return new Promise<void>((resolve, reject) => {
			const cleanup = () => {
				sub.dispose();
				clearTimeout(timer);
				this.waiters.delete(cancel);
			};
			const cancel = () => {
				cleanup();
				reject(new Error('Task tracking was disposed.'));
			};
			const sub = this._onEnd.event(ended => {
				if (ended === execution) {
					cleanup();
					resolve();
				}
			});
			const timer = setTimeout(() => {
				cleanup();
				reject(new Error(`Timed out waiting for "${execution.task.name}" to stop.`));
			}, timeoutMs);
			this.waiters.add(cancel);
		});
	}

	dispose(): void {
		this.subs.forEach(s => s.dispose());
		if (this.ticker) {
			clearInterval(this.ticker);
		}
		for (const cancel of this.waiters) {
			cancel();
		}
		this._onChange.dispose();
		this._onRunChange.dispose();
		this._onEnd.dispose();
	}
}
