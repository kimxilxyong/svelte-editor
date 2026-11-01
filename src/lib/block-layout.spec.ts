import { describe, expect, it } from 'vitest';
import { resolveBlockLayout, type LayoutBlock } from './block-layout.js';

const block = (id: string, alignTo: LayoutBlock['alignTo'], width = 100, height = 60) => ({
	id,
	alignTo,
	x: 17,
	y: 23,
	width,
	height
});

describe('resolveBlockLayout', () => {
	it('leaves None blocks at their stored coordinates', () => {
		expect(resolveBlockLayout([block('free', 'none')], 800, 600).get('free')).toEqual({
			x: 17,
			y: 23,
			width: 100,
			height: 60
		});
	});

	it('stacks repeated side alignments from the outer edge in layer order', () => {
		const layout = resolveBlockLayout(
			[block('left-outer', 'left', 100), block('left-inner', 'left', 80)],
			800,
			600
		);
		expect(layout.get('left-outer')).toEqual({ x: 0, y: 0, width: 100, height: 600 });
		expect(layout.get('left-inner')).toEqual({ x: 100, y: 0, width: 80, height: 600 });
	});

	it('consumes different edges sequentially, then fills the remaining rectangle', () => {
		const layout = resolveBlockLayout(
			[
				block('left', 'left', 100),
				block('top', 'top', 100, 50),
				block('right', 'right', 120),
				block('bottom', 'bottom', 100, 40),
				block('fill', 'fill')
			],
			800,
			600
		);
		expect(layout.get('left')).toEqual({ x: 0, y: 0, width: 100, height: 600 });
		expect(layout.get('top')).toEqual({ x: 100, y: 0, width: 700, height: 50 });
		expect(layout.get('right')).toEqual({ x: 680, y: 50, width: 120, height: 550 });
		expect(layout.get('bottom')).toEqual({ x: 100, y: 560, width: 580, height: 40 });
		expect(layout.get('fill')).toEqual({ x: 100, y: 50, width: 580, height: 510 });
	});

	it('clips oversized strips to the remaining canvas', () => {
		const layout = resolveBlockLayout(
			[block('left', 'left', 500), block('right', 'right', 500), block('fill', 'fill')],
			800,
			600
		);
		expect(layout.get('left')?.width).toBe(500);
		expect(layout.get('right')?.width).toBe(300);
		expect(layout.get('fill')).toEqual({ x: 500, y: 0, width: 0, height: 600 });
	});

	it('throws when more than one block requests Fill', () => {
		expect(() =>
			resolveBlockLayout([block('fill-a', 'fill'), block('fill-b', 'fill')], 800, 600)
		).toThrow('Only one block can align to Fill on a canvas.');
	});
});
