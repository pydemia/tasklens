import * as vscode from 'vscode';
import { taskKey, type TaskKey } from '../types';

const STORAGE_KEY = 'tasklens.history';
const MAX_RECORDS = 500;

export type RunOutcome = 'running' | 'succeeded' | 'failed' | 'ended';

export interface RunRecord {
	id: string;
	taskKey: TaskKey;
	taskName: string;
	taskSource: string;
	startedAt: number;
	endedAt?: number;
	exitCode?: number;
	outcome: RunOutcome;
}

interface OpenRun {
	id: string;
	taskKey: TaskKey;
	startedAt: number;
	exitCode?: number;
}

export class HistoryStore implements vscode.Disposable {
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;
	private records: RunRecord[];
	private readonly open = new Map<TaskKey, OpenRun>();

	constructor(private readonly memento: vscode.Memento) {
		this.records = memento.get<RunRecord[]>(STORAGE_KEY, []);
	}

	list(): RunRecord[] {
		return this.records;
	}

	listForTask(key: TaskKey): RunRecord[] {
		return this.records.filter(r => r.taskKey === key);
	}

	recordStart(task: vscode.Task): void {
		const key = taskKey(task);
		const id = `${key}::${Date.now()}::${Math.random().toString(36).slice(2, 8)}`;
		const startedAt = Date.now();
		const record: RunRecord = {
			id,
			taskKey: key,
			taskName: task.name,
			taskSource: task.source,
			startedAt,
			outcome: 'running',
		};
		this.open.set(key, { id, taskKey: key, startedAt });
		this.records.unshift(record);
		this.trim();
		void this.persist();
	}

	recordProcessEnd(task: vscode.Task, exitCode: number | undefined): void {
		const key = taskKey(task);
		const run = this.open.get(key);
		if (run) {
			run.exitCode = exitCode;
		}
		const idx = this.records.findIndex(r => r.id === run?.id);
		if (idx >= 0) {
			this.records[idx] = {
				...this.records[idx],
				exitCode,
			};
			void this.persist();
		}
	}

	recordEnd(task: vscode.Task): void {
		const key = taskKey(task);
		const run = this.open.get(key);
		this.open.delete(key);
		if (!run) {
			return;
		}
		const idx = this.records.findIndex(r => r.id === run.id);
		if (idx < 0) {
			return;
		}
		const endedAt = Date.now();
		const exitCode = run.exitCode;
		const outcome: RunOutcome =
			exitCode === undefined
				? 'ended'
				: exitCode === 0
					? 'succeeded'
					: 'failed';
		this.records[idx] = {
			...this.records[idx],
			endedAt,
			exitCode,
			outcome,
		};
		void this.persist();
	}

	async clear(): Promise<void> {
		this.records = [];
		this.open.clear();
		await this.persist();
	}

	async clearForTask(key: TaskKey): Promise<void> {
		const before = this.records.length;
		this.records = this.records.filter(r => r.taskKey !== key);
		if (this.records.length === before) {
			return;
		}
		await this.persist();
	}

	private trim(): void {
		if (this.records.length > MAX_RECORDS) {
			this.records.length = MAX_RECORDS;
		}
	}

	private async persist(): Promise<void> {
		await this.memento.update(STORAGE_KEY, this.records);
		this._onDidChange.fire();
	}

	dispose(): void {
		this._onDidChange.dispose();
	}
}
