/**
 * @fileoverview Unit tests for the component editor's safe file access.
 */
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	listComponentFiles,
	readComponentFile,
	resolveComponentPath,
	saveComponentFile
} from './component-files.js';
import { ProjectError } from './project.js';

let root: string;
let outside: string;

beforeAll(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), 'comp-editor-'));
	outside = await mkdtemp(path.join(os.tmpdir(), 'comp-outside-'));
	await mkdir(path.join(root, 'src/routes'), { recursive: true });
	await mkdir(path.join(root, 'src/lib/components/sub'), { recursive: true });
	await writeFile(path.join(root, 'package.json'), '{}');
	await writeFile(path.join(root, 'src/lib/components/A.svelte'), '<p>a</p>\n');
	await writeFile(path.join(root, 'src/lib/components/sub/B.svelte'), '<p>b</p>\n');
	await writeFile(path.join(root, 'src/lib/components/notes.txt'), 'x');
	await writeFile(path.join(outside, 'Secret.svelte'), '<p>secret</p>');
	await symlink(outside, path.join(root, 'src/lib/components/link'));
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
	await rm(outside, { recursive: true, force: true });
});

describe('resolveComponentPath', () => {
	it.each(['../x.svelte', 'a/../b.svelte', '/etc/passwd.svelte', 'a.txt', '.hidden.svelte', ''])(
		'rejects %j',
		(bad) => {
			expect(() => resolveComponentPath('/p', bad)).toThrow(ProjectError);
		}
	);
	it('accepts nested svelte files', () => {
		expect(resolveComponentPath('/p', 'sub/B.svelte')).toBe('/p/src/lib/components/sub/B.svelte');
	});
});

describe('listComponentFiles / readComponentFile', () => {
	it('lists only svelte files and skips symlinked folders', async () => {
		const { files } = await listComponentFiles(root);
		expect(files.map((f) => f.path)).toEqual(['A.svelte', 'sub/B.svelte']);
	});

	it('reads files but refuses to follow symlinks out of the project', async () => {
		expect(await readComponentFile(root, 'A.svelte')).toBe('<p>a</p>\n');
		await expect(readComponentFile(root, 'link/Secret.svelte')).rejects.toThrow(ProjectError);
	});

	it('rejects folders that are not SvelteKit projects', async () => {
		await expect(listComponentFiles(outside)).rejects.toThrow(ProjectError);
	});
});

describe('saveComponentFile', () => {
	it('writes valid content', async () => {
		const result = await saveComponentFile(root, 'A.svelte', '<p>changed</p>\n');
		expect(result.saved).toBe(true);
		expect(await readFile(path.join(root, 'src/lib/components/A.svelte'), 'utf8')).toBe(
			'<p>changed</p>\n'
		);
	});

	it('blocks compile errors unless forced', async () => {
		const blocked = await saveComponentFile(root, 'A.svelte', '<p>{</p>');
		expect(blocked.saved).toBe(false);
		expect(blocked.diagnostics[0].severity).toBe('error');
		expect(await readFile(path.join(root, 'src/lib/components/A.svelte'), 'utf8')).toBe(
			'<p>changed</p>\n'
		);
		const forced = await saveComponentFile(root, 'A.svelte', '<p>{</p>', { force: true });
		expect(forced.saved).toBe(true);
	});

	it('creates new files in new folders but never overwrites', async () => {
		const created = await saveComponentFile(root, 'new/C.svelte', '<p>c</p>\n', { create: true });
		expect(created.saved).toBe(true);
		await expect(
			saveComponentFile(root, 'new/C.svelte', '<p>c</p>\n', { create: true })
		).rejects.toThrow(/already exists/);
	});

	it('refuses to save a file that does not exist', async () => {
		await expect(saveComponentFile(root, 'Missing.svelte', '<p></p>')).rejects.toThrow(
			/does not exist/
		);
	});

	it('refuses to write through a symlinked folder', async () => {
		await expect(
			saveComponentFile(root, 'link/Secret.svelte', '<p>hacked</p>', { force: true })
		).rejects.toThrow(ProjectError);
		expect(await readFile(path.join(outside, 'Secret.svelte'), 'utf8')).toBe('<p>secret</p>');
	});
});
