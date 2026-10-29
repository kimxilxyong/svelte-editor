/**
 * @fileoverview Error type shared by all authentication / user-management services.
 *
 * Services throw {@link AuthError} for *expected* failures (bad credentials, duplicate email, last admin
 * protection …). Routes translate the `code` into an HTTP status / form error message; the `message` is
 * always safe to show to the end user. Unexpected failures are plain `Error`s and must become a generic
 * 500 without leaking details.
 */

/** Machine readable failure reasons. */
export type AuthErrorCode =
	| 'invalid_input'
	| 'invalid_credentials'
	| 'account_disabled'
	| 'registration_closed'
	| 'email_taken'
	| 'identity_taken'
	| 'weak_password'
	| 'not_found'
	| 'last_admin'
	| 'last_sign_in_method'
	| 'forbidden'
	| 'rate_limited'
	| 'wallet_invalid'
	| 'oauth_failed'
	| 'setup_closed';

/** Expected, user-presentable authentication failure. */
export class AuthError extends Error {
	/**
	 * @param code - Machine readable reason.
	 * @param message - Safe, user-presentable explanation.
	 */
	constructor(
		readonly code: AuthErrorCode,
		message: string
	) {
		super(message);
		this.name = 'AuthError';
	}
}
