import { describe, expect, it } from 'vitest';
import { canvasLimits, canvasPresets, defaultCanvasSize, findCanvasPreset } from './editor.js';

describe('canvas presets', () => {
	it('keeps every preset within the validated canvas limits', () => {
		for (const preset of canvasPresets) {
			expect(preset.width).toBeGreaterThanOrEqual(canvasLimits.minWidth);
			expect(preset.width).toBeLessThanOrEqual(canvasLimits.maxWidth);
			expect(preset.height).toBeGreaterThanOrEqual(canvasLimits.minHeight);
			expect(preset.height).toBeLessThanOrEqual(canvasLimits.maxHeight);
		}
	});

	it('has unique sizes and labels', () => {
		const sizes = canvasPresets.map((p) => `${p.width}x${p.height}`);
		expect(new Set(sizes).size).toBe(sizes.length);
		expect(new Set(canvasPresets.map((p) => p.label)).size).toBe(canvasPresets.length);
	});

	it('defaults new pages to Full HD, which is a listed preset', () => {
		expect(defaultCanvasSize).toEqual({ width: 1920, height: 1080 });
		expect(findCanvasPreset(1920, 1080)?.label).toBe('Full HD');
		expect(findCanvasPreset(801, 600)).toBeUndefined();
	});
});
