import { parseTree, findNodeAtLocation } from 'jsonc-parser';

export interface JsoncRange {
	offset: number;
	length: number;
}

export function locateTaskInJsonc(text: string, label: string, workspaceFile = false): JsoncRange | null {
	const root = parseTree(text);
	if (!root) {
		return null;
	}
	const tasksNode = findNodeAtLocation(root, workspaceFile ? ['tasks', 'tasks'] : ['tasks']);
	if (!tasksNode || tasksNode.type !== 'array' || !tasksNode.children) {
		return null;
	}
	for (const item of tasksNode.children) {
		const labelNode = findNodeAtLocation(item, ['label']);
		if (labelNode && labelNode.type === 'string' && labelNode.value === label) {
			return { offset: item.offset, length: item.length };
		}
	}
	return null;
}
