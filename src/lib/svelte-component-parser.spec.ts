import { describe, expect, it } from 'vitest';
import { parseSvelteComponent } from './svelte-component-parser.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('parseSvelteComponent', () => {
	it('parses Svelte 5 runes $props() with interface and default values', () => {
		const source = `
<script lang="ts">
  interface Props {
    title: string;
    count?: number;
    enabled?: boolean;
    onchange?: () => void;
  }
  let { title, count = 42, enabled = true, onchange }: Props = $props();
</script>
<div>{title}</div>
`;
		const meta = parseSvelteComponent(source, 'Card.svelte');
		expect(meta.name).toBe('Card');
		expect(meta.fileName).toBe('Card.svelte');
		expect(meta.props).toEqual([
			{ name: 'title', type: 'string', defaultValue: undefined, bindable: false },
			{ name: 'count', type: 'number', defaultValue: 42, bindable: false },
			{ name: 'enabled', type: 'boolean', defaultValue: true, bindable: false }
		]);
	});

	it('parses legacy export let syntax', () => {
		const source = `
<script lang="ts">
  export let label = 'Submit';
  export let disabled = false;
  export let max = 100;
</script>
<button>{label}</button>
`;
		const meta = parseSvelteComponent(source, 'CustomButton.svelte');
		expect(meta.props).toEqual([
			{ name: 'label', type: 'string', defaultValue: 'Submit', bindable: false },
			{ name: 'disabled', type: 'boolean', defaultValue: false, bindable: false },
			{ name: 'max', type: 'number', defaultValue: 100, bindable: false }
		]);
	});

	it('parses built-in editor components', async () => {
		const heroPath = path.resolve('src/lib/components/editor/Hero.svelte');
		const heroSrc = await readFile(heroPath, 'utf8');
		const meta = parseSvelteComponent(heroSrc, 'Hero.svelte');

		expect(meta.name).toBe('Hero');
		expect(meta.props.map((p) => p.name)).toContain('title');
		expect(meta.props.map((p) => p.name)).toContain('body');
	});
});
