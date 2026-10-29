/**
 * @fileoverview Small pure formatting helpers for the admin UI (timestamps, password generator).
 *
 * Isomorphic: the same output is produced during server rendering and in the browser, which avoids
 * hydration mismatches (no locale / time-zone dependent formatting).
 */

/**
 * Formats an ISO-8601 timestamp deterministically in UTC.
 *
 * @param iso - ISO string from the database, or `null`.
 * @param fallback - Text for `null` / unparsable input.
 * @returns `YYYY-MM-DD HH:mm UTC`, or `fallback`.
 * @example
 * formatTimestamp('2026-10-29T12:34:56.789Z'); // '2026-10-29 12:34 UTC'
 */
export function formatTimestamp(iso: string | null | undefined, fallback = '—'): string {
	if (!iso) return fallback;
	const time = Date.parse(iso);
	if (Number.isNaN(time)) return fallback;
	return `${new Date(time).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** Characters for generated passwords: no look-alikes (0/O, 1/l/I) to ease reading aloud. */
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * Generates a random password with the Web Crypto API (uniform via rejection sampling).
 *
 * @param length - Number of characters (clamped to 12–128).
 * @returns A password long enough to satisfy the 10-character policy of `validation.ts`.
 * @example
 * generatePassword().length; // 20
 */
export function generatePassword(length = 20): string {
	const size = Math.min(128, Math.max(12, Math.trunc(length)));
	const alphabetSize = PASSWORD_ALPHABET.length;
	// Largest multiple of the alphabet size below 256: bytes above it are rejected (no modulo bias).
	const limit = 256 - (256 % alphabetSize);
	let out = '';
	while (out.length < size) {
		const bytes = crypto.getRandomValues(new Uint8Array(size));
		for (const byte of bytes) {
			if (byte < limit && out.length < size) out += PASSWORD_ALPHABET[byte % alphabetSize];
		}
	}
	return out;
}
