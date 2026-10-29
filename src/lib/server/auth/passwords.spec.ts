import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, verifyPasswordOrDummy } from './passwords.js';

describe('passwords', () => {
	it('hashes with Argon2id and a random salt', async () => {
		const a = await hashPassword('correct horse battery');
		const b = await hashPassword('correct horse battery');
		expect(a).toMatch(/^\$argon2id\$/);
		expect(a).not.toBe(b);
	});

	it('verifies the right password and rejects wrong or malformed input', async () => {
		const stored = await hashPassword('correct horse battery');
		expect(await verifyPassword(stored, 'correct horse battery')).toBe(true);
		expect(await verifyPassword(stored, 'wrong horse battery')).toBe(false);
		expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
	});

	it('verifyPasswordOrDummy never succeeds without a hash', async () => {
		expect(await verifyPasswordOrDummy(null, 'anything at all')).toBe(false);
		const stored = await hashPassword('correct horse battery');
		expect(await verifyPasswordOrDummy(stored, 'correct horse battery')).toBe(true);
	});
});
