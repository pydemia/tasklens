import type { TaskNode } from '../types';

export interface GroupableTask {
	key: string;
	name: string;
	node: Pick<TaskNode, 'fullLabel' | 'task' | 'key' | 'favorite'>;
}

export function buildTree(tasks: GroupableTask[], separator: string): TaskNode[] {
	const root: TaskNode[] = [];

	for (const t of tasks) {
		const path = splitTaskName(t.name, separator);
		let level = root;

		for (let i = 0; i < path.length - 1; i++) {
			const seg = path[i];
			let group = level.find(
				n => n.kind === 'group' && n.label === seg,
			);
			if (!group) {
				group = { kind: 'group', label: seg, children: [] };
				level.push(group);
			}
			level = group.children;
		}

		level.push({
			kind: 'task',
			label: path[path.length - 1],
			fullLabel: t.name,
			task: t.node.task,
			key: t.node.key,
			favorite: t.node.favorite,
			children: [],
		});
	}

	return root;
}

export function splitTaskName(name: string, separator: string): string[] {
	const segments = name.split(separator || '::').map(segment => segment.trim()).filter(Boolean);
	return segments.length > 0 ? segments : [name];
}
