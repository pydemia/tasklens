import * as vscode from 'vscode';

export async function focusTaskTerminal(task: vscode.Task): Promise<void> {
	const terminals = vscode.window.terminals.filter(t => t.exitStatus === undefined);
	const exact = terminals.filter(t => t.name === task.name);
	// Task terminals can include their workspace folder or the 'Task - ' prefix.
	const matches = exact.length > 0 ? exact : terminals.filter(t =>
		t.name === `Task - ${task.name}` || t.name.startsWith(`${task.name} (`)
		|| t.name.startsWith(`${task.name} - `),
	);
	let terminal: vscode.Terminal | undefined;
	if (matches.length === 1) {
		terminal = matches[0];
	} else if (matches.length > 1) {
		terminal = (await vscode.window.showQuickPick(
			matches.map((candidate, index) => ({ label: candidate.name, description: `Terminal ${index + 1}`, terminal: candidate })),
			{ placeHolder: `Choose the terminal for ${task.name}` },
		))?.terminal;
	} else {
		await vscode.window.showInformationMessage(`No terminal found for "${task.name}". Its terminal may have been closed.`);
	}
	terminal?.show(false);
}
