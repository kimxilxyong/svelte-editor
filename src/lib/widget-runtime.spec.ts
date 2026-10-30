/**
 * @fileoverview Tests for the browser-side widget compiler (`compileWidget`).
 */

import * as svelte from 'svelte';
import { describe, expect, it } from 'vitest';
import { compileWidget, toFunctionBody } from './widget-runtime.svelte.js';

describe('widget runtime', () => {
	it('rewrites imports into dependency lookups', () => {
		const body = toFunctionBody(
			`import 'svelte/internal/disclose-version';\nimport * as $ from 'svelte/internal/client';\nimport { A, B as C } from 'flowbite-svelte';\nexport default function X() {}`,
			['svelte/internal/client', 'flowbite-svelte']
		);
		expect(body).toContain('const $ = __deps["svelte/internal/client"];');
		expect(body).toContain('const { A, B: C } = __deps["flowbite-svelte"];');
		expect(body).toContain('return function X');
		expect(body).not.toContain('import ');
	});

	it('refuses imports outside the dependency table', () => {
		expect(() => toFunctionBody(`import fs from 'node:fs';`, ['svelte'])).toThrow();
		expect(compileWidget('Evil', `<script>import fs from 'node:fs';</script>`, {})).toBeUndefined();
	});

	it('returns undefined for broken sources', () => {
		expect(compileWidget('Broken', '<p>{</p>', {})).toBeUndefined();
	});

	it('compiles a component that renders', async () => {
		// @ts-expect-error svelte ships no typings for its internal client runtime
		const client = await import('svelte/internal/client');
		const Widget = compileWidget(
			'Hello',
			`<script>let { title } = $props();</script><b>{title}</b>`,
			{ 'svelte/internal/client': client, svelte }
		);
		expect(typeof Widget).toBe('function');
	});
});
