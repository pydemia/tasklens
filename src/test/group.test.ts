import * as assert from 'assert';
import { buildTree, type GroupableTask } from '../tree/group';

function task(name: string): GroupableTask {
	return {
		key: name,
		name,
		node: { fullLabel: name, key: name },
	};
}

suite('buildTree', () => {
	test('flat label produces a single leaf', () => {
		const tree = buildTree([task('build')], ':');
		assert.strictEqual(tree.length, 1);
		assert.strictEqual(tree[0].kind, 'task');
		assert.strictEqual(tree[0].label, 'build');
	});

	test('splits "npm: watch:tsc" into npm > watch > tsc', () => {
		const tree = buildTree([task('npm: watch:tsc')], ':');
		assert.strictEqual(tree.length, 1);
		assert.strictEqual(tree[0].kind, 'group');
		assert.strictEqual(tree[0].label, 'npm');
		assert.strictEqual(tree[0].children.length, 1);
		assert.strictEqual(tree[0].children[0].label, 'watch');
		const leaf = tree[0].children[0].children[0];
		assert.strictEqual(leaf.kind, 'task');
		assert.strictEqual(leaf.label, 'tsc');
		assert.strictEqual(leaf.fullLabel, 'npm: watch:tsc');
	});

	test('shares group nodes across siblings', () => {
		const tree = buildTree(
			[task('npm: watch:tsc'), task('npm: watch:esbuild')],
			':',
		);
		assert.strictEqual(tree.length, 1);
		assert.strictEqual(tree[0].label, 'npm');
		assert.strictEqual(tree[0].children.length, 1);
		assert.strictEqual(tree[0].children[0].label, 'watch');
		assert.strictEqual(tree[0].children[0].children.length, 2);
		const leafLabels = tree[0].children[0].children
			.map(c => c.label)
			.sort();
		assert.deepStrictEqual(leafLabels, ['esbuild', 'tsc']);
	});

	test('falls back to default separator when empty string given', () => {
		const tree = buildTree([task('a::b')], '');
		assert.strictEqual(tree[0].kind, 'group');
		assert.strictEqual(tree[0].label, 'a');
	});

	test('handles labels that are just separators', () => {
		const tree = buildTree([task(':::')], ':');
		assert.strictEqual(tree.length, 1);
		assert.strictEqual(tree[0].kind, 'task');
		assert.strictEqual(tree[0].label, ':::');
	});
});
