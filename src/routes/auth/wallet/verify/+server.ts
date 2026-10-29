/**
 * @fileoverview `POST /auth/wallet/verify` – signs in (or links) with a signed EIP-4361 message.
 *
 * Request body (JSON): `{ message: string, signature: string, link?: boolean }`.
 * - The message domain must equal this request's host, so a signature phished for another site is
 *   useless here (checked in `verifyWalletSignIn`).
 * - With `link: true` and an existing session the wallet is *added* to the signed-in account;
 *   otherwise it signs in / registers according to the registration policy (`flow.ts`).
 *
 * Responses: `200 { ok: true, created, linked, link }`, or `4xx { error, code }` with a stable
 * `AuthError` code. Provider internals are never echoed.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { shortAddress } from '../../../../lib/auth/validation.js';
import { AuthError, type AuthErrorCode } from '../../../../lib/server/auth/errors.js';
import { signInWithProfile } from '../../../../lib/server/auth/flow.js';
import { clientIp, establishSession } from '../../../../lib/server/auth/login.js';
import { createRateLimiter } from '../../../../lib/server/auth/rate-limit.js';
import { verifyWalletSignIn } from '../../../../lib/server/auth/wallet.js';
import { getDatabase } from '../../../../lib/server/database/manager.js';

/** Failed verifications per IP: 10 per 15 minutes. */
const verifyLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60_000 });

/** Upper bound for the JSON body: SIWE messages are well under 2 KB. */
const MAX_BODY_BYTES = 8 * 1024;

/** HTTP status for each {@link AuthErrorCode} this endpoint can produce. */
const statusFor: Partial<Record<AuthErrorCode, number>> = {
	wallet_invalid: 401,
	account_disabled: 403,
	registration_closed: 403,
	identity_taken: 409,
	rate_limited: 429
};

export const POST: RequestHandler = async (event) => {
	const { request, url, locals } = event;
	const ip = clientIp(event);

	const decision = verifyLimiter.check(ip);
	if (!decision.allowed) {
		return json(
			{ error: 'Too many failed attempts', code: 'rate_limited' },
			{ status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } }
		);
	}

	let body: { message?: unknown; signature?: unknown; link?: unknown };
	try {
		const text = await request.text();
		if (text.length > MAX_BODY_BYTES) throw new Error('too large');
		body = JSON.parse(text);
	} catch {
		return json({ error: 'Invalid request body', code: 'invalid_input' }, { status: 400 });
	}
	if (typeof body?.message !== 'string' || typeof body.signature !== 'string') {
		return json(
			{ error: 'message and signature are required', code: 'invalid_input' },
			{ status: 400 }
		);
	}

	try {
		const db = await getDatabase();
		const { address } = await verifyWalletSignIn(db, {
			message: body.message,
			signature: body.signature,
			// `url.host` includes the port, exactly like `window.location.host` used in the message.
			domain: url.host
		});
		const link = body.link === true && !!locals.user;
		const result = await signInWithProfile(
			db,
			{
				provider: 'wallet',
				providerUserId: address,
				email: null,
				emailVerified: false,
				name: shortAddress(address),
				label: shortAddress(address)
			},
			{ ip, linkToUserId: link ? locals.user?.id : undefined }
		);
		if (!link) await establishSession(event, db, result.user.id);
		return json({ ok: true, created: result.created, linked: result.linked, link });
	} catch (error) {
		if (error instanceof AuthError) {
			if (error.code === 'wallet_invalid') verifyLimiter.fail(ip);
			return json(
				{ error: error.message, code: error.code },
				{ status: statusFor[error.code] ?? 400 }
			);
		}
		console.error('Wallet sign-in failed.', error);
		return json({ error: 'Wallet sign-in failed', code: 'wallet_invalid' }, { status: 500 });
	}
};
