import * as vscode from 'vscode';

export type TaskViewMode = 'tree' | 'list';

const FALLBACK_KEY = 'tasklens.viewMode.fallback';

interface ViewModeServices {
	read(): TaskViewMode;
	save(mode: TaskViewMode): Thenable<void>;
	isRegistered(): boolean;
	publish(mode: TaskViewMode): Thenable<unknown>;
	reportError(message: string): Thenable<unknown>;
}

const services: ViewModeServices = {
	read: getTaskViewMode,
	save: mode => vscode.workspace.getConfiguration('tasklens').update('viewMode', mode, vscode.ConfigurationTarget.Workspace),
	isRegistered: () => vscode.workspace.getConfiguration('tasklens').inspect('viewMode')?.defaultValue !== undefined,
	publish: mode => vscode.commands.executeCommand('setContext', 'tasklens.viewMode', mode),
	reportError: message => vscode.window.showErrorMessage(message),
};

export function getTaskViewMode(): TaskViewMode {
	return vscode.workspace.getConfiguration('tasklens').get<string>('viewMode') === 'list' ? 'list' : 'tree';
}

export class TaskViewModeStore implements vscode.Disposable {
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChange = this.emitter.event;
	private readonly configurationSub: vscode.Disposable;
	private readonly services: ViewModeServices;
	private fallback: TaskViewMode | undefined;
	private configuredMode: TaskViewMode;
	private saving = false;

	constructor(private readonly state: vscode.Memento, overrides: Partial<ViewModeServices> = {}) {
		this.services = { ...services, ...overrides };
		this.configuredMode = this.services.read();
		const stored = state.get<string>(FALLBACK_KEY);
		this.fallback = stored === 'tree' || stored === 'list' ? stored : undefined;
		this.configurationSub = vscode.workspace.onDidChangeConfiguration(event => {
			if (!this.saving && event.affectsConfiguration('tasklens.viewMode')) {
				void this.acceptConfiguration();
			}
		});
		void this.publish();
	}

	get mode(): TaskViewMode { return this.fallback ?? this.services.read(); }

	async set(mode: TaskViewMode): Promise<void> {
		if (!vscode.workspace.workspaceFolders?.length && !vscode.workspace.workspaceFile) {
			await vscode.window.showInformationMessage('Open a folder or workspace to choose its task view.');
			return;
		}
		this.saving = true;
		try {
			try {
				await this.services.save(mode);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				// An updated extension can run before the window registers its new setting.
				if (this.services.isRegistered()
					&& !(message.includes('tasklens.viewMode') && message.includes('not a registered configuration'))) {
					throw error;
				}
				await this.state.update(FALLBACK_KEY, mode);
				this.fallback = mode;
				await this.publish();
				return;
			}
			if (this.fallback !== undefined) { await this.state.update(FALLBACK_KEY, undefined); }
			this.fallback = undefined;
			this.configuredMode = this.services.read();
			await this.publish();
		} catch (error) {
			await this.services.reportError(`Could not save the workspace task view: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			this.saving = false;
		}
	}

	private async acceptConfiguration(): Promise<void> {
		const configuredMode = this.services.read();
		if (configuredMode === this.configuredMode) { return; }
		try {
			if (this.fallback !== undefined) { await this.state.update(FALLBACK_KEY, undefined); }
			this.fallback = undefined;
			this.configuredMode = configuredMode;
			await this.publish();
		} catch (error) {
			await this.services.reportError(`Could not update the workspace task view: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async publish(): Promise<void> {
		await this.services.publish(this.mode);
		this.emitter.fire();
	}

	dispose(): void { this.configurationSub.dispose(); this.emitter.dispose(); }
}
