/**
 * @fileoverview In-memory native-composite persistence/API regressions. No shared database or
 * filesystem is used: SQLite tests legacy/envelope storage, scoped targeted updates, revisions,
 * compiler/limit/import validation, resets and stale visual snapshots.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEditorSite, maxCompositeSourceBytes, type EditorSite } from '../editor.js';
import { requiredRoleFor } from '../auth/roles.js';
import { mergeEditorDocuments } from '../editor-mode.js';
import { seedComposites } from '../composite-seeds.js';
import { renderCompositeSource } from '../svelte-pages.js';
import { ensureSchema } from './database/schema.js';
import { openSqliteClient } from './database/sqlite-client.js';
import { getDatabase } from './database/manager.js';
import {
	createProject,
	duplicateProject,
	loadSite,
	readCompositeSource,
	saveCompositeSource,
	saveSite
} from './project-store.js';
import { POST } from '../../routes/component-editor/composites/+server.js';

vi.mock('./database/manager.js', () => ({ getDatabase: vi.fn() }));
let db: ReturnType<typeof openSqliteClient>;
let project: Awaited<ReturnType<typeof createProject>>;
let other: Awaited<ReturnType<typeof createProject>>;
const actor = { id: 'owner', role: 'poweruser' as const };
const native = `<script lang="ts">let message = $state('Exact source');</script>
<p class="native">{message}</p>
<style>.native { color: rgb(11, 22, 33); }</style>\n`;
const visual = (): EditorSite => ({
	pages: [{ id: 'page', name: 'Page', slug: 'page', width: 800, height: 600, blocks: [] }],
	composites: seedComposites().slice(0, 2)
});

beforeEach(async () => {
	db = openSqliteClient(':memory:');
	await ensureSchema(db);
	await db.run(
		'INSERT INTO users (id, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
		[actor.id, 'Owner', actor.role, 'now', 'now']
	);
	await db.run(
		'INSERT INTO users (id, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
		['foreign', 'Foreign', 'poweruser', 'now', 'now']
	);
	project = await createProject(db, actor.id, { name: 'Native' });
	other = await createProject(db, 'foreign', { name: 'Foreign' });
	await saveSite(db, project.id, visual());
	await saveSite(db, other.id, visual());
	vi.mocked(getDatabase).mockResolvedValue(db);
});
afterEach(async () => {
	await db.close();
	vi.clearAllMocks();
});

/** Exercises the actual endpoint using a signed-in active-project context, not a body project id. */
function call(body: unknown, locals: unknown = { user: actor, project }) {
	return POST({
		request: new Request('http://localhost/component-editor/composites', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		locals
	} as Parameters<typeof POST>[0]);
}

describe('native composite persistence', () => {
	it('retains exact full source in parse, saved rows, duplication and both stashed visual modes', async () => {
		const site = visual();
		site.composites[0].source = native;
		expect(parseEditorSite(site)?.composites[0].source).toBe(native);
		await saveSite(db, project.id, site);
		const loaded = await loadSite(db, project.id);
		expect(loaded.composites[0].source).toBe(native);
		expect(renderCompositeSource(loaded.composites[0])).toBe(native);
		for (const mode of ['pages', 'composites'] as const) {
			const snapshot = mergeEditorDocuments(
				mode,
				mode === 'pages' ? loaded.pages : loaded.composites,
				loaded.pages,
				loaded.composites
			);
			expect(parseEditorSite(snapshot)?.composites[0].source).toBe(native);
		}
		const copy = await duplicateProject(db, project.id);
		expect((await loadSite(db, copy.id)).composites[0].source).toBe(native);
	});

	it('targets one source row and preserves metadata, unrelated pages and composites', async () => {
		const before = await loadSite(db, project.id);
		const first = before.composites[0];
		const read = await readCompositeSource(db, project.id, first.id);
		const result = await saveCompositeSource(db, project.id, first.id, native, read.revision);
		expect(result.saved).toBe(true);
		const after = await loadSite(db, project.id);
		expect(after.pages).toEqual(before.pages);
		expect(after.composites.slice(1)).toEqual(before.composites.slice(1));
		expect(after.composites[0]).toEqual({ ...first, source: native });
		expect((await loadSite(db, other.id)).composites[0].source).toBeUndefined();
	});

	it('stale visual saves retain overrides, including after a reset', async () => {
		const stale = await loadSite(db, project.id);
		const id = stale.composites[0].id;
		const read = await readCompositeSource(db, project.id, id);
		await saveCompositeSource(db, project.id, id, native, read.revision);
		stale.composites[0].width += 10;
		await saveSite(db, project.id, stale, { preserveCompositeSources: true });
		expect((await readCompositeSource(db, project.id, id)).content).toBe(native);
		const edited = await loadSite(db, project.id);
		const current = await readCompositeSource(db, project.id, id);
		await saveCompositeSource(db, project.id, id, undefined, current.revision);
		await saveSite(db, project.id, edited, { preserveCompositeSources: true });
		expect((await loadSite(db, project.id)).composites[0].source).toBeUndefined();
		expect((await readCompositeSource(db, project.id, id)).content).toContain(
			'data-editor-composite'
		);
	});

	it('rejects stale revisions and layout changes without replacing source', async () => {
		const id = visual().composites[0].id;
		const read = await readCompositeSource(db, project.id, id);
		await saveCompositeSource(db, project.id, id, native, read.revision);
		await expect(
			saveCompositeSource(db, project.id, id, '<p>Stale</p>', read.revision)
		).rejects.toMatchObject({ code: 'conflict' });
		const current = await readCompositeSource(db, project.id, id);
		const site = await loadSite(db, project.id);
		site.composites[0].height += 10;
		await saveSite(db, project.id, site);
		await expect(
			saveCompositeSource(db, project.id, id, undefined, current.revision)
		).rejects.toMatchObject({ code: 'conflict' });
	});

	it('serializes concurrent source saves so one revision cannot overwrite another', async () => {
		const id = visual().composites[0].id;
		const read = await readCompositeSource(db, project.id, id);
		const outcomes = await Promise.allSettled([
			saveCompositeSource(db, project.id, id, native, read.revision),
			saveCompositeSource(db, project.id, id, '<p>Concurrent second edit</p>', read.revision)
		]);
		expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
		expect(outcomes.filter((item) => item.status === 'rejected')).toHaveLength(1);
		expect((await readCompositeSource(db, project.id, id)).content).toBe(native);
	});

	it('server compiler blocks invalid source unless forced; limits and import violations never force', async () => {
		const id = visual().composites[0].id;
		const read = await readCompositeSource(db, project.id, id);
		const bad = '<script>let = ;</script>';
		const result = await saveCompositeSource(db, project.id, id, bad, read.revision);
		expect(result.saved).toBe(false);
		expect(result.diagnostics.some((item) => item.severity === 'error')).toBe(true);
		expect((await loadSite(db, project.id)).composites[0].source).toBeUndefined();
		expect((await saveCompositeSource(db, project.id, id, bad, read.revision, true)).saved).toBe(
			true
		);
		const current = await readCompositeSource(db, project.id, id);
		for (const source of [
			'x'.repeat(maxCompositeSourceBytes + 1),
			'\0',
			`<script>import X from 'untrusted';</script><X />`,
			`<button onclick={() => import('untrusted')}>Load</button>`
		]) {
			await expect(
				saveCompositeSource(db, project.id, id, source, current.revision, true)
			).rejects.toMatchObject({ code: 'invalid_input' });
		}
		expect(
			parseEditorSite({
				...visual(),
				composites: [{ ...visual().composites[0], source: 'é'.repeat(maxCompositeSourceBytes) }]
			})
		).toBeNull();
	});
});

describe('scoped composite source endpoint', () => {
	it('uses only locals.project, preserves identity even when source markers change, and exposes revisions', async () => {
		const id = visual().composites[0].id;
		const read = await (await call({ action: 'read', id })).json();
		const content = `<div data-editor-composite="WrongName" data-width="1">Changed marker</div>`;
		const response = await call({
			action: 'save',
			id,
			content,
			revision: read.revision,
			projectId: other.id
		});
		expect(response.status).toBe(200);
		const saved = await response.json();
		expect(saved.saved).toBe(true);
		expect(saved.composite.id).toBe(id);
		expect(saved.composite.name).toBe(read.composite.name);
		expect(saved.content).toBe(content);
		expect((await loadSite(db, other.id)).composites[0].source).toBeUndefined();
		expect(
			(await call({ action: 'save', id, content: native, revision: read.revision })).status
		).toBe(409);
		expect((await call({ action: 'read', id: 'missing' })).status).toBe(404);
	});

	it('fails closed for no project, foreign/missing active project, invalid body and underprivileged role', async () => {
		expect(requiredRoleFor('/component-editor/composites', 'POST')).toBe('poweruser');
		for (const active of [null, other, { id: 'missing' }]) {
			expect((await call({ action: 'list' }, { user: actor, project: active })).status).toBe(409);
		}
		expect((await call([])).status).toBe(400);
		expect((await call({ action: 'save', id: visual().composites[0].id })).status).toBe(400);
		await expect(
			call({ action: 'list' }, { user: { ...actor, role: 'user' }, project })
		).rejects.toMatchObject({ status: 403 });
	});
});
