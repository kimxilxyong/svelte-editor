import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import BlockContent from './BlockContent.svelte';
import CompositeHarness from './testing/CompositeHarness.svelte';
import { widgetCatalog } from '../widget-catalog.js';
import {
	compositeKind,
	type BuilderBlock,
	type EditorComposite,
	type WidgetKind
} from '../editor.js';

/** Builds a block the way the editor does when a widget is dropped onto the canvas. */
function dropped(kind: WidgetKind): BuilderBlock {
	const { title, body, action, items, level, theme } = widgetCatalog[kind].defaults;
	return {
		id: `block-${kind}`,
		kind,
		title,
		body,
		action,
		theme: theme ?? 'light',
		positioned: true,
		x: 6,
		y: 40,
		width: 88,
		height: 260,
		value: '',
		checked: false,
		level: level ?? 60,
		href: '/home',
		newTab: false,
		...(items ? { items } : {})
	};
}

describe('BlockContent with Flowbite widgets', () => {
	for (const kind of Object.keys(widgetCatalog) as WidgetKind[]) {
		it(`renders ${kind} with catalog defaults`, async () => {
			const { container } = render(BlockContent, { block: dropped(kind) });
			expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
		});
	}
});

describe('BlockContent link navigation', () => {
	const link = (kind: WidgetKind, href: string, newTab = false): BuilderBlock => ({
		...dropped(kind),
		action: 'Go there',
		href,
		newTab
	});

	for (const kind of ['widget-button', 'widget-card'] as const) {
		it(`${kind} renders an anchor for an internal href and reports clicks to onlink only`, async () => {
			const onlink = vi.fn((event: MouseEvent) => event.preventDefault());
			const onchange = vi.fn();
			const { container } = render(BlockContent, {
				block: link(kind, '/about'),
				onlink,
				onchange
			});
			const anchor = container.querySelector('a');
			expect(anchor?.getAttribute('href')).toBe('/about');
			expect(anchor?.textContent).toContain('Go there');
			expect(anchor?.hasAttribute('target')).toBe(false);
			anchor!.click();
			expect(onlink).toHaveBeenCalledOnce();
			expect(onchange).not.toHaveBeenCalled();
		});

		it(`${kind} renders a plain button when href is empty`, async () => {
			const { container } = render(BlockContent, { block: link(kind, '') });
			expect(container.querySelector('a')).toBeNull();
			expect(container.querySelector('button')?.textContent).toContain('Go there');
		});

		it(`${kind} opens external links safely and never links unsafe targets`, async () => {
			const external = render(BlockContent, { block: link(kind, 'https://example.com/x', true) });
			const anchor = external.container.querySelector('a');
			expect(anchor?.getAttribute('href')).toBe('https://example.com/x');
			expect(anchor?.getAttribute('target')).toBe('_blank');
			expect(anchor?.getAttribute('rel')).toContain('noopener');
			expect(anchor?.getAttribute('rel')).toContain('noreferrer');

			for (const href of ['javascript:alert(1)', '//evil.example', 'data:text/html,x']) {
				const unsafe = render(BlockContent, { block: link(kind, href) });
				expect(unsafe.container.querySelector('a'), href).toBeNull();
				expect(unsafe.container.querySelector('button'), href).not.toBeNull();
			}
		});
	}

	it('routes a button nested in a composite to onlink with the child block', async () => {
		const child = { ...link('widget-button', '/contact'), id: 'child-button' };
		const composite: EditorComposite = {
			id: 'c1',
			name: 'Cta',
			width: 400,
			height: 200,
			blocks: [child]
		};
		const host: BuilderBlock = { ...dropped('widget-button'), kind: compositeKind('Cta') };
		const reported: string[] = [];
		const onlink = vi.fn((event: MouseEvent, target: BuilderBlock) => {
			event.preventDefault();
			reported.push(target.id);
		});
		const { container } = render(CompositeHarness, {
			block: host,
			composites: [composite],
			onlink
		});
		const anchor = container.querySelector('[data-composite="Cta"] a');
		expect(anchor?.getAttribute('href')).toBe('/contact');
		(anchor as HTMLAnchorElement).click();
		expect(onlink).toHaveBeenCalledOnce();
		expect(reported).toEqual(['child-button']);
	});
});
