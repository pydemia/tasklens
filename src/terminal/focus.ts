import * as vscode from 'vscode';

export function focusTaskTerminal(task: vscode.Task): void {
	const terminal = vscode.window.terminals.find(t => t.name === task.name)
		?? vscode.window.terminals.find(t => t.name.includes(task.name));

	if (!terminal) {
		vscode.window.showInformationMessage(
			`No terminal found for "${task.name}". The task may have ended or hidden its terminal.`,
		);
		return;
	}

	terminal.show();
}
