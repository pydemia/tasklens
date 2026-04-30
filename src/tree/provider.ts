import * as vscode from 'vscode';
import { taskKey, type TaskNode } from '../types';
import type { StatusRegistry } from '../runner/registry';
import type { FavoritesStore } from '../favorites/store';
import { buildTree, type GroupableTask } from './group';
import { favoritesIcon, folderIcon, groupIcon, statusIcon } from './icons';

export type TaskFilter = (task: vscode.Task) => boolean;

export class TasksTreeProvider
	implements vscode.TreeDataProvider<TaskNode>, vscode.Disposable
{
	private readonly _onDidChange = new vscode.EventEmitter<
		TaskNode | undefined | void
	>();
	readonly onDidChangeTreeData = this._onDidChange.event;

	private cache: TaskNode[] = [];
	private fetchPromise: Promise<TaskNode[]> | undefined;
	private readonly registrySub: vscode.Disposable;
	private readonly favoritesSub: vscode.Disposable;

	constructor(
		private readonly registry: StatusRegistry,
		private readonly favorites: FavoritesStore,
		private readonly filter: TaskFilter,
	) {
		this.registrySub = registry.onChange(() => this._onDidChange.fire());
		this.favoritesSub = favorites.onDidChange(() => this.reload());
	}

	reload(): void {
		this.fetchPromise = undefined;
		this._onDidChange.fire();
	}

	getTreeItem(node: TaskNode): vscode.TreeItem {
		if (node.kind === 'group') {
			const item = new vscode.TreeItem(
				node.label,
				vscode.TreeItemCollapsibleState.Expanded,
			);
			if (node.favoritesGroup) {
				item.iconPath = favoritesIcon;
				item.contextValue = 'group.favorites';
			} else {
				item.iconPath = node.folderName ? folderIcon : groupIcon;
				item.contextValue = 'group';
			}
			return item;
		}

		const status = node.key
			? this.registry.getStatus(node.key)
			: 'idle';
		const item = new vscode.TreeItem(
			node.label,
			vscode.TreeItemCollapsibleState.None,
		);
		item.description = node.task?.definition.type;
		item.tooltip = node.fullLabel;
		item.iconPath = statusIcon(status);
		const favSuffix = node.favorite ? '.favorite' : '';
		item.contextValue =
			(status === 'running' ? 'task.running' : 'task') + favSuffix;
		if (node.task) {
			item.command = {
				command: 'tasklens.revealDefinition',
				title: 'Reveal Definition',
				arguments: [node],
			};
		}
		return item;
	}

	async getChildren(element?: TaskNode): Promise<TaskNode[]> {
		if (element) {
			return element.children;
		}
		if (!this.fetchPromise) {
			this.fetchPromise = this.fetchAndBuild();
		}
		this.cache = await this.fetchPromise;
		return this.cache;
	}

	private async fetchAndBuild(): Promise<TaskNode[]> {
		const all = await vscode.tasks.fetchTasks();
		const tasks = all.filter(this.filter);
		const separator = vscode.workspace
			.getConfiguration('tasklens')
			.get<string>('groupSeparator', '::');
		const folders = vscode.workspace.workspaceFolders ?? [];

		const main =
			folders.length > 1
				? this.groupByFolder(tasks, folders, separator)
				: buildTree(tasks.map(t => this.toGroupable(t)), separator);

		const favoritesGroup = this.buildFavoritesGroup(tasks);
		return favoritesGroup ? [favoritesGroup, ...main] : main;
	}

	private buildFavoritesGroup(tasks: vscode.Task[]): TaskNode | undefined {
		const favTasks = tasks.filter(t => this.favorites.has(taskKey(t)));
		if (favTasks.length === 0) {
			return undefined;
		}
		const children: TaskNode[] = favTasks.map(t => ({
			kind: 'task',
			label: t.name,
			fullLabel: t.name,
			task: t,
			key: taskKey(t),
			favorite: true,
			children: [],
		}));
		return {
			kind: 'group',
			label: 'Favorites',
			favoritesGroup: true,
			children,
		};
	}

	private groupByFolder(
		tasks: vscode.Task[],
		folders: readonly vscode.WorkspaceFolder[],
		separator: string,
	): TaskNode[] {
		const buckets = new Map<string, vscode.Task[]>();
		const orphan: vscode.Task[] = [];

		for (const t of tasks) {
			const scope = t.scope;
			if (
				scope &&
				typeof scope === 'object' &&
				'uri' in scope
			) {
				const key = scope.uri.toString();
				const arr = buckets.get(key) ?? [];
				arr.push(t);
				buckets.set(key, arr);
			} else {
				orphan.push(t);
			}
		}

		const result: TaskNode[] = [];
		for (const folder of folders) {
			const folderTasks = buckets.get(folder.uri.toString()) ?? [];
			if (folderTasks.length === 0) {
				continue;
			}
			result.push({
				kind: 'group',
				label: folder.name,
				folderName: folder.name,
				children: buildTree(
					folderTasks.map(t => this.toGroupable(t)),
					separator,
				),
			});
		}
		if (orphan.length > 0) {
			result.push({
				kind: 'group',
				label: 'Workspace',
				children: buildTree(
					orphan.map(t => this.toGroupable(t)),
					separator,
				),
			});
		}
		return result;
	}

	private toGroupable(task: vscode.Task): GroupableTask {
		const key = taskKey(task);
		return {
			key,
			name: task.name,
			node: {
				fullLabel: task.name,
				task,
				key,
				favorite: this.favorites.has(key),
			},
		};
	}

	dispose(): void {
		this.registrySub.dispose();
		this.favoritesSub.dispose();
		this._onDidChange.dispose();
	}
}
