import * as assert from 'assert';
import { locateTaskInJsonc } from '../jsonc/locate';

const SAMPLE = `{
	// JSONC comment
	"version": "2.0.0",
	"tasks": [
		{
			"label": "watch",
			"dependsOn": ["a", "b"],
		},
		{
			"type": "npm",
			"label": "npm: watch:tsc",
			"script": "watch:tsc",
		},
	],
}
`;

suite('locateTaskInJsonc', () => {
	test('returns range of the matching task object', () => {
		const range = locateTaskInJsonc(SAMPLE, 'npm: watch:tsc');
		assert.ok(range, 'expected a range');
		const slice = SAMPLE.slice(range.offset, range.offset + range.length);
		assert.ok(slice.startsWith('{'), `expected object, got: ${slice.slice(0, 20)}`);
		assert.ok(
			slice.includes('"npm: watch:tsc"'),
			'sliced range should contain the label',
		);
	});

	test('returns null for unknown label', () => {
		const range = locateTaskInJsonc(SAMPLE, 'no-such-task');
		assert.strictEqual(range, null);
	});

	test('returns null for non-tasks JSON', () => {
		const range = locateTaskInJsonc('{"foo": "bar"}', 'anything');
		assert.strictEqual(range, null);
	});

	test('tolerates JSONC comments and trailing commas', () => {
		const range = locateTaskInJsonc(SAMPLE, 'watch');
		assert.ok(range);
	});
});
