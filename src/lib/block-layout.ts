/**
 * @fileoverview Resolves edge-docked and fill-aligned block geometry for editor canvases.
 *
 * A containing page or composite supplies its declared pixel dimensions. `none` blocks retain
 * their stored geometry and may overlap docked blocks. Docked blocks consume the remaining canvas
 * rectangle in block/layer order; the sole `fill` block occupies the final rectangle. This module
 * is intentionally pure and shared by the editor, previews, nested composites and Svelte export.
 */

import type { BuilderBlock } from './editor.js';

/** CSS-pixel geometry resolved for one block within its containing canvas. */
export type BlockGeometry = Pick<BuilderBlock, 'x' | 'y' | 'width' | 'height'>;

/** The block properties needed by the layout resolver. */
export type LayoutBlock = Pick<BuilderBlock, 'id' | 'x' | 'y' | 'width' | 'height'> &
	Partial<Pick<BuilderBlock, 'alignTo'>>;

/**
 * Resolves each block to pixel geometry inside its page or composite canvas.
 *
 * Side-aligned blocks use stored `width` (left/right) or `height` (top/bottom) as strip thickness.
 * The strip is clipped to the remaining rectangle, then subsequent docked blocks use the newly
 * reduced rectangle. A Fill block is resolved after all side strips regardless of its z-order.
 *
 * @param blocks - Blocks in layer order (first block is processed first).
 * @param width - Declared canvas width in CSS pixels.
 * @param height - Declared canvas height in CSS pixels.
 * @returns Resolved geometry indexed by unique block id.
 * @throws {Error} If more than one block requests Fill.
 * @example
 * const [left] = resolveBlockLayout([{ id: 'a', x: 0, y: 0, width: 120, height: 40, alignTo: 'left' }], 800, 600).values();
 * // left is { x: 0, y: 0, width: 120, height: 600 }
 */
export function resolveBlockLayout(
	blocks: readonly LayoutBlock[],
	width: number,
	height: number
): Map<string, BlockGeometry> {
	let left = 0;
	let top = 0;
	let right = width;
	let bottom = height;
	let fill: LayoutBlock | undefined;
	const geometry = new Map<string, BlockGeometry>();

	for (const block of blocks) {
		switch (block.alignTo ?? 'none') {
			case 'none':
				geometry.set(block.id, {
					x: block.x,
					y: block.y,
					width: block.width,
					height: block.height
				});
				break;
			case 'left': {
				const stripWidth = Math.min(block.width, Math.max(0, right - left));
				geometry.set(block.id, {
					x: left,
					y: top,
					width: stripWidth,
					height: Math.max(0, bottom - top)
				});
				left += stripWidth;
				break;
			}
			case 'right': {
				const stripWidth = Math.min(block.width, Math.max(0, right - left));
				right -= stripWidth;
				geometry.set(block.id, {
					x: right,
					y: top,
					width: stripWidth,
					height: Math.max(0, bottom - top)
				});
				break;
			}
			case 'top': {
				const stripHeight = Math.min(block.height, Math.max(0, bottom - top));
				geometry.set(block.id, {
					x: left,
					y: top,
					width: Math.max(0, right - left),
					height: stripHeight
				});
				top += stripHeight;
				break;
			}
			case 'bottom': {
				const stripHeight = Math.min(block.height, Math.max(0, bottom - top));
				bottom -= stripHeight;
				geometry.set(block.id, {
					x: left,
					y: bottom,
					width: Math.max(0, right - left),
					height: stripHeight
				});
				break;
			}
			case 'fill':
				if (fill) throw new Error('Only one block can align to Fill on a canvas.');
				fill = block;
				break;
		}
	}

	if (fill) {
		geometry.set(fill.id, {
			x: left,
			y: top,
			width: Math.max(0, right - left),
			height: Math.max(0, bottom - top)
		});
	}

	return geometry;
}
