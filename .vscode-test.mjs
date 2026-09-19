import { defineConfig } from '@vscode/test-cli';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const userData = resolve('.vscode-test/tasklens-user-data');
mkdirSync(resolve(userData, 'User'), { recursive: true });
writeFileSync(resolve(userData, 'User/tasks.json'), JSON.stringify({
	version: '2.0.0', tasks: [{ label: 'test::global', type: 'shell', command: 'echo global', problemMatcher: [] }],
}));

export default defineConfig({
	files: 'out/test/**/*.test.js',
	version: '1.118.1',
	workspaceFolder: './src/test/fixtures/workspace',
	launchArgs: ['--disable-extensions', '--disable-workspace-trust', `--user-data-dir=${userData}`],
	mocha: { timeout: 20000 },
});
