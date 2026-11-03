/**
 * @fileoverview Browser integration coverage for native composite canvas rendering.
 *
 * Exercises the real shared constrained compiler and Svelte client runtime, including script
 * interaction, injected CSS, nested generated defaults, widget overrides and visible failures.
 * Only dependency loading is controllable so stale generations can be resolved deterministically;
 * compilation/evaluation is never replaced. Existing component/editor tests are left untouched.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CompositeHarness from './components/testing/CompositeHarness.svelte';
import { compileComposite, prepareComposite, type RuntimeComposite } from './composite-runtime.js';
import * as runtime from './widget-runtime.svelte.js';
import type { BuilderBlock } from './editor.js';

vi.mock('./widget-runtime.svelte.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./widget-runtime.svelte.js')>();
	return {
		...actual,
		loadDependencies: vi.fn(actual.loadDependencies),
		compileSource: vi.fn(actual.compileSource)
	};
});

/** Actual standard runtime dependencies, loaded once rather than mocked component implementations. */
let dependencies: Record<string, unknown>;
beforeAll(async () => {
	dependencies = await runtime.loadDependencies();
});
beforeEach(() => {
	vi.mocked(runtime.loadDependencies).mockResolvedValue(dependencies);
	vi.mocked(runtime.compileSource).mockClear();
	runtime.widgetRuntime.components = {};
});
afterEach(() => {
	vi.mocked(runtime.loadDependencies).mockReset();
	runtime.widgetRuntime.components = {};
});

/** Minimal definition; explicit undefined is the generated-default contract. */
function composite(name: string, source?: string, blocks: BuilderBlock[] = []): RuntimeComposite {
	return { id: name, name, width: 320, height: 160, blocks, source };
}

/** Standard block geometry/content, usable both as a root reference and generated child. */
function block(kind = 'composite:Root', title = 'Generated heading'): BuilderBlock {
	return {
		id: `${kind}-block`,
		kind: kind as BuilderBlock['kind'],
		title,
		body: '',
		action: '',
		theme: 'light',
		x: 0,
		y: 0,
		width: 320,
		height: 160,
		positioned: true,
		value: '',
		checked: false,
		level: 0,
		href: '',
		newTab: false
	};
}

/** Resolves a plan against a test-owned provider list, mirroring `useComposites`. */
function plan(definitions: RuntimeComposite[], depth = 0) {
	return prepareComposite(
		definitions[0],
		(name) => definitions.find((definition) => definition.name === name),
		depth,
		runtime.widgetRuntime.components
	);
}

describe('native composite dependency constraints', () => {
	it('rejects unknown editor modules and unrelated relative paths', () => {
		for (const path of ['./Unknown.svelte', '$lib/server/private', '../WidgetHeading.svelte']) {
			expect(() =>
				plan([composite('Root', `<script>import X from '${path}';</script><X />`)])
			).toThrow();
		}
	});

	it('rejects unknown packages even when their imports have no used binding', () => {
		expect(() =>
			plan([composite('Root', `<script>import 'not-allowed';</script><p>not rendered</p>`)])
		).toThrow('not-allowed');
	});

	it('rejects dynamic imports in markup and re-exported dependencies', () => {
		expect(() =>
			plan([composite('Root', `<button onclick={() => import('svelte')}>Load</button>`)])
		).toThrow('dynamic imports');
		expect(() =>
			plan([composite('Root', `<script module>export { default } from './Child.svelte';</script>`)])
		).toThrow('re-export');
	});

	it('parses declarations rather than import-like text and ignores type-only imports', async () => {
		const snapshot = plan([
			composite(
				'Root',
				`<script lang="ts">
					import type { Unknown } from './NotRuntime.svelte';
					const text = "import Bad from './Fake.svelte'";
				</script><p>{text}</p>`
			)
		]);
		expect(typeof (await compileComposite(snapshot))).toBe('function');
	});

	it('rejects native cycles and generated self references', () => {
		const root = composite('Root', `<script>import Child from './Child.svelte';</script><Child />`);
		const child = composite('Child', `<script>import Root from './Root.svelte';</script><Root />`);
		expect(() => plan([root, child])).toThrow('Root → Child → Root');
		expect(() => plan([composite('Root', undefined, [block()])])).toThrow('cycle');
	});

	it('rejects excessive depth, including an already nested page instance', () => {
		const definitions = Array.from({ length: 7 }, (_, index) =>
			composite(
				index === 0 ? 'Root' : `Nested${index}`,
				index === 6
					? '<p>Too deep</p>'
					: `<script>import Child from './Nested${index + 1}.svelte';</script><Child />`
			)
		);
		expect(() => plan(definitions)).toThrow('maximum depth 6');
		expect(() => plan([composite('Root', '<p>Root</p>')], 6)).toThrow('maximum depth 6');
	});
});

