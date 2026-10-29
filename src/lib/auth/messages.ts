/**
 * @fileoverview Maps the stable error codes that travel through URLs (`/login?error=<code>`,
 * `/account?error=<code>`) to user-presentable messages.
 *
 * ## Why a lookup table instead of echoing the query parameter?
 * The `error` parameter is attacker-controllable (anybody can craft a link). Rendering it verbatim
 * would allow convincing phishing text on our own origin ("Your account was locked, call …"). By
 * mapping known codes to fixed sentences and falling back to one generic sentence for everything
 * else, the page can only ever show messages we wrote.
 *
 * ## Message uniformity
 * Messages for failed sign-ins deliberately never reveal *which* part was wrong: `invalid_credentials`
 * is one sentence for "unknown email" and "wrong password" (account enumeration defence).
 *
 * Isomorphic and side-effect free; no server imports.
 */

/** Fallback shown for unknown or missing codes. */
export const genericAuthError = 'Something went wrong. Please try again.';

/** Every code the pages know how to explain (server `AuthErrorCode`s plus OAuth redirect codes). */
const messages: Readonly<Record<string, string>> = {
	invalid_input: 'Please check the highlighted fields and try again.',
	invalid_credentials: 'Invalid email or password.',
	account_disabled: 'This account has been disabled. Contact an administrator.',
	registration_closed: 'Registration is currently closed.',
	email_taken: 'An account with this email already exists.',
	identity_taken: 'This sign-in method already belongs to another account.',
	weak_password: 'This password is not strong enough.',
	not_found: 'The requested item was not found.',
	last_admin: 'The last active administrator cannot be removed or demoted.',
	last_sign_in_method: 'You cannot remove your last sign-in method.',
	forbidden: 'You are not allowed to do that.',
	rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
	wallet_invalid: 'The wallet signature could not be verified.',
	oauth_failed: 'Sign-in with the external provider failed. Please try again.',
	oauth_denied: 'Sign-in was cancelled at the external provider.',
	oauth_unconfigured: 'This sign-in provider is not configured on this server.',
	setup_closed: 'Setup has already been completed.'
};

/**
 * Turns an error code into a safe, fixed message.
 *
 * @param code - Value of an `?error=` query parameter (untrusted; may be `null`/`undefined`).
 * @returns The message for a known code, otherwise {@link genericAuthError}; `null` when no code was given.
 * @example
 * authErrorMessage('oauth_denied'); // 'Sign-in was cancelled at the external provider.'
 * authErrorMessage('<script>'); // 'Something went wrong. Please try again.'
 * authErrorMessage(null); // null
 */
export function authErrorMessage(code: string | null | undefined): string | null {
	if (!code) return null;
	// `Object.hasOwn` guards against prototype keys such as `constructor` or `__proto__`.
	return Object.hasOwn(messages, code) ? messages[code] : genericAuthError;
}
