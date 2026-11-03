/**
 * @fileoverview Tests for project persistence: ownership, empty-by-default projects, site storage,
 * duplication, deletion, the first project of a new account and the "Create Tables" reset.
 */

import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EditorSite } from '../editor.js';
import { defaultSiteTheme } from '../theme.js';
import { createUser } from './auth/users.js';
import { dropAllTables, ensureSchema, recreateSchema } from './database/schema.js';
import {
	createPostgresClient,
	type PgPoolLike,
	type PgQueryResult
} from './database/postgres-client.js';
import { openSqliteClient } from './database/sqlite-client.js';
import type { SqlClient, SqlParam, SqlRow } from './database/types.js';
import {
	canAccessProject,
	createProject,
	defaultProject,
	deleteProject,
	duplicateProject,
	firstProjectName,
	getAccessibleProject,
	listProjects,
	loadSite,
	readCompositeSource,
	saveCompositeSource,
	ProjectStoreError,
	saveSite,
	updateProject
} from './project-store.js';

const PASSWORD = 'correct horse battery';
let db: SqlClient;

beforeEach(async () => {
	db = openSqliteClient(':memory:');
	await ensureSchema(db);
});

const account = (email: string, role: 'user' | 'poweruser' | 'admin' = 'poweruser') =>
	createUser(db, { email, name: email.split('@')[0], password: PASSWORD, role });

const block = (id: string) => ({
	id,
	kind: 'widget-button' as const,
	title: 'Go',
	body: '',
	action: '',
	theme: 'light' as const,
	alignTo: 'none' as const,
	positioned: true,
	x: 10,
	y: 10,
	width: 120,
	height: 40,
	value: '',
	checked: false,
	level: 60,
	href: '',
	newTab: false
});

const site = (): EditorSite => ({
	pages: [
		{ id: 'home', name: 'Home', slug: 'home', width: 1200, height: 800, blocks: [block('b1')] },
		{ id: 'about', name: 'About', slug: 'about', width: 800, height: 600, blocks: [] }
	],
	composites: [{ id: 'c1', name: 'Hero', width: 600, height: 200, blocks: [block('b2')] }]
});

async function expectCode(promise: Promise<unknown>, code: string) {
	await expect(promise).rejects.toMatchObject({ code });
	await expect(promise).rejects.toBeInstanceOf(ProjectStoreError);
}

describe('new accounts', () => {
	it('start with exactly one empty project and the default role from the schema', async () => {
		const user = await account('ada@example.com');
		const projects = await listProjects(db, user);
		expect(projects).toHaveLength(1);
		expect(projects[0]).toMatchObject({
			name: firstProjectName,
			ownerId: user.id,
			path: '',
			pageCount: 0,
			compositeCount: 0
		});
		expect(projects[0].theme).toEqual(defaultSiteTheme);
		expect(await loadSite(db, projects[0].id)).toEqual({ pages: [], composites: [] });
	});

	it('use poweruser as the database default role', async () => {
		await db.run(
			`INSERT INTO users (id, name, created_at, updated_at) VALUES ('x', 'X', 'now', 'now')`
		);
		expect((await db.get('SELECT role FROM users WHERE id = ?', ['x']))?.role).toBe('poweruser');
	});
});

describe('ownership', () => {
	it('lists only own projects, admins see all with owner names', async () => {
		const ada = await account('ada@example.com');
		const bob = await account('bob@example.com');
		const root = await account('root@example.com', 'admin');
		expect((await listProjects(db, ada)).map((p) => p.ownerId)).toEqual([ada.id]);
		expect((await listProjects(db, bob)).map((p) => p.ownerId)).toEqual([bob.id]);
		const all = await listProjects(db, root);
		expect(all).toHaveLength(3);
		expect(all.map((p) => p.ownerName).sort()).toEqual(['ada', 'bob', 'root']);
	});

	it('hides foreign projects from other users but not from admins', async () => {
		const ada = await account('ada@example.com');
		const bob = await account('bob@example.com');
		const root = await account('root@example.com', 'admin');
		const adas = (await defaultProject(db, ada))!;
		expect(await getAccessibleProject(db, bob, adas.id)).toBeNull();
		expect(await getAccessibleProject(db, ada, adas.id)).toMatchObject({ id: adas.id });
		expect(await getAccessibleProject(db, root, adas.id)).toMatchObject({ id: adas.id });
		expect(await getAccessibleProject(db, ada, 42)).toBeNull();
		expect(await getAccessibleProject(db, ada, 'missing')).toBeNull();
		expect(canAccessProject(bob, adas)).toBe(false);
		expect(canAccessProject(root, adas)).toBe(true);
	});
});

