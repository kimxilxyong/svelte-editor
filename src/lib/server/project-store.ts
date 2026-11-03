/**
 * @fileoverview Persistence of projects, their pages and composite components, and their theme.
 *
 * This is the **only** module that reads or writes the `projects`, `project_pages` and
 * `project_composites` tables. It uses the portable SQL dialect only (see `database/types.ts`), so it
 * runs on SQLite and PostgreSQL alike.
 *
 * ## Ownership
 * Every project belongs to one user. {@link getAccessibleProject} and {@link listProjects} apply the
 * rule "owner or admin"; callers must use them (never {@link getProject}) whenever the project id
 * comes from a request. An unauthorised id is indistinguishable from a missing one (`null`), so ids
 * cannot be probed.
 *
 * ## Site storage
 * The editor still works with one whole {@link EditorSite} document: {@link loadSite} assembles it
 * from the page/composite rows and {@link saveSite} replaces the rows in one transaction. Page and
 * composite ids are unique per project only.
 *
 * Interacts with:
 * - `auth/users.ts` – creates the first, empty project together with every new account.
 * - `routes/editor/api`, `routes/projects`, `routes/theme` – the scoped HTTP endpoints.
 * - `widget-files.ts` – per-project widget overrides, removed together with the project.
 */

import { hasRole, type Role } from '../auth/roles.js';
import { parseEditorSite, type EditorSite } from '../editor.js';
import {
	normalizeProjectName,
	projectLimits,
	uniqueProjectName,
	type ProjectInput,
	type ProjectSummary
} from '../projects.js';
import { defaultSiteTheme, parseSiteTheme, type SiteTheme } from '../theme.js';
import type { SqlClient, SqlRow } from './database/types.js';

/** Reason codes of {@link ProjectStoreError}. */
export type ProjectStoreErrorCode = 'invalid_input' | 'name_taken' | 'not_found' | 'limit';

/** Error with a message that is safe to show to the user. */
export class ProjectStoreError extends Error {
	constructor(
		readonly code: ProjectStoreErrorCode,
		message: string
	) {
		super(message);
		this.name = 'ProjectStoreError';
	}
}

/** The part of the signed-in user the store needs to decide access. */
export type ProjectActor = { id: string; role: Role };

/** Name given to the project that is created together with every account. */
export const firstProjectName = 'My first project';

const summarySelect = `SELECT p.id, p.owner_id, u.name AS owner_name, p.name, p.description, p.path, p.theme,
		p.created_at, p.updated_at,
		(SELECT CAST(COUNT(*) AS INTEGER) FROM project_pages pp WHERE pp.project_id = p.id) AS page_count,
		(SELECT CAST(COUNT(*) AS INTEGER) FROM project_composites pc WHERE pc.project_id = p.id) AS composite_count
	FROM projects p JOIN users u ON u.id = p.owner_id`;

function toSummary(row: SqlRow): ProjectSummary {
	let theme: SiteTheme | null = null;
	try {
		theme = parseSiteTheme(JSON.parse(String(row.theme)));
	} catch {
		// Corrupt JSON falls back to the default theme below.
	}
	return {
		id: String(row.id),
		ownerId: String(row.owner_id),
		ownerName: String(row.owner_name ?? ''),
		name: String(row.name),
		description: String(row.description ?? ''),
		path: String(row.path ?? ''),
		theme: theme ?? { ...defaultSiteTheme },
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at),
		pageCount: Number(row.page_count ?? 0),
		compositeCount: Number(row.composite_count ?? 0)
	};
}

/**
 * Whether `actor` may open, change and delete `project`: its owner and every admin.
 *
 * @param actor - Signed-in user.
 * @param project - Any object with an `ownerId`.
 */
export function canAccessProject(actor: ProjectActor, project: Pick<ProjectSummary, 'ownerId'>) {
	return project.ownerId === actor.id || hasRole(actor.role, 'admin');
}

/**
 * Lists the projects of a user (newest change first). Admins get the projects of all users.
 *
 * @param db - Database client.
 * @param actor - Signed-in user.
 * @returns The visible projects, each with owner name and page/composite counts.
 */
export async function listProjects(db: SqlClient, actor: ProjectActor): Promise<ProjectSummary[]> {
	const admin = hasRole(actor.role, 'admin');
	const rows = await db.all<SqlRow>(
		`${summarySelect} ${admin ? '' : 'WHERE p.owner_id = ?'} ORDER BY p.updated_at DESC, p.name`,
		admin ? [] : [actor.id]
	);
	return rows.map(toSummary);
}

/**
 * Loads one project without any access check. Use {@link getAccessibleProject} for request input.
 *
 * @param db - Database client.
 * @param id - Project id.
 * @returns The project or `null`.
 */
export async function getProject(db: SqlClient, id: string): Promise<ProjectSummary | null> {
	const row = await db.get<SqlRow>(`${summarySelect} WHERE p.id = ?`, [id]);
	return row ? toSummary(row) : null;
}

