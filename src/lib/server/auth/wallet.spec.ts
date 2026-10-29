/**
 * @fileoverview Server-side tests for SIWE nonce issuance, message validation, and replay protection.
 *
 * Each test uses a real in-memory SQLite client and a deterministic viem account so signature recovery
 * exercises the same cryptographic path as production without network or external wallet dependencies.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import type { Hex } from 'viem';
import { ensureSchema } from '../database/schema.js';
import { openSqliteClient } from '../database/sqlite-client.js';
import type { SqlClient } from '../database/types.js';
import { AuthError } from './errors.js';
import { buildSignInMessage, issueWalletNonce, verifyWalletSignIn } from './wallet.js';

const account = privateKeyToAccount(`0x${'01'.repeat(32)}` as Hex);
const domain = 'example.test';
const uri = `https://${domain}`;
let db: SqlClient;

beforeEach(async () => {
	db = openSqliteClient(':memory:');
	await ensureSchema(db);
});

afterEach(async () => {
	await db.close();
});

describe('wallet SIWE authentication', () => {
	it('issues a persistent nonce and accepts a valid signed message once', async () => {
		const nonce = await issueWalletNonce(db);
		const message = buildSignInMessage({
			domain,
			address: account.address,
			uri,
			nonce,
			chainId: 1
		});
		const signature = await account.signMessage({ message });

		expect(await verifyWalletSignIn(db, { message, signature, domain })).toEqual({
			address: account.address.toLowerCase()
		});
		await expect(verifyWalletSignIn(db, { message, signature, domain })).rejects.toMatchObject({
			code: 'wallet_invalid'
		});
	});

	it('rejects a message for the wrong domain without accepting the signature', async () => {
		const nonce = await issueWalletNonce(db);
		const message = buildSignInMessage({
			domain,
			address: account.address,
			uri,
			nonce,
			chainId: 1
		});
		const signature = await account.signMessage({ message });

		await expect(
			verifyWalletSignIn(db, { message, signature, domain: 'other.test' })
		).rejects.toMatchObject({
			code: 'wallet_invalid'
		});
	});

	it('rejects an expired SIWE message', async () => {
		const nonce = await issueWalletNonce(db);
		const message = createSiweMessage({
			domain,
			address: account.address,
			uri,
			nonce,
			chainId: 1,
			version: '1',
			issuedAt: new Date(Date.now() - 60_000),
			expirationTime: new Date(Date.now() - 1_000)
		});
		const signature = await account.signMessage({ message });

		await expect(verifyWalletSignIn(db, { message, signature, domain })).rejects.toMatchObject({
			code: 'wallet_invalid'
		});
	});

	it('rejects an expired database nonce even if the signed message is otherwise valid', async () => {
		const nonce = await issueWalletNonce(db);
		await db.run('UPDATE auth_nonces SET expires_at = ? WHERE nonce = ?', [
			new Date(Date.now() - 1_000).toISOString(),
			nonce
		]);
		const message = buildSignInMessage({
			domain,
			address: account.address,
			uri,
			nonce,
			chainId: 1
		});
		const signature = await account.signMessage({ message });

		await expect(verifyWalletSignIn(db, { message, signature, domain })).rejects.toBeInstanceOf(
			AuthError
		);
	});

	it('rejects a tampered signature', async () => {
		const nonce = await issueWalletNonce(db);
		const message = buildSignInMessage({
			domain,
			address: account.address,
			uri,
			nonce,
			chainId: 1
		});
		const signature = await account.signMessage({ message });
		const tamperedSignature =
			`${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}` as Hex;

		await expect(
			verifyWalletSignIn(db, { message, signature: tamperedSignature, domain })
		).rejects.toMatchObject({ code: 'wallet_invalid' });
	});

	it('rejects malformed or mismatched addresses', async () => {
		const nonce = await issueWalletNonce(db);
		const validMessage = buildSignInMessage({
			domain,
			address: account.address,
			uri,
			nonce,
			chainId: 1
		});
		const invalidMessage = validMessage.replace(account.address, '0x1234');
		const signature = await account.signMessage({ message: invalidMessage });
		await expect(
			verifyWalletSignIn(db, { message: invalidMessage, signature, domain })
		).rejects.toMatchObject({ code: 'wallet_invalid' });
	});

	it('rejects messages whose nonce is not stored for wallet sign-in', async () => {
		const message = buildSignInMessage({
			domain,
			address: account.address,
			uri,
			nonce: 'unissuednonce',
			chainId: 1
		});
		const signature = await account.signMessage({ message });

		await expect(verifyWalletSignIn(db, { message, signature, domain })).rejects.toMatchObject({
			code: 'wallet_invalid'
		});
	});
});
