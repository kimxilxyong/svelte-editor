/**
 * @fileoverview Tests for {@link postAuthTarget}.
 */

import { describe, expect, it } from 'vitest';
import { postAuthTarget } from './redirects.js';

describe('postAuthTarget', () => {
	it('keeps safe same-site paths including the query string', () => {
		expect(postAuthTarget('/editor?page=home')).toBe('/editor?page=home');
		expect(postAuthTarget('/account')).toBe('/account');
	});

	it('falls back for missing and unsafe values (open redirect)', () => {
		expect(postAuthTarget(null)).toBe('/');
		expect(postAuthTarget('')).toBe('/');
		expect(postAuthTarget('//evil.example')).toBe('/');
		expect(postAuthTarget('https://evil.example/')).toBe('/');
		expect(postAuthTarget('/\\evil.example')).toBe('/');
	});

	it('never targets another anonymous-only page (redirect loop)', () => {
		expect(postAuthTarget('/login')).toBe('/');
		expect(postAuthTarget('/login?next=%2F')).toBe('/');
		expect(postAuthTarget('/register/')).toBe('/');
		expect(postAuthTarget('/setup#x')).toBe('/');
		expect(postAuthTarget('/login', '/account')).toBe('/account');
		// Prefix match must respect path segments.
		expect(postAuthTarget('/login-help')).toBe('/login-help');
	});
});
