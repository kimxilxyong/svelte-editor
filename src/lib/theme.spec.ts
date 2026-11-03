/**
 * @fileoverview Tests for the site theme model and its per-project persistence.
 */

import { describe, expect, it } from 'vitest';
import {
	contrastRatio,
	defaultSiteTheme,
	normalizeSiteTheme,
	parseSiteTheme,
	primaryScale,
	siteBackground,
	siteForeground,
	themeClasses,
	themeConfig,
	themeStyle
} from './theme.js';
import { ensureSchema } from './server/database/schema.js';
import { createProject, getProject, updateProject } from './server/project-store.js';
import { openSqliteClient } from './server/database/sqlite-client.js';

describe('site theme model', () => {
	it('accepts a valid theme and lower-cases the colour', () => {
		const theme = parseSiteTheme({ ...defaultSiteTheme, primary: '#AABBCC' });
		expect(theme?.primary).toBe('#aabbcc');
	});

	it('rejects invalid colours, radii, fonts and non-objects', () => {
		expect(parseSiteTheme({ ...defaultSiteTheme, primary: 'red' })).toBeNull();
		expect(parseSiteTheme({ ...defaultSiteTheme, radius: 'huge' })).toBeNull();
		expect(parseSiteTheme({ ...defaultSiteTheme, font: 'comic' })).toBeNull();
		expect(parseSiteTheme(null)).toBeNull();
		expect(normalizeSiteTheme('x')).toEqual(defaultSiteTheme);
	});

	it('builds a 50..900 scale around the base colour', () => {
		const scale = primaryScale('#7766df');
		expect(scale[500]).toBe('#7766df');
		expect(Object.keys(scale)).toHaveLength(10);
		expect(scale[50]).not.toBe(scale[900]);
	});

	it('produces style, classes and config', () => {
		const dark = {
			...defaultSiteTheme,
			dark: true,
			font: 'serif' as const,
			radius: 'none' as const
		};
		expect(themeStyle(dark)).toContain('--color-primary-500');
		expect(themeStyle(dark)).toContain('--site-bg: #111827');
		expect(themeClasses(dark)).toBe('dark font-serif');
		expect(JSON.stringify(themeConfig(dark))).toContain('rounded-none');
	});
});

describe('project theme persistence', () => {
	it('starts with the default and round-trips a saved theme', async () => {
		const db = openSqliteClient(':memory:');
		await ensureSchema(db);
		await db.run(
			`INSERT INTO users (id, name, role, created_at, updated_at) VALUES ('u1', 'U', 'user', 'x', 'x')`
		);
		const project = await createProject(db, 'u1', { name: 'Site' });
		expect(project.theme).toEqual(defaultSiteTheme);
		const next = { ...defaultSiteTheme, primary: '#112233', dark: true };
		await updateProject(db, project.id, { theme: next });
		expect((await getProject(db, project.id))?.theme).toEqual(next);
		await db.close?.();
	});
});

describe('theme background', () => {
	it('is automatic by default and follows dark mode', () => {
		expect(defaultSiteTheme.background).toBe('');
		expect(siteBackground(defaultSiteTheme)).toBe('#ffffff');
		expect(siteBackground({ ...defaultSiteTheme, dark: true })).toBe('#111827');
		expect(siteForeground({ ...defaultSiteTheme, dark: true })).toBe('#f3f4f6');
		expect(siteForeground({ ...defaultSiteTheme, foreground: '#123456' })).toBe('#123456');
	});
	it('uses a custom background and a readable foreground', () => {
		const dark = { ...defaultSiteTheme, background: '#101010' };
		expect(siteBackground(dark)).toBe('#101010');
		expect(siteForeground(dark)).toBe('#f3f4f6');
		expect(siteForeground({ ...defaultSiteTheme, background: '#ffee99' })).toBe('#1f2937');
		expect(themeStyle(dark)).toContain('--site-bg: #101010');
	});
	it('validates the colour', () => {
		expect(parseSiteTheme({ ...defaultSiteTheme, background: '#ABCDEF' })?.background).toBe(
			'#abcdef'
		);
		expect(parseSiteTheme({ ...defaultSiteTheme, background: 'blue' })).toBeNull();
	});
});

describe('extended theme', () => {
	it('completes old-shape themes with defaults', () => {
		const old = { preset: 'violet', primary: '#7766df', radius: 'md', font: 'sans', dark: false };
		expect(parseSiteTheme(old)).toEqual(defaultSiteTheme);
	});
	it('rejects invalid new values', () => {
		expect(parseSiteTheme({ ...defaultSiteTheme, inputStyle: 'x' })).toBeNull();
		expect(parseSiteTheme({ ...defaultSiteTheme, secondary: 'red' })).toBeNull();
	});
	it('emits secondary variables', () => {
		expect(themeStyle(defaultSiteTheme as never)).toContain('--color-secondary-500: #0ea5e9');
	});
	it('computes contrast', () => {
		expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
	});
	it('only emits allow-listed literal classes', () => {
		const ok =
			/^(rounded-\w+|text-\S+|px-\S+|py-\S+|border\S*|bg-\S+|dark:\S+|focus:\S+|shadow-\S+)$/;
		for (const inputStyle of ['outlined', 'filled', 'underlined', 'soft'] as const) {
			const cfg = themeConfig({ ...defaultSiteTheme, inputStyle, preset: 'x' } as never);
			const all = JSON.stringify(cfg).match(/"([^"]*)"/g)!;
			for (const str of all.map((s) => s.slice(1, -1))) {
				if (
					/^(button|badge|input|select|textarea|card|base|wrapper|search|fileupload|phoneInput|datepicker|timepicker|multiSelect|dropzone|tags|tag|floatingLabelInput)$/.test(
						str
					)
				)
					continue;
				for (const c of str.split(' ')) expect(c).toMatch(ok);
			}
		}
	});
});
