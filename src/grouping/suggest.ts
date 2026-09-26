import { splitTaskName } from '../tree/group';

export interface TaskLabel {
	name: string;
	/** Labels in separate views/folders must not form a fictitious shared group. */
	scope: string;
}

export interface SeparatorAnalysis {
	separator: string;
	affectedTasks: number;
	groupedTasks: number;
	example?: { name: string; path: string[] };
	signature: string;
}

export function analyzeSeparator(labels: readonly TaskLabel[], separator: string): SeparatorAnalysis {
	const distinct = [...new Map(labels.map(label => [JSON.stringify([label.scope, label.name]), label])).values()];
	const paths = distinct.map(label => ({ ...label, path: splitTaskName(label.name, separator) }));
	const groups = new Map<string, number>();
	for (const label of paths) {
		for (let depth = 1; depth < label.path.length; depth++) {
			const key = JSON.stringify([label.scope, label.path.slice(0, depth)]);
			groups.set(key, (groups.get(key) ?? 0) + 1);
		}
	}
	const affected = paths.filter(label => label.path.length > 1);
	const grouped = affected.filter(label => groups.get(JSON.stringify([label.scope, label.path.slice(0, 1)]))! >= 2);
	const example = (grouped.length > 0 ? grouped : affected).slice().sort((a, b) => a.name.localeCompare(b.name))[0];
	return {
		separator, affectedTasks: affected.length, groupedTasks: grouped.length,
		example: example ? { name: example.name, path: example.path } : undefined,
		signature: JSON.stringify(paths.map(label => JSON.stringify([label.scope, label.path])).sort()),
	};
}

/** Rank shared label prefixes, without guessing intent or using a model. */
export function suggestSeparators(labels: readonly TaskLabel[]): SeparatorAnalysis[] {
	const candidates = new Set(['::', ':', '/', '\\', '.', '-', '_', ' / ', ' - ', ' > ', '>', '|']);
	for (const label of labels) {
		for (const match of label.name.matchAll(/[^\p{L}\p{N}\s]+/gu)) {
			candidates.add(match[0]);
		}
	}
	const ranked = [...candidates].map(separator => analyzeSeparator(labels, separator))
		.filter(analysis => analysis.groupedTasks >= 2)
		.sort((a, b) => b.groupedTasks - a.groupedTasks || b.affectedTasks - a.affectedTasks
			|| b.separator.length - a.separator.length || a.separator.localeCompare(b.separator));
	const signatures = new Set<string>();
	return ranked.filter(analysis => {
		if (signatures.has(analysis.signature)) { return false; }
		signatures.add(analysis.signature);
		return true;
	}).slice(0, 5);
}
