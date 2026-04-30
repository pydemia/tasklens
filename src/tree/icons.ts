import * as vscode from 'vscode';
import type { TaskStatus } from '../types';

export function statusIcon(status: TaskStatus): vscode.ThemeIcon {
	switch (status) {
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
		case 'idle':
		default:
			return new vscode.ThemeIcon('circle-large-outline');
	}
}

export const groupIcon = new vscode.ThemeIcon('folder');
export const folderIcon = new vscode.ThemeIcon('root-folder');
export const favoritesIcon = new vscode.ThemeIcon(
	'star-full',
	new vscode.ThemeColor('charts.yellow'),
);
