import { describe, expect, it } from 'vitest';
import { GET } from './+server.js';
import os from 'node:os';
import path from 'node:path';

describe('filesystem browse API', () => {
	it('browses current working directory', async () => {
		const url = new URL('http://localhost/editor/api/fs');
		const res = await GET({ url } as any);
		const data = await res.json();

		expect(res.status).toBe(200);
		expect(data.current).toBe(process.cwd());
		expect(data.isSvelteKit).toBe(true);
		expect(Array.isArray(data.directories)).toBe(true);
		expect(data.directories.some((d: any) => d.name === 'src')).toBe(true);
	});

	it('browses home directory', async () => {
		const url = new URL(`http://localhost/editor/api/fs?path=${encodeURIComponent(os.homedir())}`);
		const res = await GET({ url } as any);
		const data = await res.json();

		expect(res.status).toBe(200);
		expect(data.current).toBe(os.homedir());
	});

	it('returns 400 for invalid or non-existent path', async () => {
		const url = new URL('http://localhost/editor/api/fs?path=/non-existent-directory-xyz-123');
		const res = await GET({ url } as any);
		expect(res.status).toBe(400);
	});
});
