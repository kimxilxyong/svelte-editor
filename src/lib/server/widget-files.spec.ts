/**
 * @fileoverview Tests for the built-in widget override store and the browser-side compiler.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	effectiveWidgetSource,
	projectWidgetsDirectory,
	removeProjectWidgets,
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

describe('per-project widget overrides', () => {
	const projectA = 'aaaaaaaa-0000-4000-8000-000000000001';
	const projectB = 'bbbbbbbb-0000-4000-8000-000000000002';

	it('keeps edits of one project away from the others', async () => {
		await saveWidget('WidgetButton', '<p>a</p>', false, projectA);
		expect(await readFile(path.join(dir, projectA, 'WidgetButton.svelte'), 'utf8')).toBe(
			'<p>a</p>'
		);
		expect(await readOverrides(projectA)).toEqual({ WidgetButton: '<p>a</p>' });
		expect(await readOverrides(projectB)).toEqual({});
		expect(await readOverrides()).toEqual({});
		expect(await effectiveWidgetSource('WidgetButton', projectB)).not.toBe('<p>a</p>');
		expect((await listWidgets(projectA)).find((w) => w.name === 'WidgetButton')?.modified).toBe(
			true
		);
		expect((await listWidgets(projectB)).find((w) => w.name === 'WidgetButton')?.modified).toBe(
			false
		);
		await removeProjectWidgets(projectA);
		expect(await readOverrides(projectA)).toEqual({});
	});

	it('falls back to the shared legacy file, which is never overwritten', async () => {
		await saveWidget('WidgetBadge', '<p>legacy</p>');
		expect(await readWidget('WidgetBadge', projectA)).toBe('<p>legacy</p>');
		expect(await readOverrides(projectA)).toEqual({ WidgetBadge: '<p>legacy</p>' });
		await saveWidget('WidgetBadge', '<p>mine</p>', false, projectA);
		expect(await readWidget('WidgetBadge', projectA)).toBe('<p>mine</p>');
		expect(await readWidget('WidgetBadge', projectB)).toBe('<p>legacy</p>');
		expect(await readFile(path.join(dir, 'WidgetBadge.svelte'), 'utf8')).toBe('<p>legacy</p>');
		await resetWidget('WidgetBadge', projectA);
		expect(await readWidget('WidgetBadge', projectA)).toBe('<p>legacy</p>');
		await resetWidget('WidgetBadge');
		await removeProjectWidgets(projectA);
	});

	it('refuses project ids that could leave the widgets folder', async () => {
		expect(() => projectWidgetsDirectory('../evil')).toThrow();
		expect(() => projectWidgetsDirectory('a/b')).toThrow();
		await expect(saveWidget('WidgetButton', 'x', false, '..')).rejects.toThrow();
		await expect(removeProjectWidgets('../..')).rejects.toThrow();
	});
});
