import * as vscode from 'vscode';
import type { HistoryStore, RunRecord } from './store';

export interface HistoryNode {
	kind: 'run' | 'empty';
	record?: RunRecord;
	label: string;
}

export class HistoryTreeProvider
	implements vscode.TreeDataProvider<HistoryNode>, vscode.Disposable
{
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChange.event;
	private readonly sub: vscode.Disposable;
	private ticker: NodeJS.Timeout | undefined;

	constructor(private readonly store: HistoryStore) {
		this.sub = store.onDidChange(() => {
			this.refreshTicker();
			this._onDidChange.fire();
		});
		this.refreshTicker();
	}

	getTreeItem(node: HistoryNode): vscode.TreeItem {
		if (node.kind === 'empty') {
			const item = new vscode.TreeItem(
				node.label,
				vscode.TreeItemCollapsibleState.None,
			);
			item.contextValue = 'history.empty';
			return item;
		}
		const record = node.record!;
		const item = new vscode.TreeItem(
			record.taskName,
			vscode.TreeItemCollapsibleState.None,
		);
		item.description = formatDescription(record);
		item.iconPath = iconForOutcome(record);
		item.tooltip = buildTooltip(record);
		item.contextValue =
			record.outcome === 'running' ? 'history.run.running' : 'history.run';
		return item;
	}

	getChildren(element?: HistoryNode): HistoryNode[] {
		if (element) {
			return [];
		}
		const records = this.store.list();
		if (records.length === 0) {
			return [
				{
					kind: 'empty',
					label: 'No task runs yet — run a task to start tracking.',
				},
			];
		}
		return records.map(r => ({
			kind: 'run',
			record: r,
			label: r.taskName,
		}));
	}

	private refreshTicker(): void {
		const hasRunning = this.store
			.list()
			.some(r => r.outcome === 'running');
		if (hasRunning && !this.ticker) {
			this.ticker = setInterval(() => this._onDidChange.fire(), 1000);
		} else if (!hasRunning && this.ticker) {
			clearInterval(this.ticker);
			this.ticker = undefined;
		}
	}

	dispose(): void {
		this.sub.dispose();
		if (this.ticker) {
			clearInterval(this.ticker);
		}
		this._onDidChange.dispose();
	}
}

function formatDescription(record: RunRecord): string {
	const when = formatRelativeTime(record.startedAt);
	const duration = formatDuration(record);
	return `${when} · ${duration}`;
}

function buildTooltip(record: RunRecord): vscode.MarkdownString {
	const md = new vscode.MarkdownString();
	md.appendMarkdown(`**${record.taskName}**\n\n`);
	md.appendMarkdown(`- Source: ${record.taskSource}\n`);
	md.appendMarkdown(
		`- Started: ${new Date(record.startedAt).toLocaleString()}\n`,
	);
	if (record.endedAt !== undefined) {
		md.appendMarkdown(
			`- Ended: ${new Date(record.endedAt).toLocaleString()}\n`,
		);
	}
	md.appendMarkdown(`- Duration: ${formatDuration(record)}\n`);
	md.appendMarkdown(`- Outcome: ${record.outcome}`);
	if (record.exitCode !== undefined) {
		md.appendMarkdown(` (exit ${record.exitCode})`);
	}
	return md;
}

function iconForOutcome(record: RunRecord): vscode.ThemeIcon {
	switch (record.outcome) {
		case 'running':
			return new vscode.ThemeIcon(
				'sync~spin',
				new vscode.ThemeColor('charts.blue'),
			);
		case 'succeeded':
			return new vscode.ThemeIcon(
				'pass',
				new vscode.ThemeColor('charts.green'),
			);
		case 'failed':
			return new vscode.ThemeIcon(
				'error',
				new vscode.ThemeColor('charts.red'),
			);
		case 'ended':
		default:
			return new vscode.ThemeIcon('circle-outline');
	}
}

function formatDuration(record: RunRecord): string {
	const end = record.endedAt ?? Date.now();
	return formatMs(end - record.startedAt);
}

function formatMs(ms: number): string {
	if (ms < 1000) {
		return `${ms}ms`;
	}
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	const remSec = seconds % 60;
	if (minutes < 60) {
		return `${minutes}m ${remSec}s`;
	}
	const hours = Math.floor(minutes / 60);
	const remMin = minutes % 60;
	return `${hours}h ${remMin}m`;
}

function formatRelativeTime(ts: number): string {
	const diff = Date.now() - ts;
	if (diff < 60_000) {
		return 'just now';
	}
	if (diff < 3_600_000) {
		const m = Math.floor(diff / 60_000);
		return `${m}m ago`;
	}
	if (diff < 86_400_000) {
		const h = Math.floor(diff / 3_600_000);
		return `${h}h ago`;
	}
	const d = Math.floor(diff / 86_400_000);
	if (d < 7) {
		return `${d}d ago`;
	}
	return new Date(ts).toLocaleDateString();
}
