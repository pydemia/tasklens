import * as vscode from 'vscode';
import type { TaskKey } from '../types';

const STORAGE_KEY = 'tasklens.favorites';

export class FavoritesStore implements vscode.Disposable {
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;
	private keys: Set<TaskKey>;

	constructor(private readonly memento: vscode.Memento) {
		const stored = memento.get<TaskKey[]>(STORAGE_KEY, []);
		this.keys = new Set(stored);
	}

	has(key: TaskKey): boolean {
		return this.keys.has(key);
	}

	list(): TaskKey[] {
		return [...this.keys];
	}

	async add(key: TaskKey): Promise<void> {
		if (this.keys.has(key)) {
			return;
		}
		this.keys.add(key);
		await this.persist();
	}

	async remove(key: TaskKey): Promise<void> {
		if (!this.keys.delete(key)) {
			return;
		}
		await this.persist();
	}

	private async persist(): Promise<void> {
		await this.memento.update(STORAGE_KEY, [...this.keys]);
		this._onDidChange.fire();
	}

	dispose(): void {
		this._onDidChange.dispose();
	}
}
