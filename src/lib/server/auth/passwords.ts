/**
 * @fileoverview Password hashing with Argon2id.
 *
 * Uses `@node-rs/argon2`, whose defaults are Argon2id with m=19456 KiB, t=2, p=1 – the OWASP
 * recommended minimum. The encoded hash (PHC string) embeds algorithm, parameters and salt, so
 * parameters can be raised later without a migration: old hashes still verify.
 *
 * Used by `users.ts`; nothing outside the server may import this module.
 */

import { hash, verify } from '@node-rs/argon2';

/**
 * Hashes a password with Argon2id and a random salt.
 * @param password - Plain-text password (already validated by `validatePassword`).
 * @returns The PHC-encoded hash string to store in `users.password_hash`.
 * @example
 * const stored = await hashPassword('correct horse battery');
 */
export function hashPassword(password: string): Promise<string> {
	return hash(password);
}

/**
 * Verifies a password against a stored hash.
 * @param storedHash - PHC string produced by {@link hashPassword}.
 * @param password - Candidate plain-text password.
 * @returns `true` on match; `false` on mismatch or when the stored hash is malformed.
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
	try {
		return await verify(storedHash, password);
	} catch {
		return false;
	}
}

/** Lazily computed hash of a random value, verified against when the account does not exist. */
let dummyHash: Promise<string> | null = null;

/**
 * Verifies a password, doing the same amount of work even when there is no hash.
 *
 * Login for an unknown email (or an account without a password) must take about as long as a real
 * check; otherwise response time reveals which emails are registered (user enumeration).
 * @param storedHash - The stored hash, or `null` when the user does not exist / has no password.
 * @param password - Candidate plain-text password.
 * @returns `true` only when `storedHash` is non-null and matches.
 */
export async function verifyPasswordOrDummy(
	storedHash: string | null,
	password: string
): Promise<boolean> {
	if (storedHash) return verifyPassword(storedHash, password);
	dummyHash ??= hashPassword(crypto.randomUUID());
	await verifyPassword(await dummyHash, password);
	return false;
}
