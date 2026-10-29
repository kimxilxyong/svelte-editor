import { describe, expect, it } from 'vitest';
import {
	isWalletAddress,
	normalizeEmail,
	shortAddress,
	validateName,
	validatePassword
} from './validation.js';

describe('normalizeEmail', () => {
	it('trims and lower-cases', () => {
		expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com');
	});

	it.each(['', 'nope', 'a@b', 'a b@c.de', '@c.de', 'a@@c.de', 'a@c..de', 'a@.de'])(
		'rejects %j',
		(value) => {
			expect(normalizeEmail(value)).toBeNull();
		}
	);

	it('rejects non-strings and over-long values', () => {
		expect(normalizeEmail(undefined)).toBeNull();
		expect(normalizeEmail(42)).toBeNull();
		expect(normalizeEmail(`${'a'.repeat(250)}@x.io`)).toBeNull();
	});
});

describe('validatePassword', () => {
	it('accepts a long passphrase without composition rules', () => {
		expect(validatePassword('correct horse battery')).toBeNull();
		expect(validatePassword('alllowercaseletters')).toBeNull();
	});

	it('enforces length bounds', () => {
		expect(validatePassword('short')).toMatch(/at least 10/);
		expect(validatePassword('x'.repeat(129))).toMatch(/at most 128/);
		expect(validatePassword('x'.repeat(128))).toBeNull();
	});

	it('rejects non-strings', () => {
		expect(validatePassword(undefined)).toBe('Password is required.');
	});

	it('rejects the email, its local part and the name', () => {
		const ctx = { email: 'ada.lovelace@example.com', name: 'Ada Lovelace' };
		expect(validatePassword('ADA.LOVELACE@example.com', ctx)).toMatch(/email/);
		expect(validatePassword('ada.lovelace', ctx)).toMatch(/email/);
		expect(validatePassword('ada lovelace', ctx)).toMatch(/name/);
	});

	it('rejects common passwords case-insensitively', () => {
		expect(validatePassword('Password123')).toMatch(/too common/);
		expect(validatePassword('1234567890')).toMatch(/too common/);
	});
});

describe('validateName', () => {
	it('trims and collapses whitespace', () => {
		expect(validateName('  Ada   Lovelace ')).toBe('Ada Lovelace');
	});

	it('rejects empty, too long, control-character and non-string names', () => {
		expect(validateName('   ')).toBeNull();
		expect(validateName('x'.repeat(81))).toBeNull();
		expect(validateName('x'.repeat(80))).toBe('x'.repeat(80));
		expect(validateName('bad\nname')).toBeNull();
		expect(validateName(null)).toBeNull();
	});
});

describe('wallet helpers', () => {
	const address = '0xAbCdEf0123456789aBcDeF0123456789abcDEF01';

	it('recognises addresses', () => {
		expect(isWalletAddress(address)).toBe(true);
		expect(isWalletAddress(address.slice(0, -1))).toBe(false);
		expect(isWalletAddress('0xZZ' + address.slice(4))).toBe(false);
		expect(isWalletAddress(5)).toBe(false);
	});

	it('shortens addresses and leaves other text alone', () => {
		expect(shortAddress(address)).toBe('0xAbCd…EF01');
		expect(shortAddress('hello')).toBe('hello');
	});
});
