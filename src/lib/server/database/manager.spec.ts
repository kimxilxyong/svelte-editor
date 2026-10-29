/**
 * @fileoverview Database manager integration specs for validation, connection checks and migration.
 *
 * SQLite databases and manager config files live in a unique ignored `.data` directory per test;
 * PostgreSQL target tests inject the regular adapter backed by PGlite through PgPoolLike.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { ensureSchema } from './schema.js';
import {
	closeDatabase,
	describeActiveBackend,
	getDatabase,
	getActiveConfig,
	maskConfig,
	parseDatabaseConfig,
	setClientFactoryForTests,
	switchBackend,
	testConnection
} from './manager.js';
import { createPostgresClient, type PgPoolLike, type PgQueryResult } from './postgres-client.js';
import { openSqliteClient } from './sqlite-client.js';
import type { SqlParam, SqlRow } from './types.js';

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalConfigPath = process.env.DB_CONFIG_PATH;
let testDirectory = '';

function makePglitePool(database: PGlite): PgPoolLike {
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

function configPath(name: string): string {
	return path.join(testDirectory, name);
}

beforeEach(async () => {
	testDirectory = path.resolve(
		process.cwd(),
		'.data',
		`database-manager-${process.pid}-${randomUUID()}`
	);
	await mkdir(testDirectory, { recursive: true });
	process.env.DB_CONFIG_PATH = configPath('db-config.json');
	delete process.env.DATABASE_URL;
	setClientFactoryForTests(null);
	await closeDatabase();
});

afterEach(async () => {
	await closeDatabase();
	setClientFactoryForTests(null);
	if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = originalDatabaseUrl;
	if (originalConfigPath === undefined) delete process.env.DB_CONFIG_PATH;
	else process.env.DB_CONFIG_PATH = originalConfigPath;
	await rm(testDirectory, { recursive: true, force: true });
});

describe('database configuration', () => {
	it('normalizes SQLite paths and rejects invalid paths or unsupported URL schemes', () => {
		const normalized = parseDatabaseConfig({ backend: 'sqlite', sqlitePath: 'local.sqlite' });
		expect(normalized).toEqual({
			backend: 'sqlite',
			sqlitePath: path.resolve(process.cwd(), 'local.sqlite')
		});
		expect(() =>
			parseDatabaseConfig({ backend: 'sqlite', sqlitePath: '../missing/path/db.sqlite' })
		).toThrow('parent directory');
		expect(() => parseDatabaseConfig({ backend: 'sqlite', sqlitePath: `bad\0path` })).toThrow(
			'SQLite path'
		);
		expect(() =>
			parseDatabaseConfig({ backend: 'postgres', postgresUrl: 'https://db.example/app' })
		).toThrow('postgres://');
	});

	it('masks PostgreSQL credentials, query parameters and fragments', () => {
		expect(
			maskConfig({
				backend: 'postgres',
				postgresUrl: 'postgres://admin:secret@db.example/app?sslpassword=private#fragment'
			})
		).toBe('******db.example:5432/app');
		expect(maskConfig({ backend: 'sqlite', sqlitePath: '/workspace/local.db' })).toBe(
			'/workspace/local.db'
		);
	});
});

describe('database connection testing', () => {
	it('connects to SQLite without creating schema and reports an existing schema', async () => {
		const filename = configPath('connection.sqlite');
		const blank = await testConnection({ backend: 'sqlite', sqlitePath: filename });
		expect(blank).toMatchObject({ ok: true, hasSchema: false, userCount: 0, adminCount: 0 });

		const seeded = openSqliteClient(filename);
		await ensureSchema(seeded);
		await seeded.run(
			`INSERT INTO users (id, name, role, disabled, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)`,
			[
				'admin-1',
				'Administrator',
				'admin',
				0,
				'2026-01-01T00:00:00.000Z',
				'2026-01-01T00:00:00.000Z'
			]
		);
		await seeded.close();
		const existing = await testConnection({ backend: 'sqlite', sqlitePath: filename });
		expect(existing).toMatchObject({ ok: true, hasSchema: true, userCount: 1, adminCount: 1 });
		expect(existing.serverVersion).toBeDefined();
	});

	it('closes the PGlite-backed PostgreSQL client after checking a blank schema', async () => {
		let closed = false;
		setClientFactoryForTests((config) => {
			expect(config.backend).toBe('postgres');
			const database = new PGlite();
			const pool = makePglitePool(database);
			return {
				...createPostgresClient(pool),
				async close() {
					closed = true;
					await pool.end();
				}
			};
		});
		const result = await testConnection({
			backend: 'postgres',
			postgresUrl: 'postgres://test:test@localhost/test'
		});
		expect(result).toMatchObject({ ok: true, hasSchema: false, userCount: 0, adminCount: 0 });
		expect(result.serverVersion).toContain('PostgreSQL');
		expect(closed).toBe(true);
	});
});

describe('backend switching', () => {
	it('copies a SQLite database into PGlite and activates the credential-masked config', async () => {
		const sourcePath = configPath('source.sqlite');
		process.env.DATABASE_URL = sourcePath;
		const postgresqlClients: PGlite[] = [];
		setClientFactoryForTests((config) => {
			if (config.backend === 'sqlite') return openSqliteClient(config.sqlitePath);
			const engine = new PGlite();
			postgresqlClients.push(engine);
			return createPostgresClient(makePglitePool(engine));
		});

		const source = await getDatabase();
		await source.run(
			`INSERT INTO users (id, email, email_verified, name, role, disabled, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				'user-1',
				'admin@example.test',
				1,
				'Administrator',
				'admin',
				0,
				'2026-01-01T00:00:00.000Z',
				'2026-01-01T00:00:00.000Z'
			]
		);
		await source.run('INSERT INTO editor_page (id, blocks, updated_at) VALUES (?, ?, ?)', [
			'site',
			'{"pages":[]}',
			'2026-01-01T00:00:00.000Z'
		]);

		const result = await switchBackend(
			{ backend: 'postgres', postgresUrl: 'postgres://admin:topsecret@pglite.local/app' },
			{ dataMode: 'copy', actor: { id: 'user-1', label: 'Administrator' } }
		);
		expect(result.backend).toBe('postgres');
		expect(result.copied.users).toBe(1);
		expect(result.copied.editor_page).toBe(1);
		expect(await getActiveConfig()).toEqual({
			backend: 'postgres',
			postgresUrl: 'postgres://admin:topsecret@pglite.local/app'
		});

		const active = await getDatabase();
		expect(active.backend).toBe('postgres');
		expect(await active.get<SqlRow>('SELECT email FROM users WHERE id = ?', ['user-1'])).toEqual({
			email: 'admin@example.test'
		});
		const status = await describeActiveBackend();
		expect(status).toMatchObject({
			backend: 'postgres',
			location: '******pglite.local:5432/app',
			source: 'config-file',
			userCount: 1,
			pageSaved: true
		});
		expect(JSON.stringify(status)).not.toContain('test-user');

		const persisted = await readFile(configPath('db-config.json'), 'utf8');
		expect(persisted).not.toContain('******');
		expect((await stat(configPath('db-config.json'))).mode & 0o777).toBe(0o600);
		expect(postgresqlClients).toHaveLength(1);
	});

	it('copies between SQLite files and protects an existing active target', async () => {
		const sourcePath = configPath('source.sqlite');
		const targetPath = configPath('target.sqlite');
		process.env.DATABASE_URL = sourcePath;
		const source = await getDatabase();
		await source.run('INSERT INTO task (id, title, priority) VALUES (?, ?, ?)', [
			'task-1',
			'Source task',
			2
		]);

		const result = await switchBackend(
			{ backend: 'sqlite', sqlitePath: targetPath },
			{ dataMode: 'copy', actor: null }
		);
		expect(result.copied.task).toBe(1);
		expect(
			await (await getDatabase()).get<SqlRow>('SELECT title FROM task WHERE id = ?', ['task-1'])
		).toEqual({
			title: 'Source task'
		});

		const beforeFailedSwitch = await getDatabase();
		await expect(
			switchBackend(
				{ backend: 'sqlite', sqlitePath: path.join(testDirectory, 'invalid', 'target.sqlite') },
				{ dataMode: 'keep', actor: null }
			)
		).rejects.toThrow('parent directory');
		expect(await getDatabase()).toBe(beforeFailedSwitch);
	});

	it('replaces target contents atomically and requires an active admin for keep', async () => {
		const sourcePath = configPath('source.sqlite');
		const targetPath = configPath('target.sqlite');
		process.env.DATABASE_URL = sourcePath;
		const source = await getDatabase();
		await source.run('INSERT INTO task (id, title, priority) VALUES (?, ?, ?)', [
			'source',
			'Source',
			1
		]);

		const preexisting = openSqliteClient(targetPath);
		await ensureSchema(preexisting);
		await preexisting.run('INSERT INTO task (id, title, priority) VALUES (?, ?, ?)', [
			'old',
			'Old target',
			1
		]);
		await preexisting.close();

		const replacement = await switchBackend(
			{ backend: 'sqlite', sqlitePath: targetPath },
			{ dataMode: 'replace', actor: null }
		);
		expect(replacement.copied.task).toBe(1);
		const target = await getDatabase();
		expect(await target.get<SqlRow>('SELECT id FROM task WHERE id = ?', ['old'])).toBeUndefined();
		expect(await target.get<SqlRow>('SELECT id FROM task WHERE id = ?', ['source'])).toEqual({
			id: 'source'
		});

		const keepTargetPath = configPath('keep.sqlite');
		const keepTarget = openSqliteClient(keepTargetPath);
		await ensureSchema(keepTarget);
		await keepTarget.close();
		await expect(
			switchBackend(
				{ backend: 'sqlite', sqlitePath: keepTargetPath },
				{ dataMode: 'keep', actor: null }
			)
		).rejects.toThrow('active admin');
		expect((await getDatabase()).backend).toBe('sqlite');
	});
});