/**
 * Loads a project the actor may use.
 *
 * @param db - Database client.
 * @param actor - Signed-in user.
 * @param id - Untrusted project id.
 * @returns The project, or `null` when it does not exist **or** belongs to somebody else.
 */
export async function getAccessibleProject(
	db: SqlClient,
	actor: ProjectActor,
	id: unknown
): Promise<ProjectSummary | null> {
	if (typeof id !== 'string' || id.length === 0 || id.length > 100) return null;
	const project = await getProject(db, id);
	return project && canAccessProject(actor, project) ? project : null;
}

/**
 * Picks the project to work on when none is selected: the most recently changed one the actor owns
 * (admins fall back to their own projects first, so they do not land in somebody else's work).
 *
 * @param db - Database client.
 * @param actor - Signed-in user.
 * @returns A project or `null` when the user has none.
 */
export async function defaultProject(
	db: SqlClient,
	actor: ProjectActor
): Promise<ProjectSummary | null> {
	const row = await db.get<SqlRow>(
		`${summarySelect} WHERE p.owner_id = ? ORDER BY p.updated_at DESC, p.name LIMIT 1`,
		[actor.id]
	);
	return row ? toSummary(row) : null;
}

function validatePath(raw: unknown): string {
	if (raw === undefined || raw === null) return '';
	if (typeof raw !== 'string' || raw.length > projectLimits.pathLength || raw.includes('\0')) {
		throw new ProjectStoreError('invalid_input', 'The project folder is invalid.');
	}
	return raw.trim();
}

async function ownerNames(db: SqlClient, ownerId: string, exceptId?: string): Promise<string[]> {
	const rows = await db.all<SqlRow>('SELECT id, name FROM projects WHERE owner_id = ?', [ownerId]);
	return rows.filter((row) => row.id !== exceptId).map((row) => String(row.name));
}

/**
 * Creates an **empty** project (no pages, no composites).
 *
 * @param db - Database client or transaction (the account creation runs this inside its own).
 * @param ownerId - Owning user.
 * @param input - Name and optional description, folder and theme.
 * @returns The created project.
 * @throws {ProjectStoreError} `invalid_input`, `name_taken` (same owner, case-insensitive) or `limit`.
 * @example
 * await createProject(db, user.id, { name: 'Portfolio' });
 */
export async function createProject(
	db: SqlClient,
	ownerId: string,
	input: ProjectInput
): Promise<ProjectSummary> {
	const name = normalizeProjectName(input.name);
	if (!name) {
		throw new ProjectStoreError(
			'invalid_input',
			`Enter a project name (1–${projectLimits.nameLength} characters).`
		);
	}
	const description = (input.description ?? '').trim();
	if (description.length > projectLimits.descriptionLength) {
		throw new ProjectStoreError('invalid_input', 'The description is too long.');
	}
	const theme = input.theme ? parseSiteTheme(input.theme) : { ...defaultSiteTheme };
	if (!theme) throw new ProjectStoreError('invalid_input', 'The theme is invalid.');
	const path = validatePath(input.path);

	const existing = await ownerNames(db, ownerId);
	if (existing.length >= projectLimits.perUser) {
		throw new ProjectStoreError('limit', `You can have at most ${projectLimits.perUser} projects.`);
	}
	if (existing.some((other) => other.toLowerCase() === name.toLowerCase())) {
		throw new ProjectStoreError('name_taken', 'You already have a project with this name.');
	}

	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await db.run(
		`INSERT INTO projects (id, owner_id, name, description, path, theme, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[id, ownerId, name, description, path, JSON.stringify(theme), now, now]
	);
	return (await getProject(db, id))!;
}

/**
 * Changes name, description, folder and/or theme.
 *
 * @param db - Database client.
 * @param id - Project to change (the caller has already checked access).
 * @param patch - Fields to change; omitted fields stay as they are.
 * @returns The updated project.
 * @throws {ProjectStoreError} `not_found`, `invalid_input` or `name_taken`.
 */
export async function updateProject(
	db: SqlClient,
	id: string,
	patch: Partial<ProjectInput>
): Promise<ProjectSummary> {
	const current = await getProject(db, id);
	if (!current) throw new ProjectStoreError('not_found', 'Project not found.');
	const sets: string[] = [];
	const params: (string | number)[] = [];

	if (patch.name !== undefined) {
		const name = normalizeProjectName(patch.name);
		if (!name) {
			throw new ProjectStoreError(
				'invalid_input',
				`Enter a project name (1–${projectLimits.nameLength} characters).`
			);
		}
		const others = await ownerNames(db, current.ownerId, id);
		if (others.some((other) => other.toLowerCase() === name.toLowerCase())) {
			throw new ProjectStoreError('name_taken', 'You already have a project with this name.');
		}
		sets.push('name = ?');
		params.push(name);
	}
	if (patch.description !== undefined) {
		const description = String(patch.description).trim();
		if (description.length > projectLimits.descriptionLength) {
			throw new ProjectStoreError('invalid_input', 'The description is too long.');
		}
		sets.push('description = ?');
		params.push(description);
	}
	if (patch.path !== undefined) {
		sets.push('path = ?');
		params.push(validatePath(patch.path));
	}
	if (patch.theme !== undefined) {
		const theme = parseSiteTheme(patch.theme);
		if (!theme) throw new ProjectStoreError('invalid_input', 'The theme is invalid.');
		sets.push('theme = ?');
		params.push(JSON.stringify(theme));
	}
	if (sets.length === 0) return current;

	sets.push('updated_at = ?');
	params.push(new Date().toISOString(), id);
	await db.run(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`, params);
	return (await getProject(db, id))!;
}

