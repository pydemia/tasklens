import * as assert from 'assert';
import { analyzeSeparator, suggestSeparators, type TaskLabel } from '../grouping/suggest';
import { validateSeparator } from '../grouping/picker';
import { buildTree } from '../tree/group';

function labels(names: string[], scope = 'workspace'): TaskLabel[] {
	return names.map(name => ({ name, scope }));
}

suite('Workspace grouping suggestions', () => {
	test('recommends repeated punctuation with a real tree example', () => {
		const suggestions = suggestSeparators(labels(['build:web', 'build:api', 'test']));
		assert.strictEqual(suggestions[0].separator, ':');
		assert.strictEqual(suggestions[0].affectedTasks, 2);
		assert.deepStrictEqual(suggestions[0].example, { name: 'build:api', path: ['build', 'api'] });
	});

	test('prefers the complete delimiter and removes equivalent suggestions', () => {
		const suggestions = suggestSeparators(labels(['app::build', 'app::test']));
		assert.strictEqual(suggestions[0].separator, '::');
		assert.ok(!suggestions.some(suggestion => suggestion.separator === ':'));
	});

	test('ranks useful shared groups ahead of isolated split names', () => {
		const suggestions = suggestSeparators(labels(['app:build-dev', 'app:test-api', 'app:lint-web']));
		assert.strictEqual(suggestions[0].separator, ':');
		assert.ok(!suggestions.some(suggestion => suggestion.separator === '-'));
	});

	test('does not invent a separator for plain names or a single task', () => {
		assert.deepStrictEqual(suggestSeparators(labels(['build', 'test', 'lint'])), []);
		assert.deepStrictEqual(suggestSeparators(labels(['app::build'])), []);
	});

	test('finds custom punctuation and keeps Unicode task names intact', () => {
		const suggestions = suggestSeparators(labels(['서비스@@빌드', '서비스@@테스트']));
		assert.strictEqual(suggestions[0].separator, '@@');
		assert.deepStrictEqual(suggestions[0].example?.path, ['서비스', '빌드']);
	});

	test('does not infer shared groups across separate folders or views', () => {
		const suggestions = suggestSeparators([...labels(['app:build'], 'a'), ...labels(['app:test'], 'b')]);
		assert.deepStrictEqual(suggestions, []);
	});

	test('duplicate labels do not inflate evidence for recommendations', () => {
		assert.deepStrictEqual(suggestSeparators(labels(['app:build', 'app:build'])), []);
	});

	test('preserves intentional spaces and previews the same path as the tree', () => {
		const source = labels(['app - build', 'app - test']);
		const analysis = analyzeSeparator(source, ' - ');
		const tree = buildTree(source.map(label => ({ key: label.name, name: label.name, node: { key: label.name } })), ' - ');
		assert.strictEqual(tree[0].label, analysis.example!.path[0]);
		assert.strictEqual(analysis.affectedTasks, 2);
		assert.strictEqual(validateSeparator(' - '), undefined);
	});

	test('supports literal custom strings and reports unmatched separators honestly', () => {
		assert.strictEqual(validateSeparator('then'), undefined);
		assert.strictEqual(analyzeSeparator(labels(['build', 'test']), '@').affectedTasks, 0);
		assert.strictEqual(analyzeSeparator(labels([':::']), ':').affectedTasks, 0);
		assert.ok(validateSeparator(''));
		assert.ok(validateSeparator('\n'));
	});
});
