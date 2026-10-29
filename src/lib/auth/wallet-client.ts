/**
 * @fileoverview Browser-only Sign-In with Ethereum client helper.
 *
 * This isomorphic-safe module imports only viem's public SIWE formatter and has no server dependencies.
 * It requests a one-time challenge from the application, asks the injected wallet to sign the canonical
 * EIP-4361 message, and posts the signed message to the verification endpoint.
 */

import { createSiweMessage } from 'viem/siwe';

/** Minimal EIP-1193 wallet interface required by the sign-in flow. */
export interface WalletEthereumProvider {
	/**
	 * Requests an account or signs a message through the wallet.
	 * @param args - EIP-1193 method and optional positional parameters.
	 * @returns The provider response.
	 */
	request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/** Optional integrations for {@link signInWithWallet}. */
export type SignInWithWalletOptions = {
	/** Injected fetch implementation; defaults to the browser's global `fetch`. */
	fetchImpl?: typeof fetch;
	/** Injected EIP-1193 provider; defaults to `window.ethereum`. */
	ethereum?: WalletEthereumProvider;
	/**
	 * Add the wallet to the currently signed-in account instead of signing in. The server only
	 * honours this when a valid session cookie accompanies the request.
	 */
	link?: boolean;
};

type WalletWindow = Window & { ethereum?: WalletEthereumProvider };

/**
 * Signs in with the active browser wallet using a server-issued, single-use SIWE nonce.
 *
 * @param options - Optional Fetch and wallet provider injections for tests or custom integrations.
 * @returns The JSON payload returned by `/auth/wallet/verify` (normally the new session/user result).
 * @throws If no wallet is available, a wallet request fails, or either HTTP endpoint rejects the flow.
 * @example
 * const result = await signInWithWallet({});
 */
export async function signInWithWallet(options: SignInWithWalletOptions = {}): Promise<unknown> {
	const ethereum = options.ethereum ?? getWindowEthereum();
	if (!ethereum) throw new Error('No compatible Ethereum wallet was found.');
	const fetchImpl = options.fetchImpl ?? fetch;
	const location = getBrowserLocation();

	const requestedAccounts = await ethereum.request({ method: 'eth_requestAccounts' });
	if (!Array.isArray(requestedAccounts) || typeof requestedAccounts[0] !== 'string') {
		throw new Error('The wallet did not provide an account.');
	}
	const address = requestedAccounts[0];
	const chainIdResponse = await ethereum.request({ method: 'eth_chainId' });
	if (typeof chainIdResponse !== 'string' || !/^0x[\da-f]+$/i.test(chainIdResponse)) {
		throw new Error('The wallet returned an invalid chain ID.');
	}
	const chainId = Number.parseInt(chainIdResponse, 16);
	if (!Number.isSafeInteger(chainId) || chainId < 1)
		throw new Error('The wallet returned an invalid chain ID.');

	const nonceResponse = await fetchImpl('/auth/wallet/nonce', {
		headers: { Accept: 'application/json' }
	});
	if (!nonceResponse.ok) throw new Error('Unable to request a wallet sign-in nonce.');
	const noncePayload: unknown = await nonceResponse.json();
	if (
		typeof noncePayload !== 'object' ||
		noncePayload === null ||
		!('nonce' in noncePayload) ||
		typeof noncePayload.nonce !== 'string' ||
		!noncePayload.nonce
	) {
		throw new Error('The server returned an invalid wallet sign-in nonce.');
	}

	const message = createSiweMessage({
		domain: location.host,
		address: address as `0x${string}`,
		uri: location.origin,
		nonce: noncePayload.nonce,
		chainId,
		version: '1',
		issuedAt: new Date()
	});
	const signature = await ethereum.request({ method: 'personal_sign', params: [message, address] });
	if (typeof signature !== 'string' || !/^0x[\da-f]{130}$/i.test(signature)) {
		throw new Error('The wallet returned an invalid signature.');
	}

	const verificationResponse = await fetchImpl('/auth/wallet/verify', {
		method: 'POST',
		headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
		body: JSON.stringify(options.link ? { message, signature, link: true } : { message, signature })
	});
	if (!verificationResponse.ok) {
		// The endpoint only returns safe, user-presentable `error` strings (see its @fileoverview),
		// so they can be surfaced to explain e.g. "registration closed" or "belongs to another account".
		throw new Error(await readServerError(verificationResponse));
	}
	return verificationResponse.json();
}

/** Extracts `{ error }` from a failed JSON response, falling back to a generic message. */
async function readServerError(response: Response): Promise<string> {
	const fallback = 'Wallet sign-in verification failed.';
	try {
		const payload: unknown = await response.json();
		if (
			typeof payload === 'object' &&
			payload !== null &&
			'error' in payload &&
			typeof payload.error === 'string' &&
			payload.error.length > 0 &&
			payload.error.length <= 200
		) {
			return payload.error;
		}
	} catch {
		// Not JSON (proxy error page …): use the generic message.
	}
	return fallback;
}

function getWindowEthereum(): WalletEthereumProvider | undefined {
	return typeof window === 'undefined' ? undefined : (window as WalletWindow).ethereum;
}

function getBrowserLocation(): Location {
	if (typeof window === 'undefined')
		throw new Error('Wallet sign-in is available only in a browser.');
	return window.location;
}
