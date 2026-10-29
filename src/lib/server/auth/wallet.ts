/**
 * @fileoverview Server-side Sign-In with Ethereum nonce issuance and signature verification.
 *
 * Wallet sign-in uses EIP-4361 messages, short-lived `auth_nonces` records, and recovered Ethereum
 * addresses. A nonce is consumed with a conditional DELETE after all message and signature checks,
 * making the successful verification single-use even when duplicate requests arrive concurrently.
 */

import { isAddress, type Address, type Hex, recoverMessageAddress } from 'viem';
import {
	createSiweMessage,
	generateSiweNonce,
	parseSiweMessage,
	validateSiweMessage
} from 'viem/siwe';
import type { SqlClient } from '../database/types.js';
import { AuthError } from './errors.js';

const WALLET_NONCE_PURPOSE = 'wallet';
const WALLET_NONCE_TTL_MS = 5 * 60 * 1000;

/** Inputs required to create the EIP-4361 message signed by the wallet. */
export type SignInMessageInput = {
	domain: string;
	address: string;
	uri: string;
	nonce: string;
	chainId: number;
	statement?: string;
};

/**
 * Constructs the canonical EIP-4361 sign-in message shared with the browser helper.
 *
 * @param input - Domain, wallet address, origin URI, single-use nonce, and chain ID.
 * @returns A formatted SIWE message with an issued-at timestamp.
 * @throws If viem rejects a malformed SIWE field such as the address, URI, or chain ID.
 * @example
 * const message = buildSignInMessage({ domain: 'example.com', address, uri: 'https://example.com', nonce, chainId: 1 });
 */
export function buildSignInMessage(input: SignInMessageInput): string {
	return createSiweMessage({
		...input,
		address: input.address as Address,
		version: '1',
		issuedAt: new Date()
	});
}

/**
 * Issues a cryptographically random nonce and persists it for five minutes.
 *
 * @param db - Open portable SQL client.
 * @returns The single-use SIWE nonce.
 * @throws Database errors if the nonce cannot be persisted.
 * @example
 * const nonce = await issueWalletNonce(db);
 */
export async function issueWalletNonce(db: SqlClient): Promise<string> {
	const now = new Date();
	await db.run('DELETE FROM auth_nonces WHERE expires_at <= ?', [now.toISOString()]);

	// Retry only on an improbable primary-key collision; never reuse an existing active challenge.
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const nonce = generateSiweNonce();
		try {
			await db.run('INSERT INTO auth_nonces (nonce, purpose, expires_at) VALUES (?, ?, ?)', [
				nonce,
				WALLET_NONCE_PURPOSE,
				new Date(now.getTime() + WALLET_NONCE_TTL_MS).toISOString()
			]);
			return nonce;
		} catch (error) {
			const existing = await db.get<{ nonce: string }>(
				'SELECT nonce FROM auth_nonces WHERE nonce = ?',
				[nonce]
			);
			if (existing || attempt === 2) throw error;
		}
	}
	throw new Error('Unable to issue a wallet nonce.');
}

/** Inputs for validating a signed wallet sign-in message. */
export type VerifyWalletSignInInput = {
	message: string;
	signature: string;
	domain: string;
};

/** Verified wallet identity returned by {@link verifyWalletSignIn}. */
export type VerifiedWallet = {
	/** Lower-case `0x`-prefixed address suitable as a stable identity key. */
	address: string;
};

/**
 * Validates a SIWE message and consumes its nonce after verifying the recovered signer.
 *
 * @param db - Open portable SQL client.
 * @param input - Signed message and expected host domain.
 * @returns The authenticated lower-case wallet address.
 * @throws {@link AuthError} with `wallet_invalid` for malformed, expired, wrong-domain, replayed, or
 * invalidly signed messages.
 * @example
 * const wallet = await verifyWalletSignIn(db, { message, signature, domain: 'example.com' });
 */
export async function verifyWalletSignIn(
	db: SqlClient,
	input: VerifyWalletSignInInput
): Promise<VerifiedWallet> {
	let parsed: ReturnType<typeof parseSiweMessage>;
	try {
		parsed = parseSiweMessage(input.message);
	} catch {
		throw walletInvalid();
	}

	if (
		typeof parsed.domain !== 'string' ||
		parsed.domain !== input.domain ||
		typeof parsed.address !== 'string' ||
		!isAddress(parsed.address) ||
		typeof parsed.nonce !== 'string' ||
		!parsed.nonce ||
		typeof parsed.uri !== 'string' ||
		parsed.version !== '1' ||
		!Number.isSafeInteger(parsed.chainId) ||
		(parsed.chainId ?? 0) < 1 ||
		!isExpectedUriHost(parsed.uri, input.domain) ||
		!validateSiweMessage({ message: parsed, domain: input.domain, time: new Date() })
	) {
		throw walletInvalid();
	}

	const now = new Date();
	const nonceRecord = await db.get<{ expires_at: string }>(
		'SELECT expires_at FROM auth_nonces WHERE nonce = ? AND purpose = ?',
		[parsed.nonce, WALLET_NONCE_PURPOSE]
	);
	if (!nonceRecord || Date.parse(nonceRecord.expires_at) <= now.getTime()) throw walletInvalid();

	let recoveredAddress: Address;
	try {
		if (!/^0x[\da-fA-F]{130}$/.test(input.signature)) throw new Error('Malformed signature.');
		recoveredAddress = await recoverMessageAddress({
			message: input.message,
			signature: input.signature as Hex
		});
	} catch {
		throw walletInvalid();
	}
	if (recoveredAddress.toLowerCase() !== parsed.address.toLowerCase()) throw walletInvalid();

	// Conditional deletion is the replay barrier; only one concurrent request can consume this nonce.
	const consumed = await db.run(
		'DELETE FROM auth_nonces WHERE nonce = ? AND purpose = ? AND expires_at > ?',
		[parsed.nonce, WALLET_NONCE_PURPOSE, now.toISOString()]
	);
	if (consumed.changes !== 1) throw walletInvalid();

	return { address: parsed.address.toLowerCase() };
}

function isExpectedUriHost(uri: string, domain: string): boolean {
	try {
		return new URL(uri).host === domain;
	} catch {
		return false;
	}
}

function walletInvalid(): AuthError {
	return new AuthError('wallet_invalid', 'The wallet sign-in message is invalid or expired.');
}
