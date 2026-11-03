/**
 * @fileoverview Filesystem picker API regression coverage.
 *
 * Browse tests preserve the existing response contract; creation tests use isolated temporary
 * parents to verify single-child creation, canonical paths, input validation and no overwrites.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GET, POST } from './+server.js';
import { requiredRoleFor } from '../../../../lib/auth/roles.js';

type GetEvent = Parameters<typeof GET>[0];
const event = (url: URL) => ({ url }) as GetEvent;
import os from 'node:os';

describe('filesystem browse API', () => {
	it('browses current working directory', async () => {
		const url = new URL('http://localhost/editor/api/fs');
		const res = await GET(event(url));
		const data = await res.json();

		expect(res.status).toBe(200);
		expect(data.current).toBe(process.cwd());
		expect(data.isSvelteKit).toBe(true);
		expect(Array.isArray(data.directories)).toBe(true);
		expect(data.directories.some((d: { name: string }) => d.name === 'src')).toBe(true);
	});

	type PostEvent = Parameters<typeof POST>[0];

	describe('filesystem folder creation API', () => {
		let root: string;
		beforeEach(async () => {
			root = await mkdtemp(path.join(os.tmpdir(), 'svelte-folder-picker-'));
		});
		afterEach(async () => {
			await rm(root, { recursive: true, force: true });
		});

		function create(body: unknown) {
			return POST({
				request: new Request('http://localhost/editor/api/fs', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body)
				})
			} as PostEvent);
		}

		it('creates one child with a trimmed name and exposes it to browsing', async () => {
			const res = await create({ path: root, name: ' New project ' });
			expect(res.status).toBe(201);
			expect(await res.json()).toEqual({ path: path.join(root, 'New project') });
			expect((await stat(path.join(root, 'New project'))).isDirectory()).toBe(true);
			const listing = await GET(
				event(new URL(`http://localhost/editor/api/fs?path=${encodeURIComponent(root)}`))
			);
			expect((await listing.json()).directories).toContainEqual({
				name: 'New project',
				path: path.join(root, 'New project'),
				isSvelteKit: false
			});
		});

		it('resolves a symlink parent to its canonical directory', async () => {
			await mkdir(path.join(root, 'actual'));
			await symlink(path.join(root, 'actual'), path.join(root, 'alias'));
			const res = await create({ path: path.join(root, 'alias'), name: 'Child' });
			expect(res.status).toBe(201);
			expect(await res.json()).toEqual({ path: path.join(root, 'actual', 'Child') });
		});

		it.each(['', ' ', '.', '..', '../escape', 'a/b', 'a\\b', '\0bad'])(
			'rejects unsafe name %j without creating anything',
			async (name) => {
				const res = await create({ path: root, name });
				expect(res.status).toBe(400);
				expect((await res.json()).error).toBeTruthy();
				expect(await readdir(root)).toEqual([]);
			}
		);

		it.each([null, [], {}, { path: 'relative', name: 'Child' }, { name: 'Child' }])(
			'rejects invalid body %j',
			async (body) => {
				const res = await create(body);
				expect(res.status).toBe(400);
				expect((await res.json()).error).toBeTruthy();
			}
		);

		it('rejects malformed JSON', async () => {
			const res = await POST({
				request: new Request('http://localhost/editor/api/fs', { method: 'POST', body: '{' })
			} as PostEvent);
			expect(res.status).toBe(400);
			expect((await res.json()).error).toBe('The request body must be valid JSON.');
		});

		it('refuses existing folders, files and symlinks without overwriting them', async () => {
			await mkdir(path.join(root, 'Folder'));
			await writeFile(path.join(root, 'File'), 'Keep this');
			await symlink(path.join(root, 'Folder'), path.join(root, 'Link'));
			for (const name of ['Folder', 'File', 'Link']) {
				const res = await create({ path: root, name });
				expect(res.status).toBe(409);
				expect((await res.json()).error).toMatch(/already exists/);
			}
			expect(await readFile(path.join(root, 'File'), 'utf8')).toBe('Keep this');
		});

		it('reports non-directory and missing parents without creating them', async () => {
			await writeFile(path.join(root, 'File'), 'Keep this');
			for (const parent of ['File', 'Missing']) {
				const res = await create({ path: path.join(root, parent), name: 'Child' });
				expect(res.status).toBe(400);
				expect((await res.json()).error).toBeTruthy();
			}
			expect(await readdir(root)).toEqual(['File']);
		});

		it('retains power-user access for both browsing and creation', () => {
			expect(requiredRoleFor('/editor/api/fs', 'GET')).toBe('poweruser');
			expect(requiredRoleFor('/editor/api/fs', 'POST')).toBe('poweruser');
		});
	});

	it('browses home directory', async () => {
		const url = new URL(`http://localhost/editor/api/fs?path=${encodeURIComponent(os.homedir())}`);
		const res = await GET(event(url));
		const data = await res.json();

		expect(res.status).toBe(200);
		expect(data.current).toBe(os.homedir());
	});

	it('returns 400 for invalid or non-existent path', async () => {
		const url = new URL('http://localhost/editor/api/fs?path=/non-existent-directory-xyz-123');
		const res = await GET(event(url));
		expect(res.status).toBe(400);
	});
});
