/**
 * @fileoverview Pure, isomorphic input validation for account data (email, name, password, wallet).
 *
 * The same functions are used by the server services (authoritative checks) and by the UI forms
 * (instant feedback), so there is exactly one definition of "a valid email / password".
 *
 * Password policy follows NIST SP 800-63B: a generous minimum length, a maximum that protects the
 * hashing function from denial of service, a blocklist of very common passwords, and **no** character
 * composition rules.
 */

/** Minimum accepted password length (characters). */
export const PASSWORD_MIN_LENGTH = 10;

/** Maximum accepted password length; bounds the work Argon2 has to do for one request. */
export const PASSWORD_MAX_LENGTH = 128;

/** Maximum accepted display-name length (characters). */
export const NAME_MAX_LENGTH = 80;

/** Maximum email length allowed by RFC 5321 (path limit). */
export const EMAIL_MAX_LENGTH = 254;

/**
 * Pragmatic email syntax check: one `@`, a non-empty local part without whitespace, and a dotted domain.
 * Deliberately not a full RFC 5322 parser – deliverability cannot be verified without sending mail.
 */
const emailPattern = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** An Ethereum address: `0x` followed by 40 hex digits (case-insensitive, no checksum enforced). */
const walletAddressPattern = /^0x[0-9a-fA-F]{40}$/;

/** A small blocklist of the most commonly used passwords that still satisfy the length rule. */
const commonPasswords: ReadonlySet<string> = new Set([
	'password12',
	'password123',
	'password1234',
	'password12345',
	'1234567890',
	'12345678910',
	'123456789012',
	'0123456789',
	'qwertyuiop',
	'qwertyuiop123',
	'qwerty12345',
	'qwerty123456',
	'1q2w3e4r5t',
	'1qaz2wsx3edc',
	'iloveyou123',
	'letmein123',
	'welcome123',
	'welcome1234',
	'administrator',
	'admin12345',
	'admin123456',
	'abc1234567',
	'abcdefghij',
	'changeme123',
	'passw0rd123',
	'p@ssw0rd123',
	'password!23',
	'11111111111',
	'1111111111',
	'0000000000',
	'aaaaaaaaaa',
	'trustno1234',
	'football123',
	'baseball123',
	'monkey12345',
	'dragon12345',
	'superman123',
	'sunshine123'
]);

/**
 * Normalises an email address for storage and lookup.
 * @param raw - Untrusted input (anything; non-strings are rejected).
 * @returns The trimmed, lower-cased address, or `null` when it is not a plausible email.
 * @example
 * normalizeEmail('  Ada@Example.COM '); // 'ada@example.com'
 * normalizeEmail('nope'); // null
 */
export function normalizeEmail(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const email = raw.trim().toLowerCase();
	if (email.length === 0 || email.length > EMAIL_MAX_LENGTH) return null;
	return emailPattern.test(email) ? email : null;
}

/**
 * Validates a password against the policy.
 * @param password - The candidate password (compared verbatim, never trimmed).
 * @param context - Optional account data the password must not simply repeat.
 * @returns A human readable error message, or `null` when the password is acceptable.
 * @example
 * validatePassword('short'); // 'Password must be at least 10 characters long.'
 * validatePassword('correct horse battery'); // null
 */
export function validatePassword(
	password: unknown,
	context: { email?: string | null; name?: string | null } = {}
): string | null {
	if (typeof password !== 'string') return 'Password is required.';
	if (password.length < PASSWORD_MIN_LENGTH) {
		return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`;
	}
	if (password.length > PASSWORD_MAX_LENGTH) {
		return `Password must be at most ${PASSWORD_MAX_LENGTH} characters long.`;
	}
	const lowered = password.toLowerCase();
	const email = context.email?.trim().toLowerCase();
	if (email && (lowered === email || lowered === email.split('@')[0])) {
		return 'Password must not be the same as your email address.';
	}
	const name = context.name?.trim().toLowerCase();
	if (name && lowered === name) return 'Password must not be the same as your name.';
	if (commonPasswords.has(lowered)) return 'This password is too common. Choose another one.';
	return null;
}

/**
 * Cleans and validates a display name.
 * @param raw - Untrusted input.
 * @returns The trimmed name with inner whitespace collapsed (1–80 characters), or `null` when
 *   invalid. Control characters make the name invalid so it can never forge log lines.
 * @example
 * validateName('  Ada   Lovelace '); // 'Ada Lovelace'
 * validateName('   '); // null
 */
export function validateName(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
	const name = raw.trim().replace(/\s+/g, ' ');
	if (name.length === 0 || name.length > NAME_MAX_LENGTH) return null;
	return name;
}

/**
 * Type guard for an Ethereum address string.
 * @param value - Any value.
 * @example
 * isWalletAddress('0xAbCdEf0123456789aBcDeF0123456789abcDEF01'); // true
 */
export function isWalletAddress(value: unknown): value is `0x${string}` {
	return typeof value === 'string' && walletAddressPattern.test(value);
}

/**
 * Abbreviates a wallet address for display (`0x1234…abcd`).
 * @param address - A full address; anything that is not a valid address is returned unchanged.
 * @example
 * shortAddress('0x1234567890abcdef1234567890abcdef12345678'); // '0x1234…5678'
 */
export function shortAddress(address: string): string {
	return isWalletAddress(address) ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