describe('create / update / delete', () => {
	it('creates empty projects with unique names per owner', async () => {
		const ada = await account('ada@example.com');
		const bob = await account('bob@example.com');
		const created = await createProject(db, ada.id, { name: '  Portfolio   site ' });
		expect(created).toMatchObject({ name: 'Portfolio site', pageCount: 0, description: '' });
		await expectCode(createProject(db, ada.id, { name: 'portfolio SITE' }), 'name_taken');
		// Another owner may use the same name.
		await expect(createProject(db, bob.id, { name: 'Portfolio site' })).resolves.toBeTruthy();
		await expectCode(createProject(db, ada.id, { name: '   ' }), 'invalid_input');
		await expectCode(createProject(db, ada.id, { name: 'x'.repeat(81) }), 'invalid_input');
		await expectCode(
			createProject(db, ada.id, { name: 'Bad path', path: 'a\0b' }),
			'invalid_input'
		);
	});

	it('enforces the per-user project limit', async () => {
		const ada = await account('ada@example.com');
		for (let i = 1; i < 50; i += 1) await createProject(db, ada.id, { name: `P${i}` });
		await expectCode(createProject(db, ada.id, { name: 'One too many' }), 'limit');
	});

	it('updates name, description, path and theme and validates them', async () => {
		const ada = await account('ada@example.com');
		const project = (await defaultProject(db, ada))!;
		const theme = { ...defaultSiteTheme, primary: '#112233', dark: true };
		const updated = await updateProject(db, project.id, {
			name: 'Renamed',
			description: 'About',
			path: ' /home/ada/site ',
			theme
		});
		expect(updated).toMatchObject({
			name: 'Renamed',
			description: 'About',
			path: '/home/ada/site'
		});
		expect(updated.theme).toEqual(theme);
		await expectCode(updateProject(db, project.id, { name: '' }), 'invalid_input');
		await expectCode(
			updateProject(db, project.id, { theme: { primary: 'red' } as never }),
			'invalid_input'
		);
		await expectCode(updateProject(db, 'missing', { name: 'x' }), 'not_found');
		const other = await createProject(db, ada.id, { name: 'Other' });
		await expectCode(updateProject(db, other.id, { name: 'renamed' }), 'name_taken');
	});

	it('deletes a project with its pages and composites', async () => {
		const ada = await account('ada@example.com');
		const project = (await defaultProject(db, ada))!;
		await saveSite(db, project.id, site());
		expect(await deleteProject(db, project.id)).toBe(true);
		expect(await deleteProject(db, project.id)).toBe(false);
		expect(await db.all('SELECT * FROM project_pages')).toEqual([]);
		expect(await db.all('SELECT * FROM project_composites')).toEqual([]);
		expect(await defaultProject(db, ada)).toBeNull();
	});
});

