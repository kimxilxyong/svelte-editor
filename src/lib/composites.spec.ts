/**
 * @fileoverview Tests for Composite Components: validation, cycle
 * detection and the `.svelte` generate/parse round trip.
 */
import { describe, expect, it } from 'vitest';
import {
	compositeKind,
	findCompositeCycle,
	parseComposites,
	type EditorComposite
} from './editor.js';
import { seedComposites } from './composite-seeds.js';
import {
	parseCompositeSource,
	parsePageSource,
	renderCompositeSource,
	renderPageSource
} from './svelte-pages.js';

const rawBlock = (kind: string, id = 'b1') => ({
	id,
	kind,
	title: 't',
	body: 'b',
	action: '',
	theme: 'light',
	positioned: true,
	x: 0,
	y: 0,
	width: 100,
	height: 50,
	value: '',
	checked: false,
	level: 60,
	href: '',
	newTab: false
});

describe('composite validation', () => {
	it('accepts the seeds', () => {
		expect(parseComposites(JSON.parse(JSON.stringify(seedComposites())))).not.toBeNull();
	});

	it('rejects reserved, duplicate and malformed names', () => {
		const [hero] = seedComposites();
		const named = (name: string, id: string) => ({ ...hero, id, name });
		expect(parseComposites([named('WidgetButton', 'x')])).toBeNull();
		expect(parseComposites([named('hero', 'x')])).toBeNull();
		expect(parseComposites([named('Hero', 'x'), named('Hero', 'y')])).toBeNull();
	});

	it('detects direct and indirect cycles', () => {
		const ref = (name: string): EditorComposite['blocks'][number] =>
			({ ...rawBlock(compositeKind(name)) }) as never;
		const a = { name: 'A', blocks: [ref('B')] };
		const b = { name: 'B', blocks: [ref('A')] };
		expect(findCompositeCycle([a, b])).toBeDefined();
		expect(findCompositeCycle([{ name: 'A', blocks: [ref('A')] }])).toBe('A');
		expect(findCompositeCycle([a, { name: 'B', blocks: [] }])).toBeUndefined();
	});
});

describe('composite source round trip', () => {
	it('renders and parses a composite back to the same blocks', () => {
		const hero = seedComposites()[0];
		const parsed = parseCompositeSource(renderCompositeSource(hero));
		expect(parsed?.name).toBe(hero.name);
		expect(parsed?.blocks.map((b) => b.kind)).toEqual(hero.blocks.map((b) => b.kind));
	});

	it('maps composite component tags on a page to composite blocks', () => {
		const page = {
			id: 'p',
			name: 'Home',
			slug: 'home',
			width: 800,
			height: 600,
			blocks: [rawBlock('composite:Hero')]
		} as never;
		const source = renderPageSource(page);
		expect(source).toContain('<Hero');
		const parsed = parsePageSource(source, 'home', new Set(['Hero']));
		expect(parsed?.blocks.map((b) => b.kind)).toEqual(['composite:Hero']);
	});
});
