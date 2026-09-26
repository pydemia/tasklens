import * as vscode from 'vscode';
import { taskKey, type TaskNode } from '../types';
import type { StatusRegistry } from '../runner/registry';
import type { FavoritesStore } from '../favorites/store';
import type { TaskCatalog } from '../taskCatalog';
import { buildList, buildTree, type GroupableTask } from './group';
import { getTaskViewMode } from './viewMode';
import {
	favoritesIcon,
	folderIcon,
	folderResourceUri,
	groupIcon,
	groupResourceUri,
	idleTaskIcon,
	statusIcon,
	taskResourceUri,
} from './icons';

export type TaskFilter = (task: vscode.Task) => boolean;

export class TasksTreeProvider
	implements vscode.TreeDataProvider<TaskNode>, vscode.Disposable
{
	private readonly _onDidChange = new vscode.EventEmitter<
		TaskNode | undefined | void
	>();
	readonly onDidChangeTreeData = this._onDidChange.event;

	private readonly registrySub: vscode.Disposable;
	private readonly favoritesSub: vscode.Disposable;
	private readonly catalogSub: vscode.Disposable;

	constructor(
		private readonly registry: StatusRegistry,
		private readonly favorites: FavoritesStore,
		private readonly filter: TaskFilter,
		private readonly catalog: TaskCatalog,
	) {
		this.registrySub = registry.onChange(() => this._onDidChange.fire());
		this.favoritesSub = favorites.onDidChange(() => this.reload());
		this.catalogSub = catalog.onDidChange(() => this.reload());
	}

	reload(): void {
		this._onDidChange.fire();
	}

	getTreeItem(node: TaskNode): vscode.TreeItem {
		if (node.kind === 'group') {
			const label = node.favoritesGroup
				? node.label.toUpperCase()
				: node.label;
			const item = new vscode.TreeItem(
				label,
				vscode.TreeItemCollapsibleState.Expanded,
			);
			item.id = node.id;
			if (node.favoritesGroup) {
				item.iconPath = favoritesIcon;
				item.contextValue = 'group.favorites';
				const realCount = node.children.filter(
					c => !c.placeholder,
				).length;
				if (realCount > 0) {
					item.description = `${realCount}`;
				}
			} else {
				item.resourceUri = node.folderName
					? folderResourceUri(node.folderName)
					: groupResourceUri(node.label);
				item.iconPath = node.folderName ? folderIcon : groupIcon;
				item.contextValue = 'group';
			}
			return item;
		}

		if (node.placeholder) {
			const item = new vscode.TreeItem(
				node.label,
				vscode.TreeItemCollapsibleState.None,
			);
			item.contextValue = 'placeholder';
			item.tooltip = node.label;
			if (node.retry) {
				item.iconPath = new vscode.ThemeIcon('warning');
				item.command = { command: 'tasklens.reload', title: 'Retry Loading Tasks' };
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
		const taskType = node.task?.definition.type;
		const detail = node.task?.detail;
		item.id = node.id;
		const run = node.key ? this.registry.getLastRun(node.key) : undefined;
		const statusText = status === 'ended' ? 'Ended (exit code unavailable)'
			: status.charAt(0).toUpperCase() + status.slice(1);
		item.description = [status === 'idle' ? undefined : statusText, node.folderName, taskType, detail].filter(Boolean).join(' · ');
		item.tooltip = [node.fullLabel, statusText + (run?.exitCode !== undefined ? ` (exit ${run.exitCode})` : ''), detail].filter(Boolean).join('\n');
		if (node.task) {
			item.resourceUri = taskResourceUri(node.task);
		}
		item.iconPath = statusIcon(status) ?? idleTaskIcon;
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
		return this.fetchAndBuild();
	}

	private async fetchAndBuild(): Promise<TaskNode[]> {
		const all = await this.catalog.getTasks();
		const tasks = all.filter(this.filter);
		const separator = vscode.workspace
			.getConfiguration('tasklens')
			.get<string>('groupSeparator', '::');
		const folders = vscode.workspace.workspaceFolders ?? [];

		const main = getTaskViewMode() === 'list'
			? buildList(tasks.map(task => this.toGroupable(task, folders.length > 1)))
			: folders.length > 1
				? this.groupByFolder(tasks, folders, separator)
				: buildTree(tasks.map(t => this.toGroupable(t)), separator);

		const favorites = this.buildFavoritesGroup(tasks);
		const roots = favorites.children.length > 0 ? [favorites, ...main] : main;
		if (this.catalog.error) {
			roots.unshift({ kind: 'task', label: `Could not load tasks: ${this.catalog.error} — click to retry`, placeholder: true, retry: true, children: [] });
		}
		this.assignIds(roots, 'root');
		return roots;
	}

	private assignIds(nodes: TaskNode[], parent: string): void {
		for (const node of nodes) {
			node.id ??= node.kind === 'task' && node.key
				? `${parent}/task:${node.key}`
				: `${parent}/${node.favoritesGroup ? 'favorites' : 'group'}:${encodeURIComponent(node.label)}`;
			this.assignIds(node.children, node.id);
		}
	}

	private buildFavoritesGroup(tasks: vscode.Task[]): TaskNode {
		const favTasks = tasks.filter(t => this.favorites.has(taskKey(t)));
		const includeFolder = getTaskViewMode() === 'list' && (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
		const children: TaskNode[] =
			favTasks.length === 0
				? []
				: favTasks.map(t => ({
						kind: 'task',
						label: t.name,
						fullLabel: t.name,
						task: t,
						key: taskKey(t),
						favorite: true,
						folderName: includeFolder ? this.scopeName(t) : undefined,
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
				id: `folder:${folder.uri.toString()}`,
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

	private scopeName(task: vscode.Task): string {
		return typeof task.scope === 'object' ? task.scope.name : task.source;
	}

	private toGroupable(task: vscode.Task, includeFolder = false): GroupableTask {
		const key = taskKey(task);
		return {
			key,
			name: task.name,
			node: {
				fullLabel: task.name,
				task,
				key,
				favorite: this.favorites.has(key),
				folderName: includeFolder ? this.scopeName(task) : undefined,
			},
		};
	}

	dispose(): void {
		this.registrySub.dispose();
		this.favoritesSub.dispose();
		this.catalogSub.dispose();
		this._onDidChange.dispose();
	}
}