/**
 * Deletes a project with its pages and composites (database rows only – the SvelteKit folder on disk
 * is never touched).
 *
 * @param db - Database client.
 * @param id - Project to delete (the caller has already checked access).
 * @returns `true` when a project was deleted.
 */
export async function deleteProject(db: SqlClient, id: string): Promise<boolean> {
	// Children are removed explicitly as well, so the result does not depend on `foreign_keys` pragmas.
	return db.transaction(async (tx) => {
		await tx.run('DELETE FROM project_pages WHERE project_id = ?', [id]);
		await tx.run('DELETE FROM project_composites WHERE project_id = ?', [id]);
		const result = await tx.run('DELETE FROM projects WHERE id = ?', [id]);
		return result.changes > 0;
	});
}

/**
 * Copies a project (settings, pages and composites) for the same owner under a free name.
 *
 * @param db - Database client.
 * @param id - Source project (the caller has already checked access).
 * @returns The new project.
 * @throws {ProjectStoreError} `not_found` or `limit`.
 */
export async function duplicateProject(db: SqlClient, id: string): Promise<ProjectSummary> {
	const source = await getProject(db, id);
	if (!source) throw new ProjectStoreError('not_found', 'Project not found.');
	const site = await loadSite(db, id);
	const taken = await ownerNames(db, source.ownerId);
	const copy = await createProject(db, source.ownerId, {
		name: uniqueProjectName(`${source.name} copy`, taken),
		description: source.description,
		path: '',
		theme: source.theme
	});
	await saveSite(db, copy.id, site);
	return (await getProject(db, copy.id))!;
}

/**
 * Assembles the site of a project.
 *
 * @param db - Database client.
 * @param projectId - Project id.
 * @returns The pages and composites (both possibly empty).
 * @throws {Error} When stored rows no longer satisfy the editor-site validation.
 */
export async function loadSite(db: SqlClient, projectId: string): Promise<EditorSite> {
	const pageRows = await db.all<SqlRow>(
		'SELECT id, name, slug, width, height, blocks FROM project_pages WHERE project_id = ? ORDER BY ordinal',
		[projectId]
	);
	const compositeRows = await db.all<SqlRow>(
		'SELECT id, name, width, height, blocks FROM project_composites WHERE project_id = ? ORDER BY ordinal',
		[projectId]
	);
	const site = parseEditorSite({
		pages: pageRows.map((row) => ({
			id: row.id,
			name: row.name,
			slug: row.slug,
			width: Number(row.width),
			height: Number(row.height),
			blocks: JSON.parse(String(row.blocks))
		})),
		composites: compositeRows.map((row) => ({
			id: row.id,
			name: row.name,
			width: Number(row.width),
			height: Number(row.height),
			blocks: JSON.parse(String(row.blocks))
		}))
	});
	if (!site) throw new Error('The saved project contains invalid pages or components.');
	return site;
}

/**
 * Replaces the pages and composites of a project in one transaction.
 *
 * @param db - Database client.
 * @param projectId - Project id (the caller has already checked access).
 * @param site - Validated site (see `parseEditorSite`).
 * @throws {ProjectStoreError} `not_found` when the project does not exist.
 */
export async function saveSite(db: SqlClient, projectId: string, site: EditorSite): Promise<void> {
	await db.transaction(async (tx) => {
		if (!(await tx.get('SELECT id FROM projects WHERE id = ?', [projectId]))) {
			throw new ProjectStoreError('not_found', 'Project not found.');
		}
		await tx.run('DELETE FROM project_pages WHERE project_id = ?', [projectId]);
		await tx.run('DELETE FROM project_composites WHERE project_id = ?', [projectId]);
		for (const [ordinal, page] of site.pages.entries()) {
			await tx.run(
				`INSERT INTO project_pages (project_id, id, ordinal, name, slug, width, height, blocks)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					projectId,
					page.id,
					ordinal,
					page.name,
					page.slug,
					Math.round(page.width),
					Math.round(page.height),
					JSON.stringify(page.blocks)
				]
			);
		}
		for (const [ordinal, composite] of site.composites.entries()) {
			await tx.run(
				`INSERT INTO project_composites (project_id, id, ordinal, name, width, height, blocks)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				[
					projectId,
					composite.id,
					ordinal,
					composite.name,
					Math.round(composite.width),
					Math.round(composite.height),
					JSON.stringify(composite.blocks)
				]
			);
		}
		await tx.run('UPDATE projects SET updated_at = ? WHERE id = ?', [
			new Date().toISOString(),
			projectId
		]);
	});
}
