import * as vscode from 'vscode';

/** One snapshot shared by all views. Invalidation never lets an old fetch replace a new one. */
export class TaskCatalog implements vscode.Disposable {
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChange = this.emitter.event;
	private generation = 0;
	private pending?: Promise<vscode.Task[]>;
	private snapshot: vscode.Task[] = [];
	private loaded = false;
	private disposed = false;
	private readonly cancellations = new Set<() => void>();
	loading = false;
	error: string | undefined;

	constructor(
		private readonly fetch: () => Thenable<vscode.Task[]> = () => vscode.tasks.fetchTasks(),
		private readonly timeoutMs = 30_000,
	) {}

	getTasks(): Promise<vscode.Task[]> {
		if (this.pending) {
			return this.pending;
		}
		if (this.loaded || this.disposed) {
			return Promise.resolve(this.snapshot);
		}
		const generation = this.generation;
		this.loading = true;
		this.error = undefined;
		this.pending = Promise.resolve().then(() => this.load(generation));
		this.emitter.fire();
		return this.pending;
	}

	private async load(generation: number): Promise<vscode.Task[]> {
		if (generation !== this.generation || this.disposed) {
			return this.getTasks();
		}
		let timer: NodeJS.Timeout | undefined;
		let cancel: (() => void) | undefined;
		try {
			const tasks = await Promise.race([
				Promise.resolve().then(() => this.fetch()),
				new Promise<never>((_, reject) => {
					cancel = () => reject(new Error('Task discovery was superseded.'));
					this.cancellations.add(cancel);
					timer = setTimeout(() => reject(new Error('Task discovery timed out. Try reloading tasks.')), this.timeoutMs);
				}),
			]);
			if (generation === this.generation && !this.disposed) {
				this.snapshot = tasks;
				this.loaded = true;
			}
		} catch (error) {
			if (generation === this.generation && !this.disposed) {
				this.error = error instanceof Error ? error.message : String(error);
				// Keep the last successful snapshot and retry on an explicit reload.
				this.loaded = true;
			}
		} finally {
			clearTimeout(timer);
			if (cancel) {
				this.cancellations.delete(cancel);
			}
			if (generation === this.generation && !this.disposed) {
				this.pending = undefined;
				this.loading = false;
				this.emitter.fire();
			}
		}
		return generation === this.generation ? this.snapshot : this.getTasks();
	}

	reload(): Promise<vscode.Task[]> {
		this.generation++;
		for (const cancel of this.cancellations) {
			cancel();
		}
		this.pending = undefined;
		this.loaded = false;
		return this.getTasks();
	}

	dispose(): void {
		this.disposed = true;
		for (const cancel of this.cancellations) {
			cancel();
		}
		this.emitter.dispose();
	}
}
