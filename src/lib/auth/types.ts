/**
 * @fileoverview Shared (isomorphic) authentication types.
 *
 * Nothing here may contain secrets: these shapes are safe to send to the browser. In particular the
 * password hash never appears in {@link UserRecord}; it only exists inside `server/auth/users.ts`.
 */

import type { Role } from './roles.js';

/** How a user can authenticate: with a password or through an external identity. */
export type AuthProvider = 'password' | 'github' | 'google' | 'linkedin' | 'wallet';

/** External identity providers (everything except the local password). */
export type IdentityProvider = Exclude<AuthProvider, 'password'>;

/** All identity providers in display order. */
export const identityProviders: readonly IdentityProvider[] = [
	'github',
	'google',
	'linkedin',
	'wallet'
];

/** Display names for the UI. */
export const providerLabels: Record<AuthProvider, string> = {
	password: 'Email & password',
	github: 'GitHub',
	google: 'Google',
	linkedin: 'LinkedIn',
	wallet: 'Crypto wallet'
};

/** The minimal user object stored in `event.locals.user` for a valid session. */
export type SessionUser = {
	id: string;
	/** Lower-cased email, or `null` for wallet-only accounts. */
	email: string | null;
	name: string;
	role: Role;
};

/** A linked external sign-in method. */
export type UserIdentity = {
	id: string;
	provider: IdentityProvider;
	/** Display hint, e.g. the GitHub login or a shortened wallet address `0x12…ab34`. */
	label: string | null;
	createdAt: string;
};

/** A complete user as shown in the admin UI and the account page. */
export type UserRecord = {
	id: string;
	email: string | null;
	emailVerified: boolean;
	name: string;
	role: Role;
	/** Disabled users cannot sign in and their sessions are revoked. */
	disabled: boolean;
	/** Whether a local password is set. */
	hasPassword: boolean;
	/** ISO-8601 timestamps. */
	createdAt: string;
	updatedAt: string;
	lastLoginAt: string | null;
	identities: UserIdentity[];
};