describe('BlockContent native composite surfaces', () => {
	it('renders native markup, interactive script and native CSS', async () => {
		const root = composite(
			'Root',
			`<script>let count = $state(0);</script>
			<button data-native onclick={() => count++}>{count}</button>
			<style>button { color: rgb(12, 34, 56); }</style>`
		);
		const { container } = render(CompositeHarness, { block: block(), composites: [root] });
		await expect.poll(() => container.querySelector('[data-native]')?.textContent).toBe('0');
		const button = container.querySelector('[data-native]') as HTMLButtonElement;
		expect(getComputedStyle(button).color).toBe('rgb(12, 34, 56)');
		button.click();
		await expect.poll(() => button.textContent).toBe('1');
	});

	it('renders all supported import aliases, generated nested defaults and edited widgets', async () => {
		runtime.widgetRuntime.components = {
			WidgetHeading: runtime.compileSource(
				'WidgetHeading',
				`<script>let {title} = $props();</script><strong data-widget>{title}</strong>`,
				dependencies
			)
		};
		for (const base of ['$lib/components/editor/', '#lib/components/editor/', './']) {
			const root = composite(
				'Root',
				`<script>import Child from '${base}Child.svelte';</script><Child />`
			);
			const child = composite('Child', undefined, [block('widget-heading')]);
			const { container } = render(CompositeHarness, {
				block: block(),
				composites: [root, child]
			});
			await expect
				.poll(() => container.querySelector('[data-widget]')?.textContent)
				.toBe('Generated heading');
			expect(container.querySelector('[data-editor-composite="Child"]')).not.toBeNull();
		}
	});

	it('keeps invalid active source visible instead of rendering fallback blocks', async () => {
		const root = composite('Root', '<p>{</p>', [block('widget-heading', 'Must not fallback')]);
		const { container, rerender } = render(CompositeHarness, {
			block: block(),
			composites: [root]
		});
		await expect.poll(() => container.querySelector('[role="alert"]')).not.toBeNull();
		expect(container.textContent).not.toContain('Must not fallback');
		await rerender({ composites: [composite('Root', '<p>Recovered</p>')] });
		await expect.poll(() => container.textContent).toContain('Recovered');
		expect(container.querySelector('[role="alert"]')).toBeNull();
	});

	it('catches render failures and resets the boundary for a repaired source', async () => {
		const root = composite(
			'Root',
			`<script>function explode() { throw new Error('Render exploded'); }</script><p>{explode()}</p>`
		);
		const { container, rerender } = render(CompositeHarness, {
			block: block(),
			composites: [root]
		});
		await expect
			.poll(() => container.querySelector('[role="alert"]')?.textContent)
			.toContain('Render exploded');
		await rerender({ composites: [composite('Root', '<p>Render repaired</p>')] });
		await expect.poll(() => container.textContent).toContain('Render repaired');
	});

	it('treats an empty override as active, not as a request for generated defaults', async () => {
		const { container } = render(CompositeHarness, {
			block: block(),
			composites: [composite('Root', '', [block('widget-heading', 'Must not fallback')])]
		});
		await expect.poll(() => container.querySelector('[role="status"]')).toBeNull();
		expect(container.textContent).not.toContain('Must not fallback');
	});

	it('recompiles when nested generated definitions or widget overrides change', async () => {
		const root = composite('Root', `<script>import Child from './Child.svelte';</script><Child />`);
		const child = composite('Child', undefined, [block('widget-heading', 'Before')]);
		const { container, rerender } = render(CompositeHarness, {
			block: block(),
			composites: [root, child]
		});
		await expect.poll(() => container.textContent).toContain('Before');
		await rerender({
			composites: [root, composite('Child', undefined, [block('widget-heading', 'After')])]
		});
		await expect.poll(() => container.textContent).toContain('After');
		runtime.widgetRuntime.components = {
			WidgetHeading: runtime.compileSource('WidgetHeading', '<p>Edited widget</p>', dependencies)
		};
		await expect.poll(() => container.textContent).toContain('Edited widget');
	});

	it('discards stale source/project/dependency generations', async () => {
		let release!: (value: Record<string, unknown>) => void;
		const pending = new Promise<Record<string, unknown>>((resolve) => {
			release = resolve;
		});
		vi.mocked(runtime.loadDependencies).mockReturnValueOnce(pending);
		const root = composite('Root', `<script>import Child from './Child.svelte';</script><Child />`);
		const { container, rerender } = render(CompositeHarness, {
			block: block(),
			composites: [root, composite('Child', '<p>Obsolete project</p>')]
		});
		await expect.poll(() => container.querySelector('[role="status"]')).not.toBeNull();
		await rerender({
			composites: [composite('Root', '<p>Current project</p>')]
		});
		await expect.poll(() => container.textContent).toContain('Current project');
		release(dependencies);
		await pending;
		// Allow the obsolete compilation and await continuation to finish before asserting.
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(container.textContent).toContain('Current project');
		expect(container.textContent).not.toContain('Obsolete project');
		expect(runtime.compileSource).toHaveBeenCalledTimes(1);
	});

	it('does not share composite definitions across separate context providers', async () => {
		const source = `<script>import Child from './Child.svelte';</script><Child />`;
		const first = render(CompositeHarness, {
			block: block(),
			composites: [composite('Root', source), composite('Child', '<p>First project</p>')]
		});
		const second = render(CompositeHarness, {
			block: block(),
			composites: [composite('Root', source), composite('Child', '<p>Second project</p>')]
		});
		await expect.poll(() => first.container.textContent).toContain('First project');
		await expect.poll(() => second.container.textContent).toContain('Second project');
		expect(first.container.textContent).not.toContain('Second project');
	});
});
