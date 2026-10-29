/**
 * @fileoverview `POST /logout` – ends the current session.
 *
 * POST only (a GET logout could be triggered by an `<img>` tag on another site). The CSRF origin
 * check in `hooks.server.ts` already rejects cross-site POSTs. The session row is deleted server
 * side, so a stolen cookie stops working too, then the browser is sent to the login page.
 */

import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordAudit } from '../../lib/server/auth/audit.js';
import {
	clearSessionCookie,
	invalidateSession,
	sessionCookieName
} from '../../lib/server/auth/sessions.js';
import { getDatabase } from '../../lib/server/database/manager.js';

export const POST: RequestHandler = async ({ cookies, locals }) => {
	const token = cookies.get(sessionCookieName);
	if (token) {
		const db = await getDatabase();
		await invalidateSession(db, token);
		if (locals.user) {
			await recordAudit(db, {
				actor: { id: locals.user.id, label: locals.user.email ?? locals.user.name },
				action: 'logout'
			});
		}
	}
	clearSessionCookie(cookies);
	redirect(303, '/login');
};
