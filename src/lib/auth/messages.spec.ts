/**
 * @fileoverview Tests for the `?error=<code>` message lookup.
 */

import { describe, expect, it } from 'vitest';
import { authErrorMessage, genericAuthError } from './messages.js';

describe('authErrorMessage', () => {
	it('returns null without a code', () => {
		expect(authErrorMessage(null)).toBeNull();
		expect(authErrorMessage(undefined)).toBeNull();
		expect(authErrorMessage('')).toBeNull();
	});

	it('maps known codes to fixed sentences', () => {
		expect(authErrorMessage('oauth_denied')).toMatch(/cancelled/);
		expect(authErrorMessage('oauth_unconfigured')).toMatch(/not configured/);
		expect(authErrorMessage('last_sign_in_method')).toMatch(/last sign-in method/);
	});

	it('never echoes unknown or hostile values', () => {
		expect(authErrorMessage('<b>hi</b>')).toBe(genericAuthError);
		expect(authErrorMessage('constructor')).toBe(genericAuthError);
		expect(authErrorMessage('__proto__')).toBe(genericAuthError);
	});
});
