/**
 * @fileoverview Tests for the built-in widget override store and the browser-side compiler.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	effectiveWidgetSource,
	listWidgets,
	readOverrides,
	readWidget,
	resetWidget,
	saveWidget
} from './widget-files.js';

let dir: string;

beforeAll(async () => {
	dir = await mkdtemp(path.join(os.tmpdir(), 'widgets-'));
	process.env.WIDGETS_DIR = dir;
});

afterAll(async () => {
	delete process.env.WIDGETS_DIR;
	await rm(dir, { recursive: true, force: true });
});

describe('widget overrides', () => {
	it('lists defaults as unmodified', async () => {
		const widgets = await listWidgets();
		expect(widgets.find((w) => w.name === 'WidgetButton')).toEqual({
			name: 'WidgetButton',
			modified: false
		});
	});

	it('saves, reads, exports and resets an override', async () => {
		const source = '<p>edited</p>';
		expect((await saveWidget('WidgetButton', source)).saved).toBe(true);
		expect(await readFile(path.join(dir, 'WidgetButton.svelte'), 'utf8')).toBe(source);
		expect(await readWidget('WidgetButton')).toBe(source);
		expect(await effectiveWidgetSource('WidgetButton')).toBe(source);
		expect(await readOverrides()).toEqual({ WidgetButton: source });
		await resetWidget('WidgetButton');
		expect(await readOverrides()).toEqual({});
		expect(await readWidget('WidgetButton')).not.toBe(source);
	});

	it('refuses compile errors unless forced', async () => {
		const broken = '<p>{</p>';
		const result = await saveWidget('WidgetBadge', broken);
		expect(result.saved).toBe(false);
		expect(result.diagnostics[0].severity).toBe('error');
		expect((await saveWidget('WidgetBadge', broken, true)).saved).toBe(true);
		await resetWidget('WidgetBadge');
	});

	it('rejects unknown names (no path traversal)', async () => {
		await expect(saveWidget('../evil', 'x')).rejects.toThrow();
		await expect(readWidget('Nope')).rejects.toThrow();
		expect(await effectiveWidgetSource('../../etc/passwd')).toBeUndefined();
	});
});
