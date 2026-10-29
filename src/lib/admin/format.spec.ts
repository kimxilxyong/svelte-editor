import { describe, expect, it } from 'vitest';
import { validatePassword } from '../auth/validation.js';
import { formatTimestamp, generatePassword } from './format.js';

describe('formatTimestamp', () => {
	it('formats in UTC and tolerates bad input', () => {
		expect(formatTimestamp('2026-10-29T12:34:56.789Z')).toBe('2026-10-29 12:34 UTC');
		expect(formatTimestamp(null)).toBe('—');
		expect(formatTimestamp('nope', 'n/a')).toBe('n/a');
	});
});

describe('generatePassword', () => {
	it('has the requested (clamped) length, only safe characters and passes the policy', () => {
		expect(generatePassword()).toHaveLength(20);
		expect(generatePassword(3)).toHaveLength(12);
		expect(generatePassword(1000)).toHaveLength(128);
		const pw = generatePassword(24);
		expect(pw).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/);
		expect(validatePassword(pw, { email: 'a@b.co', name: 'A' })).toBeNull();
		expect(generatePassword()).not.toBe(generatePassword());
	});
});
