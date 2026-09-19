import * as vscode from 'vscode';
import type { TaskKey } from '../types';
import type { StatusRegistry, TaskRun } from '../runner/registry';

const STORAGE_KEY = 'tasklens.history';
const MAX_RECORDS = 500;

export type RunOutcome = TaskRun['status'];

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

export class HistoryStore implements vscode.Disposable {
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;
	private records: RunRecord[];
	private readonly sub: vscode.Disposable;
	private readonly ignored = new Set<string>();
	private pending: Promise<void> = Promise.resolve();

	constructor(private readonly memento: vscode.Memento, registry: StatusRegistry) {
		// A persisted running record cannot prove that a process survived a host reload.
		this.records = memento.get<RunRecord[]>(STORAGE_KEY, []).map(record =>
			record.outcome === 'running' ? { ...record, outcome: 'ended' as const } : record,
		);
		this.sub = registry.onRunChange(run => this.record(run));
		for (const run of registry.getRuns()) {
			this.record(run);
		}
		this.persist();
	}

	list(): readonly RunRecord[] {
		return this.records;
	}

	listForTask(key: TaskKey): RunRecord[] {
		return this.records.filter(r => r.taskKey === key);
	}

	private record(run: TaskRun): void {
		if (this.ignored.has(run.id)) {
			return;
		}
		const record: RunRecord = {
			id: run.id, taskKey: run.key,
			taskName: run.execution.task.name, taskSource: run.execution.task.source,
			startedAt: run.startedAt, endedAt: run.endedAt,
			exitCode: run.exitCode, outcome: run.status,
		};
		const index = this.records.findIndex(r => r.id === run.id);
		if (index >= 0) {
			this.records[index] = record;
		} else {
			this.records.unshift(record);
		}
		if (this.records.length > MAX_RECORDS) {
			for (const old of this.records.splice(MAX_RECORDS)) {
				this.ignored.add(old.id);
			}
		}
		this.persist();
	}

	async clear(): Promise<void> {
		for (const record of this.records) {
			this.ignored.add(record.id);
		}
		this.records = [];
		await this.persist();
	}

	async clearForTask(key: TaskKey): Promise<void> {
		for (const record of this.records.filter(r => r.taskKey === key)) {
			this.ignored.add(record.id);
		}
		this.records = this.records.filter(r => r.taskKey !== key);
		await this.persist();
	}

	private persist(): Promise<void> {
		const snapshot = this.records.map(record => ({ ...record }));
		this._onDidChange.fire();
		this.pending = this.pending.then(() => this.memento.update(STORAGE_KEY, snapshot))
			.catch(error => console.error('TaskLens: could not save task history', error));
		return this.pending;
	}

	dispose(): void {
		this.sub.dispose();
		this._onDidChange.dispose();
	}
}
