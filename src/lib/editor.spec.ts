import { describe, expect, it } from 'vitest';
import { blockColorStyle, blockLimits, isValidLinkHref, parseBuilderBlocks } from './editor.js';

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

	it('defaults old blocks to None and validates alignment with one Fill maximum', () => {
		const parsed = parseBuilderBlocks([base]);
		expect(parsed?.[0].alignTo).toBe('none');
		expect(parseBuilderBlocks([{ ...base, alignTo: 'left' }])?.[0].alignTo).toBe('left');
		expect(parseBuilderBlocks([{ ...base, alignTo: 'diagonal' }])).toBeNull();
		expect(
			parseBuilderBlocks([
				{ ...base, alignTo: 'fill' },
				{ ...base, id: 'b', alignTo: 'fill' }
			])
		).toBeNull();
	});
});

describe('block colours', () => {
	it('accepts #rrggbb, lower-cases it and omits unset colours', () => {
		const parsed = parseBuilderBlocks([{ ...base, foreground: '#AABBCC', background: '' }]);
		expect(parsed?.[0].foreground).toBe('#aabbcc');
		expect(parsed?.[0]).not.toHaveProperty('background');
		expect(parseBuilderBlocks([base])?.[0]).not.toHaveProperty('foreground');
	});
	it('rejects anything but #rrggbb', () => {
		expect(parseBuilderBlocks([{ ...base, foreground: 'red' }])).toBeNull();
		expect(parseBuilderBlocks([{ ...base, background: 'url(x)' }])).toBeNull();
		expect(parseBuilderBlocks([{ ...base, background: 42 }])).toBeNull();
	});
	it('builds the inline style', () => {
		expect(blockColorStyle({})).toBe('');
		expect(blockColorStyle({ foreground: '#ffffff', background: '#112233' })).toBe(
			'color: #ffffff; background-color: #112233'
		);
	});
});

describe('isValidLinkHref', () => {
	it('accepts empty, internal and http(s) targets', () => {
		for (const href of ['', '/home', '/about#team', 'https://example.com/a?b=1', 'http://x.dev']) {
			expect(isValidLinkHref(href), href).toBe(true);
		}
	});

	it('rejects script, data, protocol-relative and overlong targets', () => {
		for (const href of [
			'javascript:alert(1)',
			'data:text/html,x',
			'//evil.example',
			'ftp://example.com',
			'home',
			'https://exa mple.com',
			`/${'a'.repeat(200)}`
		]) {
			expect(isValidLinkHref(href), href).toBe(false);
		}
	});
});
