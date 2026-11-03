/**
 * @fileoverview Server load for the `/images` management page.
 *
 * Returns the managed image catalog (`images`) and whether the signed-in user may create, import,
 * edit or delete images (`canEdit`).
 */

import type { PageServerLoad } from './$types';
import { hasRole } from '../../lib/auth/roles.js';
import { requireUser } from '../../lib/server/auth/guard.js';
import { getDatabase } from '../../lib/server/database/manager.js';
import { listImages } from '../../lib/server/project-store.js';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(locals, { redirectTo: url.pathname });
	const images = await listImages(await getDatabase());
	return {
		images,
		canEdit: hasRole(user.role, 'user')
	};
};
