import { describe, expect, it } from 'vitest';
import { componentNames, type BlockKind, type EditorPage } from './editor.js';
import { generatedMarker, parsePageSource, renderPageSource } from './svelte-pages.js';

function block(kind: BlockKind, index: number, overrides: Record<string, unknown> = {}) {
	return {
		id: `b${index}`,
		kind,
		title: 'Title',
		body: 'Body',
		action: 'Go',
		theme: 'light' as const,
		positioned: true,
		x: 5,
		y: 40 + index * 10,
		width: 50,
		height: 120,
		value: '',
		checked: false,
		level: 60,
		href: '',
		newTab: false,
		...overrides
	};
}

describe('svelte page export/import', () => {
	it('round-trips every block kind', () => {
		const kinds = Object.keys(componentNames) as BlockKind[];
		const page: EditorPage = {
			id: 'p',
			name: 'About us',
			slug: 'about',
			width: 900,
			height: 700,
			blocks: kinds.map((kind, index) =>
				block(kind, index, {
					theme: kind === 'hero' ? 'dark' : 'light',
					checked: kind === 'widget-switch',
					level: kind === 'widget-slider' ? 33 : 60,
					value: kind === 'widget-text-field' ? 'hello' : '',
					href: kind === 'widget-link' ? '/home#top' : '',
					newTab: kind === 'widget-link'
				})
			)
		};

		const source = renderPageSource(page);
		expect(source.startsWith(generatedMarker)).toBe(true);

		const parsed = parsePageSource(source, 'about');
		expect(parsed).not.toBeNull();
		expect(parsed!.name).toBe(page.name);
		expect(parsed!.width).toBe(900);
		expect(
			parsed!.blocks.map((item) => [item.kind, item.x, item.y, item.width, item.height])
		).toEqual(page.blocks.map((item) => [item.kind, item.x, item.y, item.width, item.height]));
		const byKind = Object.fromEntries(parsed!.blocks.map((item) => [item.kind, item]));
		expect(byKind.hero.theme).toBe('dark');
		expect(byKind.hero.action).toBe('Go');
		expect(byKind['widget-switch'].checked).toBe(true);
		expect(byKind['widget-slider'].level).toBe(33);
		expect(byKind['widget-text-field'].value).toBe('hello');
		expect(byKind['widget-link']).toMatchObject({
			href: '/home#top',
			newTab: true,
			title: 'Title'
		});
	});

	it('escapes quotes, braces and markup', () => {
		const nasty = 'a "quoted" {brace} <b>tag</b> & more';
		const page: EditorPage = {
			id: 'p',
			name: nasty.slice(0, 40),
			slug: 'nasty',
			width: 800,
			height: 600,
			blocks: [block('quote', 0, { title: nasty, body: '{@html alert(1)}' })]
		};
		const source = renderPageSource(page);
		expect(source).not.toContain('{@html');
		const parsed = parsePageSource(source, 'nasty');
		expect(parsed?.blocks[0].title).toBe(nasty);
		expect(parsed?.blocks[0].body).toBe('{@html alert(1)}');
		expect(parsed?.name).toBe(page.name);
	});

	it('handles custom components with customProps', () => {
		const page: EditorPage = {
			id: 'custom-p',
			name: 'Custom Page',
			slug: 'custom',
			width: 1000,
			height: 800,
			blocks: [
				{
					id: 'c1',
					kind: 'custom:NewsletterSignup',
					title: 'Stay in touch',
					body: 'Weekly updates',
					action: 'Subscribe',
					theme: 'light',
					positioned: true,
					x: 10,
					y: 50,
					width: 80,
					height: 200,
					value: '',
					checked: false,
					level: 0,
					href: '',
					newTab: false,
					customProps: {
						ctaText: 'Join Now',
						showConsent: true,
						limit: 5
					}
				}
			]
		};

		const source = renderPageSource(page);
		expect(source).toContain(
			"import NewsletterSignup from '$lib/components/editor/NewsletterSignup.svelte';"
		);
		expect(source).toContain('ctaText="Join Now"');
		expect(source).toContain('showConsent={true}');
		expect(source).toContain('limit={5}');

		const parsed = parsePageSource(source, 'custom');
		expect(parsed).not.toBeNull();
		expect(parsed!.blocks[0].kind).toBe('custom:NewsletterSignup');
		expect(parsed!.blocks[0].title).toBe('Stay in touch');
		expect(parsed!.blocks[0].customProps).toEqual({
			ctaText: 'Join Now',
			showConsent: true,
			limit: 5
		});
	});

	it('ignores ordinary svelte files', () => {
		expect(parsePageSource('<h1>Hello</h1>', 'hello')).toBeNull();
		expect(parsePageSource('<div', 'broken')).toBeNull();
	});
});
