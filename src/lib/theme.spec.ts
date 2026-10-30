/**
 * @fileoverview Tests for the site theme model and its persistence.
 */

import { describe, expect, it } from 'vitest';
import {
	defaultSiteTheme,
	normalizeSiteTheme,
	parseSiteTheme,
	primaryScale,
	themeClasses,
	themeConfig,
	themeStyle
} from './theme.js';
import { getSiteTheme, saveSiteTheme } from './server/theme.js';
import { ensureSchema } from './server/database/schema.js';
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

describe('site theme persistence', () => {
	it('falls back to the default and round-trips a saved theme', async () => {
		const db = openSqliteClient(':memory:');
		await ensureSchema(db);
		expect(await getSiteTheme(db)).toEqual(defaultSiteTheme);
		const next = { ...defaultSiteTheme, primary: '#112233', dark: true };
		await saveSiteTheme(db, next);
		expect(await getSiteTheme(db)).toEqual(next);
		await db.close?.();
	});
});
