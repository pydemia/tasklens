import * as vscode from 'vscode';

export function makeTask(name = 'build'): vscode.Task {
	return new vscode.Task({ type: 'shell' }, vscode.TaskScope.Workspace, name, 'Workspace');
}

export class MemoryState implements vscode.Memento {
	readonly values = new Map<string, unknown>();
	get<T>(key: string, fallback?: T): T { return (this.values.get(key) ?? fallback) as T; }
	keys(): readonly string[] { return [...this.values.keys()]; }
	async update(key: string, value: unknown): Promise<void> { this.values.set(key, value); }
}

export class TaskEvents implements vscode.Disposable {
	taskExecutions: vscode.TaskExecution[] = [];
	readonly started = new vscode.EventEmitter<vscode.TaskStartEvent>();
	readonly ended = new vscode.EventEmitter<vscode.TaskEndEvent>();
	readonly processEnded = new vscode.EventEmitter<vscode.TaskProcessEndEvent>();
	onDidStartTask = this.started.event;
	onDidEndTask = this.ended.event;
	onDidEndTaskProcess = this.processEnded.event;
	start(task = makeTask()): vscode.TaskExecution {
		const execution = { task, terminate: () => this.end(execution) };
		this.taskExecutions.push(execution);
		this.started.fire({ execution });
		return execution;
	}
	end(execution: vscode.TaskExecution): void {
		this.taskExecutions = this.taskExecutions.filter(e => e !== execution);
		this.ended.fire({ execution });
	}
	processEnd(execution: vscode.TaskExecution, exitCode: number | undefined): void {
		this.processEnded.fire({ execution, exitCode });
	}
	dispose(): void { this.started.dispose(); this.ended.dispose(); this.processEnded.dispose(); }
}

export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

export async function eventually(check: () => boolean, message: string, timeoutMs = 10_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) { throw new Error(message); }
		await new Promise(resolve => setTimeout(resolve, 25));
	}
}