describe('site storage', () => {
	it('round-trips pages and composites in order', async () => {
		const ada = await account('ada@example.com');
		const project = (await defaultProject(db, ada))!;
		await saveSite(db, project.id, site());
		expect(await loadSite(db, project.id)).toEqual(site());
		expect(await getAccessibleProject(db, ada, project.id)).toMatchObject({
			pageCount: 2,
			compositeCount: 1
		});
		// A second save replaces the content.
		await saveSite(db, project.id, { pages: [], composites: [] });
		expect(await loadSite(db, project.id)).toEqual({ pages: [], composites: [] });
		await expectCode(saveSite(db, 'missing', site()), 'not_found');
	});

	it('keeps the same page ids apart in different projects', async () => {
		const ada = await account('ada@example.com');
		const bob = await account('bob@example.com');
		const a = (await defaultProject(db, ada))!;
		const b = (await defaultProject(db, bob))!;
		await saveSite(db, a.id, site());
		await saveSite(db, b.id, { ...site(), composites: [] });
		expect((await loadSite(db, a.id)).composites).toHaveLength(1);
		expect((await loadSite(db, b.id)).composites).toHaveLength(0);
		expect((await loadSite(db, b.id)).pages[0].id).toBe('home');
	});

	it('duplicates a project with a free name and without the folder', async () => {
		const ada = await account('ada@example.com');
		const project = (await defaultProject(db, ada))!;
		await updateProject(db, project.id, { path: '/srv/site' });
		await saveSite(db, project.id, site());
		const copy = await duplicateProject(db, project.id);
		const second = await duplicateProject(db, project.id);
		expect(copy).toMatchObject({ name: `${firstProjectName} copy`, path: '', pageCount: 2 });
		expect(second.name).toBe(`${firstProjectName} copy 2`);
		expect(await loadSite(db, copy.id)).toEqual(site());
	});
});

describe('Create Tables', () => {
	it('deletes everything and recreates empty tables (also legacy ones)', async () => {
		await account('ada@example.com');
		await db.exec('CREATE TABLE editor_page (id TEXT PRIMARY KEY)');
		await db.exec('CREATE TABLE task (id TEXT PRIMARY KEY)');
		await recreateSchema(db);
		for (const table of ['users', 'sessions', 'projects', 'project_pages', 'project_composites']) {
			expect(await db.all(`SELECT * FROM ${table}`)).toEqual([]);
		}
		await expect(db.all('SELECT * FROM editor_page')).rejects.toThrow();
		await expect(db.all('SELECT * FROM task')).rejects.toThrow();
		// The schema is usable again.
		const again = await account('ada@example.com');
		expect(await listProjects(db, again)).toHaveLength(1);
	});

	it('drops tables even while rows reference each other', async () => {
		const ada = await account('ada@example.com');
		await saveSite(db, (await defaultProject(db, ada))!.id, site());
		await dropAllTables(db);
		await expect(db.all('SELECT * FROM projects')).rejects.toThrow();
	});
});

describe('PostgreSQL backend', () => {
	it('runs the same project flow (schema, ownership, site, duplicate, reset)', async () => {
		const pglite = new PGlite();
		const query = async (text: string, params?: SqlParam[]): Promise<PgQueryResult> => {
			const result = await pglite.query(text, params);
			return {
				rows: result.rows as SqlRow[],
				rowCount: result.rowCount ?? result.affectedRows ?? null
			};
		};
		const pool: PgPoolLike = {
			query,
			connect: async () => ({ query, release: () => undefined }),
			end: () => pglite.close()
		};
		const pg = createPostgresClient(pool);
		await ensureSchema(pg);
		const ada = await createUser(pg, {
			email: 'ada@example.com',
			name: 'Ada',
			password: PASSWORD,
			role: 'poweruser'
		});
		const project = (await defaultProject(pg, ada))!;
		await saveSite(pg, project.id, site());
		expect(await loadSite(pg, project.id)).toEqual(site());
		const id = site().composites[0].id;
		const read = await readCompositeSource(pg, project.id, id);
		const source = '<p>PostgreSQL native override</p><style>p { color: red; }</style>';
		expect((await saveCompositeSource(pg, project.id, id, source, read.revision)).saved).toBe(true);
		await saveSite(pg, project.id, site(), { preserveCompositeSources: true });
		expect((await readCompositeSource(pg, project.id, id)).content).toBe(source);
		const copy = await duplicateProject(pg, project.id);
		expect((await loadSite(pg, copy.id)).composites[0].source).toBe(source);
		expect(copy.pageCount).toBe(2);
		expect(await listProjects(pg, ada)).toHaveLength(2);
		await recreateSchema(pg);
		expect(await pg.all('SELECT id FROM projects')).toEqual([]);
		await pg.close();
	}, 30_000);
});
