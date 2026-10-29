/**
 * @fileoverview Root layout server load: exposes the signed-in user to every page.
 *
 * `hooks.server.ts` resolves the session into `locals.user`; this passes the minimal, secret-free
 * {@link SessionUser} (id, email, name, role) to the client so the header and navigation can adapt.
 */

import type { LayoutServerLoad } from './$types';

/** @returns `{ user }` – the current user or `null` when anonymous. */
export const load: LayoutServerLoad = ({ locals }) => ({ user: locals.user ?? null });
