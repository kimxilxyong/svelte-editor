import { describe, expect, it } from 'vitest';
import { blockLimits, parseBuilderBlocks } from './editor.js';

const base = {
	id: 'a',
	kind: 'widget-button',
	title: 'Button',
	body: '',
	action: 'Go',
	theme: 'light',
	positioned: true,
	x: 400,
	y: 20,
	width: 120,
	height: 36
};

describe('parseBuilderBlocks pixel geometry', () => {
	it('accepts pixel x/width beyond 100', () => {
		const [block] = parseBuilderBlocks([base]) ?? [];
		expect(block).toMatchObject({ x: 400, width: 120, height: 36 });
	});

	it('defaults to compact pixel geometry', () => {
		const rest: Record<string, unknown> = { ...base };
		delete rest.x;
		delete rest.width;
		delete rest.height;
		const [block] = parseBuilderBlocks([rest]) ?? [];
		expect(block).toMatchObject({ x: 24, width: 240, height: 40 });
	});

	it('rejects values outside the pixel limits', () => {
		expect(parseBuilderBlocks([{ ...base, width: blockLimits.minWidth - 1 }])).toBeNull();
		expect(parseBuilderBlocks([{ ...base, width: blockLimits.maxWidth + 1 }])).toBeNull();
		expect(parseBuilderBlocks([{ ...base, height: blockLimits.maxHeight + 1 }])).toBeNull();
		expect(parseBuilderBlocks([{ ...base, x: -1 }])).toBeNull();
	});
});
