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
	createProjectImage,
	defaultProject,
	deleteProject,
	deleteProjectImage,
	duplicateProject,
	firstProjectName,
	getAccessibleProject,
	listProjects,
	listProjectImageRecords,
	listProjectImages,
	loadSite,
	loadSiteSnapshot,
	mergeImportedProject,
	ProjectStoreError,
	saveSite,
	updateProjectImage,
	updateProject
} from './project-store.js';

const PASSWORD = 'correct horse battery';
let db: SqlClient;

beforeEach(async () => {
	db = openSqliteClient(':memory:');
	await ensureSchema(db);
});

describe('project image library', () => {
	it('updates saved references, blocks deletion and rejects stale site saves', async () => {
		const user = await account('images@example.com');
		const project = (await defaultProject(db, user))!;
		const originalUrl = 'https://example.com/image.svg';
		const newUrl = 'https://example.com/new-image.svg';
		await createProjectImage(db, project.id, {
			id: 'image1',
			name: 'Example',
			url: originalUrl,
			category: 'Icons',
			kind: 'link'
		});
		const document = site();
		document.pages[0].blocks[0].href = originalUrl;
		document.composites[0].blocks[0].customProps = { imageUrl: originalUrl };
		document.pages[0].blocks.push({
			...block('image'),
			kind: 'widget-image',
			action: originalUrl
		});
		document.pages[0].blocks.push({
			...block('navigation'),
			kind: 'widget-navbar',
			items: `Image | ${originalUrl}`
		});
		await saveSite(db, project.id, document);
		const snapshot = await loadSiteSnapshot(db, project.id);
		await expect(deleteProjectImage(db, project.id, 'image1')).rejects.toMatchObject({
			code: 'in_use'
		});
		await updateProjectImage(db, project.id, 'image1', {
			name: 'Renamed',
			category: 'Photos',
			url: newUrl
		});
		const updated = await loadSite(db, project.id);
		expect(updated.pages[0].blocks[0].href).toBe(newUrl);
		expect(updated.pages[0].blocks[1].action).toBe(newUrl);
		expect(updated.pages[0].blocks[2].items).toBe(`Image | ${newUrl}`);
		expect(updated.composites[0].blocks[0].customProps?.imageUrl).toBe(newUrl);
		await expect(saveSite(db, project.id, snapshot.site, snapshot.revision)).rejects.toMatchObject({
			code: 'conflict'
		});
		await expect(deleteProjectImage(db, project.id, 'image1')).rejects.toMatchObject({
			code: 'in_use'
		});
		await saveSite(db, project.id, { pages: [], composites: [] });
		await deleteProjectImage(db, project.id, 'image1');
		expect((await listProjectImages(db, project.id)).some((image) => image.id === 'image1')).toBe(
			false
		);
	});

	it('isolates and duplicates managed image data with the project', async () => {
		const user = await account('copies@example.com');
		const project = (await defaultProject(db, user))!;
		await createProjectImage(db, project.id, {
			id: 'icon1',
			name: 'Icon',
			url: '/media/icon1.png',
			category: 'Icons',
			kind: 'managed',
			mimeType: 'image/png',
			size: 3,
			data: 'YWJj'
		});
		const copy = await duplicateProject(db, project.id);
		expect(await listProjectImages(db, copy.id)).toEqual(await listProjectImages(db, project.id));
		await deleteProjectImage(db, copy.id, 'icon1');
		expect((await listProjectImages(db, project.id)).some((image) => image.id === 'icon1')).toBe(
			true
		);
		await deleteProject(db, project.id);
		await expect(listProjectImages(db, project.id)).rejects.toMatchObject({ code: 'not_found' });
	});

	it('seeds each project once without restoring deleted starter icons', async () => {
		const user = await account('seeds@example.com');
		const project = (await defaultProject(db, user))!;
		const initial = await listProjectImages(db, project.id);
		expect(initial).toHaveLength(50);
		expect(initial.find((image) => image.id === 'svgrepo-530481')?.url).toBe(
			'https://www.svgrepo.com/show/530481/menu.svg'
		);
		await deleteProjectImage(db, project.id, 'svgrepo-530481');
		expect(await listProjectImages(db, project.id)).toHaveLength(49);
		expect(
			(await listProjectImages(db, project.id)).some((image) => image.id === 'svgrepo-530481')
		).toBe(false);
	});

	it('enforces the project-wide managed image quota before writing', async () => {
		const user = await account('quota@example.com');
		const project = (await defaultProject(db, user))!;
		await listProjectImages(db, project.id);
		await db.run(
			`INSERT INTO project_images (project_id, id, name, url, category, kind, mime_type, size, data)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				project.id,
				'full',
				'Full',
				'/media/full.png',
				'Icons',
				'managed',
				'image/png',
				50 * 1024 * 1024,
				'YWJj'
			]
		);
		await expect(
			createProjectImage(db, project.id, {
				id: 'extra',
				name: 'Extra',
				url: '/media/extra.png',
				category: 'Icons',
				kind: 'managed',
				mimeType: 'image/png',
				size: 1,
				data: 'YQ=='
			})
		).rejects.toMatchObject({ code: 'limit' });
		expect((await listProjectImages(db, project.id)).some((image) => image.id === 'extra')).toBe(
			false
		);
	});

	it('counts starter links when enforcing the 500-image limit', async () => {
		const user = await account('image-count@example.com');
		const project = (await defaultProject(db, user))!;
		await listProjectImages(db, project.id);
		for (let index = 0; index < 450; index += 1) {
			await db.run(
				`INSERT INTO project_images (project_id, id, name, url, category, kind)
				 VALUES (?, ?, ?, ?, ?, ?)`,
				[project.id, `link-${index}`, 'Link', `https://example.com/${index}.svg`, 'Icons', 'link']
			);
		}
		await expect(
			createProjectImage(db, project.id, {
				id: 'one-too-many',
				name: 'One too many',
				url: 'https://example.com/last.svg',
				category: 'Icons',
				kind: 'link'
			})
		).rejects.toMatchObject({ code: 'limit' });
	});

	it('rolls back the site and revision when an imported image conflicts', async () => {
		const user = await account('import-conflict@example.com');
		const project = (await defaultProject(db, user))!;
		const image = {
			id: 'external',
			name: 'Existing',
			url: 'https://example.com/one.svg',
			category: 'Icons' as const,
			kind: 'link' as const
		};
		await createProjectImage(db, project.id, image);
		await saveSite(db, project.id, site());
		const before = await loadSiteSnapshot(db, project.id);
		const imported = site();
		imported.pages[0].name = 'Imported';
		await expect(
			mergeImportedProject(db, project.id, {
				...imported,
				images: [{ ...image, url: 'https://example.com/other.svg' }]
			})
		).rejects.toMatchObject({ code: 'conflict' });
		expect(await loadSiteSnapshot(db, project.id)).toEqual(before);
	});

	it('restores edited and deleted starters when importing into a fresh project', async () => {
		const user = await account('starter-import@example.com');
		const source = (await defaultProject(db, user))!;
		await listProjectImages(db, source.id);
		await deleteProjectImage(db, source.id, 'svgrepo-530481');
		await updateProjectImage(db, source.id, 'svgrepo-530482', {
			name: 'My dial',
			category: 'Logos',
			url: 'https://example.com/my-dial.svg'
		});
		const images = await listProjectImageRecords(db, source.id);
		const target = await createProject(db, user.id, { name: 'Imported project' });
		await mergeImportedProject(db, target.id, { pages: [], composites: [], images });
		expect(await listProjectImageRecords(db, target.id)).toEqual(images);
		expect(
			(await listProjectImages(db, target.id)).some((image) => image.id === 'svgrepo-530481')
		).toBe(false);
	});

	it('keeps starter images when importing an older project without an image manifest', async () => {
		const user = await account('legacy-import@example.com');
		const project = (await defaultProject(db, user))!;
		await mergeImportedProject(db, project.id, { pages: [], composites: [] });
		expect(await listProjectImages(db, project.id)).toHaveLength(50);
	});

	it('updates preserved references when an import replaces an untouched starter', async () => {
		const user = await account('starter-merge@example.com');
		const project = (await defaultProject(db, user))!;
		const seedUrl = 'https://www.svgrepo.com/show/530481/menu.svg';
		const existing = site();
		existing.pages[0].blocks[0].href = seedUrl;
		await saveSite(db, project.id, existing);
		const updatedUrl = 'https://example.com/new-menu.svg';
		await mergeImportedProject(db, project.id, {
			pages: [],
			composites: [],
			images: [
				{
					id: 'svgrepo-530481',
					name: 'Custom menu',
					url: updatedUrl,
					category: 'Icons',
					kind: 'link'
				}
			]
		});
		expect((await loadSite(db, project.id)).pages[0].blocks[0].href).toBe(updatedUrl);
		expect(
			(await listProjectImages(db, project.id)).find((image) => image.id === 'svgrepo-530481')
		).toMatchObject({ name: 'Custom menu', url: updatedUrl });
	});
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
		await createProjectImage(pg, project.id, {
			id: 'postgres-image',
			name: 'Postgres image',
			url: 'https://example.com/postgres.svg',
			category: 'Icons',
			kind: 'link'
		});
		await saveSite(pg, project.id, site());
		expect(await loadSite(pg, project.id)).toEqual(site());
		const copy = await duplicateProject(pg, project.id);
		expect(copy.pageCount).toBe(2);
		expect(
			(await listProjectImages(pg, copy.id)).some((image) => image.id === 'postgres-image')
		).toBe(true);
		expect(await listProjects(pg, ada)).toHaveLength(2);
		await recreateSchema(pg);
		expect(await pg.all('SELECT id FROM projects')).toEqual([]);
		await pg.close();
	}, 30_000);
});
