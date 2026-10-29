/**
 * @fileoverview `GET /auth/wallet/nonce` – issues a one-time nonce for Sign-In with Ethereum.
 *
 * The browser embeds the nonce into the EIP-4361 message the wallet signs; the server later
 * consumes it exactly once (replay protection, see `wallet.ts`). Requests are rate limited per IP
 * because every call writes a row.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clientIp } from '../../../../lib/server/auth/login.js';
import { createRateLimiter } from '../../../../lib/server/auth/rate-limit.js';
import { issueWalletNonce } from '../../../../lib/server/auth/wallet.js';
import { getDatabase } from '../../../../lib/server/database/manager.js';

/** 30 nonces per minute per IP; every request counts (they are all "attempts"). */
const nonceLimiter = createRateLimiter({ max: 30, windowMs: 60_000 });

export const GET: RequestHandler = async (event) => {
	const ip = clientIp(event);
	const decision = nonceLimiter.check(ip);
	if (!decision.allowed) {
		return json(
			{ error: 'Too many requests' },
			{ status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } }
		);
	}
	nonceLimiter.fail(ip);
	const nonce = await issueWalletNonce(await getDatabase());
	return json({ nonce }, { headers: { 'Cache-Control': 'no-store' } });
};
