/**
 * @fileoverview PostgreSQL adapter integration specs using the in-process PGlite engine.
 *
 * The test pool exposes exactly the same minimal query/connect/end interface consumed by the
 * production adapter, exercising placeholder conversion, affected-row counts and transaction reuse.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresClient, type PgPoolLike, type PgQueryResult } from './postgres-client.js';
import type { SqlParam, SqlRow } from './types.js';

let pglite: PGlite;
let client: ReturnType<typeof createPostgresClient>;

function makePool(database: PGlite): PgPoolLike {
	const query = async (text: string, params?: SqlParam[]): Promise<PgQueryResult> => {
		const result = await database.query(text, params);
		return {
			rows: result.rows as SqlRow[],
			rowCount: result.rowCount ?? result.affectedRows ?? null
		};
	};
	return {
		query,
		connect: async () => ({ query, release: () => undefined }),
		end: () => database.close()
	};
}

beforeEach(() => {
	pglite = new PGlite();
	client = createPostgresClient(makePool(pglite));
});

afterEach(async () => {
	await client.close();
});

describe('PostgreSQL SqlClient adapter', () => {
	it('rewrites placeholders without changing question marks inside SQL strings', async () => {
		await client.exec('CREATE TABLE samples (id TEXT PRIMARY KEY, label TEXT NOT NULL)');
		const insert = await client.run('INSERT INTO samples (id, label) VALUES (?, ?)', [
			'sample-1',
			"contains ? and it's literal"
		]);
		expect(insert.changes).toBe(1);

		const row = await client.get<SqlRow>(
			"SELECT id, label, 'value ? and it''s ?' AS literal FROM samples WHERE label = ?",
			["contains ? and it's literal"]
		);
		expect(row).toEqual({
			id: 'sample-1',
			label: "contains ? and it's literal",
			literal: "value ? and it's ?"
		});
	});

	it('commits nested transactions on the reserved connection and rolls back failures', async () => {
		await client.exec('CREATE TABLE samples (id TEXT PRIMARY KEY)');
		await client.transaction(async (tx) => {
			await tx.run('INSERT INTO samples (id) VALUES (?)', ['committed']);
			await tx.transaction(async (nested) => {
				await nested.run('INSERT INTO samples (id) VALUES (?)', ['nested']);
			});
		});
		expect(
			(await client.all<SqlRow>('SELECT id FROM samples ORDER BY id')).map((row) => row.id)
		).toEqual(['committed', 'nested']);

		await expect(
			client.transaction(async (tx) => {
				await tx.run('INSERT INTO samples (id) VALUES (?)', ['rolled-back']);
				throw new Error('force rollback');
			})
		).rejects.toThrow('force rollback');
		expect(
			await client.get<SqlRow>('SELECT id FROM samples WHERE id = ?', ['rolled-back'])
		).toBeUndefined();
	});

	it('reports affected rows for update and delete statements', async () => {
		await client.exec('CREATE TABLE samples (id TEXT PRIMARY KEY, value INTEGER NOT NULL)');
		await client.run('INSERT INTO samples (id, value) VALUES (?, ?)', ['one', 1]);
		expect(await client.run('UPDATE samples SET value = ? WHERE id = ?', [2, 'one'])).toEqual({
			changes: 1
		});
		expect(await client.run('DELETE FROM samples WHERE id = ?', ['one'])).toEqual({ changes: 1 });
	});
});
