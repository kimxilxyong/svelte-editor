import { describe, expect, it } from 'vitest';
import { componentNames, type BlockKind, type EditorPage } from './editor.js';
import {
	generatedMarker,
	parseCompositeSource,
	parsePageSource,
	renderCompositeSource,
	renderPageSource
} from './svelte-pages.js';

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
	it('exports and restores alignment metadata and resolved page geometry', () => {
		const page: EditorPage = {
			id: 'p',
			name: 'Aligned',
			slug: 'aligned',
			width: 800,
			height: 600,
			blocks: [
				block('widget-button', 0, { alignTo: 'left', width: 120 }),
				block('widget-alert', 1, { alignTo: 'top', height: 80 }),
				block('widget-card', 2, { alignTo: 'fill' })
			]
		};

		const source = renderPageSource(page);
		expect(source).toContain('data-align-to="left"');
		expect(source).toContain('data-align-to="top"');
		expect(source).toContain('data-align-to="fill"');
		expect(source).toContain('left: 120px; top: 0px; width: 680px; height: 80px');
		expect(source).toContain('left: 120px; top: 80px; width: 680px; height: 520px');
		const parsed = parsePageSource(source, 'aligned');
		expect(parsed?.blocks.map((item) => item.alignTo)).toEqual(['left', 'top', 'fill']);
		expect(
			parsePageSource(source.replace('data-align-to="left"', ''), 'aligned')?.blocks[0].alignTo
		).toBe('none');
	});

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
					theme: kind === 'widget-card' ? 'dark' : 'light',
					checked: kind === 'widget-switch',
					level: kind === 'widget-slider' ? 33 : 60,
					value: kind === 'widget-text-field' ? 'hello' : '',
					href: ['widget-link', 'widget-button', 'widget-card'].includes(kind) ? '/home#top' : '',
					newTab: ['widget-link', 'widget-button', 'widget-card'].includes(kind),
					items: kind === 'widget-select' ? 'A\nB' : undefined
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
		expect(byKind['widget-card'].action).toBe('Go');
		expect(byKind['widget-switch'].checked).toBe(true);
		expect(byKind['widget-slider'].level).toBe(33);
		expect(byKind['widget-text-field'].value).toBe('hello');
		expect(byKind['widget-select'].items).toBe('A\nB');
		expect(byKind['widget-link']).toMatchObject({
			href: '/home#top',
			newTab: true,
			title: 'Title'
		});
		for (const kind of ['widget-button', 'widget-card']) {
			expect(byKind[kind], kind).toMatchObject({ href: '/home#top', newTab: true });
		}
	});

	it('exports and re-imports button and card link settings in pages and composites', () => {
		const blocks = [
			block('widget-button', 0, { href: 'https://example.com/x?a=1&b=2', newTab: true }),
			block('widget-card', 1, { href: '/about', newTab: false })
		];
		const page: EditorPage = {
			id: 'p',
			name: 'Links',
			slug: 'links',
			width: 800,
			height: 600,
			blocks
		};
		const pageSource = renderPageSource(page);
		expect(pageSource).toContain('href="https://example.com/x?a=1&amp;b=2"');
		expect(pageSource).toContain('newTab={true}');
		const parsedPage = parsePageSource(pageSource, 'links');
		expect(parsedPage?.blocks.map((item) => [item.href, item.newTab])).toEqual([
			['https://example.com/x?a=1&b=2', true],
			['/about', false]
		]);

		const compositeSource = renderCompositeSource({
			id: 'c',
			name: 'Cta',
			width: 400,
			height: 300,
			blocks
		});
		expect(compositeSource).toContain('<WidgetButton');
		const reparsed = parseCompositeSource(compositeSource);
		expect(reparsed?.blocks.map((item) => [item.href, item.newTab])).toEqual([
			['https://example.com/x?a=1&b=2', true],
			['/about', false]
		]);
	});

	it('round-trips alignment metadata and resolved geometry in composite source', () => {
		const composite = {
			id: 'c',
			name: 'Docked',
			width: 800,
			height: 600,
			blocks: [
				block('widget-button', 0, { alignTo: 'right', width: 120 }),
				block('widget-alert', 1, { alignTo: 'fill' })
			]
		};
		const source = renderCompositeSource(composite);
		expect(source).toContain('data-align-to="right"');
		expect(source).toContain('data-align-to="fill"');
		expect(source).toContain('left: 85%; top: 0%; width: 15%; height: 100%');
		expect(source).toContain('left: 0%; top: 0%; width: 85%; height: 100%');
		const parsed = parseCompositeSource(source);
		expect(parsed?.blocks.map((item) => item.alignTo)).toEqual(['right', 'fill']);
	});

	it('drops pages whose imported button link is unsafe', () => {
		const source = renderPageSource({
			id: 'p',
			name: 'Bad',
			slug: 'bad',
			width: 800,
			height: 600,
			blocks: [block('widget-button', 0)]
		}).replace('href=""', 'href="javascript:alert(1)"');
		expect(parsePageSource(source, 'bad')).toBeNull();
	});

	it('escapes quotes, braces and markup', () => {
		const nasty = 'a "quoted" {brace} <b>tag</b> & more';
		const page: EditorPage = {
			id: 'p',
			name: nasty.slice(0, 40),
			slug: 'nasty',
			width: 800,
			height: 600,
			blocks: [block('widget-card', 0, { title: nasty, body: '{@html alert(1)}' })]
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
