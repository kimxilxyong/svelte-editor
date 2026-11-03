import { describe, expect, it } from 'vitest';
import { normalizeProjectName, projectLimits, uniqueProjectName } from './projects.js';

describe('project names', () => {
	it('normalises whitespace and rejects empty or oversized names', () => {
		expect(normalizeProjectName('  My   site ')).toBe('My site');
		expect(normalizeProjectName('   ')).toBeNull();
		expect(normalizeProjectName(7)).toBeNull();
		expect(normalizeProjectName('x'.repeat(projectLimits.nameLength + 1))).toBeNull();
	});

	it('finds a free name case-insensitively', () => {
		expect(uniqueProjectName('Site copy', [])).toBe('Site copy');
		expect(uniqueProjectName('Site copy', ['site COPY'])).toBe('Site copy 2');
		expect(uniqueProjectName('Site copy', ['Site copy', 'Site copy 2'])).toBe('Site copy 3');
		expect(uniqueProjectName('x'.repeat(80), ['x'.repeat(80)]).length).toBeLessThanOrEqual(80);
	});
});
