/**
 * @fileoverview Selects, initializes, tests and switches the application's active database backend.
 *
 * Backend configuration lives independently of either database in a mode-0600 JSON file, allowing
 * an administrator to switch away from a database that is unavailable. The lazy singleton ensures
 * the shared schema once, while backend switches are serialized and only become active after the
 * target is ready and its configuration has been atomically persisted.
 */

import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseConfig, SqlClient, SqlParam, SqlRow } from './types.js';
import { copyOrder, ensureSchema } from './schema.js';
import { openPostgresClient } from './postgres-client.js';
import { openSqliteClient } from './sqlite-client.js';

/** How the currently active backend configuration was selected. */
export type BackendConfigSource = 'config-file' | 'env' | 'default';

/** Safe status information that may be returned to an administrator's browser. */
export type BackendInfo = {
	backend: DatabaseConfig['backend'];
	location: string;
	source: BackendConfigSource;
	serverVersion?: string;
	userCount: number;
	pageSaved: boolean;
};

/** Public result from a connection test. It intentionally contains no connection URL. */
export type ConnectionTestResult = {
	ok: boolean;
	error?: string;
	serverVersion?: string;
	hasSchema: boolean;
	userCount: number;
	adminCount: number;
};

/** Identity recorded in the audit log when a backend switch is performed. */
export type DatabaseSwitchActor = { id: string; label: string } | null;

/** Options controlling what to do with existing data in the target database. */
export type DatabaseSwitchOptions = {
	dataMode: 'copy' | 'replace' | 'keep';
	actor: DatabaseSwitchActor;
};

/** Result of a successful backend switch. */
export type DatabaseSwitchResult = {
	backend: DatabaseConfig['backend'];
	copied: Record<string, number>;
};

type ClientFactory = (config: DatabaseConfig) => SqlClient | Promise<SqlClient>;
type ResolvedConfig = { config: DatabaseConfig; source: BackendConfigSource };

const defaultSqlitePath = 'local.db';
const schemaTableNames = [...copyOrder];
let activeClient: SqlClient | null = null;
let activeConfig: DatabaseConfig | null = null;
let activeSource: BackendConfigSource | null = null;
let initialization: Promise<SqlClient> | null = null;
let clientFactoryForTests: ClientFactory | null = null;
let switchQueue: Promise<void> = Promise.resolve();

function configFilePath(): string {
	const configuredPath = process.env.DB_CONFIG_PATH;
	return path.resolve(process.cwd(), configuredPath || '.data/db-config.json');
}

/**
 * Validates and normalizes untrusted backend configuration.
 *
 * SQLite paths are resolved relative to the current working directory and must point into an
 * existing parent directory. PostgreSQL URLs are syntax-checked here but are never connected to.
 *
 * @param untrusted - Value from a request, config file or environment variable.
 * @returns A normalized and validated backend configuration.
 * @throws {Error} If the backend, URL or SQLite path is invalid.
 * @example
 * parseDatabaseConfig({ backend: 'sqlite', sqlitePath: 'local.db' });
 */
export function parseDatabaseConfig(untrusted: unknown): DatabaseConfig {
	if (typeof untrusted !== 'object' || untrusted === null || Array.isArray(untrusted)) {
		throw new Error('Database configuration must be an object.');
	}

	const value = untrusted as Record<string, unknown>;
	if (value.backend === 'sqlite') {
		if (typeof value.sqlitePath !== 'string') {
			throw new Error('SQLite configuration requires a file path.');
		}
		const rawPath = value.sqlitePath.trim();
		if (!rawPath || rawPath.length > 300 || rawPath.includes('\0') || rawPath === ':memory:') {
			throw new Error('SQLite path must be a non-empty file path of at most 300 characters.');
		}
		const sqlitePath = path.resolve(process.cwd(), rawPath);
		const parent = path.dirname(sqlitePath);
		try {
			if (!statSync(parent).isDirectory()) throw new Error('not a directory');
		} catch {
			throw new Error('The parent directory for the SQLite database must already exist.');
		}
		return { backend: 'sqlite', sqlitePath };
	}

	if (value.backend === 'postgres') {
		if (typeof value.postgresUrl !== 'string' || value.postgresUrl.length === 0) {
			throw new Error('PostgreSQL configuration requires a connection URL.');
		}
		let url: URL;
		try {
			url = new URL(value.postgresUrl);
		} catch {
			throw new Error('PostgreSQL URL is invalid.');
		}
		if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) {
			throw new Error('PostgreSQL URL must use postgres:// or postgresql:// and include a host.');
		}
		return { backend: 'postgres', postgresUrl: value.postgresUrl };
	}

	throw new Error('Database backend must be sqlite or postgres.');
}

/**
 * Returns a display-safe location string for a backend configuration.
 *
 * PostgreSQL usernames, passwords, query parameters and fragments are omitted; only a masked host,
 * port and database path are shown. SQLite file paths contain no connection credentials.
 *
 * @param config - Valid backend configuration.
 * @returns A non-secret location suitable for an administrator UI.
 * @example
 * maskConfig({ backend: 'postgres', postgresUrl: 'postgres://db.example/app' });
 * // '******db.example:5432/app'
 */
export function maskConfig(config: DatabaseConfig): string {
	if (config.backend === 'sqlite') return config.sqlitePath;
	const url = new URL(config.postgresUrl);
	const port = url.port || '5432';
	return `******${url.hostname}:${port}${url.pathname}`;
}

async function resolveConfig(): Promise<ResolvedConfig> {
	const filename = configFilePath();
	try {
		const serialized = await readFile(filename, 'utf8');
		const config = parseDatabaseConfig(JSON.parse(serialized) as unknown);
		await chmod(filename, 0o600);
		return { config, source: 'config-file' };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			if (error instanceof SyntaxError)
				throw new Error('The database config file contains invalid JSON.', { cause: error });
			throw error;
		}
	}

	const databaseUrl = process.env.DATABASE_URL;
	if (databaseUrl) {
		const config = /^postgres(?:ql)?:\/\//i.test(databaseUrl)
			? parseDatabaseConfig({ backend: 'postgres', postgresUrl: databaseUrl })
			: parseDatabaseConfig({ backend: 'sqlite', sqlitePath: databaseUrl });
		return { config, source: 'env' };
	}

	return {
		config: parseDatabaseConfig({ backend: 'sqlite', sqlitePath: defaultSqlitePath }),
		source: 'default'
	};
}

async function openClient(config: DatabaseConfig): Promise<SqlClient> {
	if (clientFactoryForTests) return clientFactoryForTests(config);
	return config.backend === 'sqlite'
		? openSqliteClient(config.sqlitePath)
		: openPostgresClient(config.postgresUrl);
}

/**
 * Lazily opens the selected backend and ensures the application schema exactly once.
 *
 * Concurrent first callers share the same initialization promise, preventing duplicate pools or
 * races while creating tables. Each returned client is safe for concurrent repository operations.
 *
 * @returns The initialized active database client.
 * @throws {Error} If configuration, connection or schema initialization fails.
 * @example
 * const db = await getDatabase();
 * const users = await db.all('SELECT id FROM users');
 */
export async function getDatabase(): Promise<SqlClient> {
	if (activeClient) return activeClient;
	if (!initialization) {
		initialization = (async () => {
			const resolved = await resolveConfig();
			const client = await openClient(resolved.config);
			try {
				await ensureSchema(client);
				activeClient = client;
				activeConfig = resolved.config;
				activeSource = resolved.source;
				return client;
			} catch (error) {
				await client.close().catch(() => undefined);
				throw error;
			}
		})();
	}

	const currentInitialization = initialization;
	try {
		return await currentInitialization;
	} finally {
		if (initialization === currentInitialization) initialization = null;
	}
}

/**
 * Gets the current backend configuration without exposing credentials.
 *
 * If the database has not yet been opened, configuration is resolved using the normal precedence
 * (config file, environment, then default) without opening a connection.
 *
 * @returns A validated active backend configuration.
 * @throws {Error} If persisted or environment configuration is invalid.
 * @example
 * const config = await getActiveConfig();
 * if (config.backend === 'sqlite') console.log(config.sqlitePath);
 */
export async function getActiveConfig(): Promise<DatabaseConfig> {
	if (activeConfig) return activeConfig;
	return (await resolveConfig()).config;
}

async function queryVersion(client: SqlClient): Promise<string | undefined> {
	const row =
		client.backend === 'sqlite'
			? await client.get<SqlRow>('SELECT sqlite_version() AS version')
			: await client.get<SqlRow>('SELECT version() AS version');
	return typeof row?.version === 'string' ? row.version : undefined;
}

async function inspectSchema(client: SqlClient): Promise<boolean> {
	const rows =
		client.backend === 'sqlite'
			? await client.all<SqlRow>("SELECT name FROM sqlite_master WHERE type = 'table'")
			: await client.all<SqlRow>(
					'SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()'
				);
	const names = new Set(rows.map((row) => row.name ?? row.table_name));
	return schemaTableNames.every((table) => names.has(table));
}

async function readCounts(client: SqlClient): Promise<{ userCount: number; adminCount: number }> {
	const users = await client.get<SqlRow>('SELECT CAST(COUNT(*) AS INTEGER) AS count FROM users');
	const admins = await client.get<SqlRow>(
		"SELECT CAST(COUNT(*) AS INTEGER) AS count FROM users WHERE role = 'admin' AND disabled = 0"
	);
	return { userCount: Number(users?.count ?? 0), adminCount: Number(admins?.count ?? 0) };
}

function safeErrorMessage(error: unknown, config: DatabaseConfig): string {
	let message = error instanceof Error ? error.message : 'Unable to connect to the database.';
	if (config.backend === 'postgres') {
		const url = new URL(config.postgresUrl);
		for (const credential of [url.username, url.password]) {
			if (!credential) continue;
			message = message.split(credential).join('[redacted]');
			try {
				message = message.split(decodeURIComponent(credential)).join('[redacted]');
			} catch {
				// URL parsing already validated the connection string; keep sanitization best-effort.
			}
		}
		message = message.replace(
			/password authentication failed for user [^,;]+/gi,
			'password authentication failed'
		);
		message = message.replace(/\b(user|password)=([^,\s]+)/gi, '$1=[redacted]');
		message = message.split(config.postgresUrl).join('[redacted]');
	}
	return message.replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[redacted]');
}

/**
 * Tests a backend connection without creating or changing any tables.
 *
 * The temporary client is always closed. Schema and account counts are inspected only when all
 * expected application tables are already present.
 *
 * @param untrusted - Candidate backend configuration.
 * @returns Connection status and schema counts, without credentials.
 * @throws {Error} If the candidate configuration itself is invalid.
 * @example
 * const result = await testConnection({ backend: 'sqlite', sqlitePath: './local.db' });
 */
export async function testConnection(untrusted: DatabaseConfig): Promise<ConnectionTestResult> {
	const config = parseDatabaseConfig(untrusted);
	let client: SqlClient | null = null;
	try {
		client = await openClient(config);
		const serverVersion = await queryVersion(client);
		const hasSchema = await inspectSchema(client);
		const counts = hasSchema ? await readCounts(client) : { userCount: 0, adminCount: 0 };
		return { ok: true, serverVersion, hasSchema, ...counts };
	} catch (error) {
		return {
			ok: false,
			error: safeErrorMessage(error, config),
			hasSchema: false,
			userCount: 0,
			adminCount: 0
		};
	} finally {
		if (client) await client.close().catch(() => undefined);
	}
}

/**
 * Describes the active backend using only browser-safe information.
 *
 * @returns Current backend, masked location, source, server version, user count and saved-page flag.
 * @throws {Error} If the active connection cannot be initialized or queried.
 * @example
 * const status = await describeActiveBackend();
 * console.log(status.backend, status.location);
 */
export async function describeActiveBackend(): Promise<BackendInfo> {
	const client = await getDatabase();
	const config = activeConfig ?? (await resolveConfig()).config;
	const source = activeSource ?? (await resolveConfig()).source;
	const [serverVersion, counts, savedPage] = await Promise.all([
		queryVersion(client),
		readCounts(client),
		client.get<SqlRow>("SELECT id FROM editor_page WHERE id IN ('site', 'home') LIMIT 1")
	]);
	return {
		backend: config.backend,
		location: maskConfig(config),
		source,
		serverVersion,
		userCount: counts.userCount,
		pageSaved: savedPage !== undefined
	};
}

async function persistConfig(config: DatabaseConfig): Promise<void> {
	const filename = configFilePath();
	const directory = path.dirname(filename);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const temporaryPath = `${filename}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
			mode: 0o600,
			flag: 'wx'
		});
		await chmod(temporaryPath, 0o600);
		await rename(temporaryPath, filename);
	} catch (error) {
		await rm(temporaryPath, { force: true }).catch(() => undefined);
		throw error;
	}
}

function sameConfig(left: DatabaseConfig | null, right: DatabaseConfig): boolean {
	if (!left || left.backend !== right.backend) return false;
	return left.backend === 'sqlite'
		? right.backend === 'sqlite' && left.sqlitePath === right.sqlitePath
		: right.backend === 'postgres' && left.postgresUrl === right.postgresUrl;
}

function quoteIdentifier(identifier: string): string {
	return `"${identifier.replaceAll('"', '""')}"`;
}

function asSqlParam(value: unknown, table: string, column: string): SqlParam {
	if (value === null || typeof value === 'string' || typeof value === 'number') return value;
	throw new Error(`Unsupported value while copying ${table}.${column}.`);
}

async function copyData(
	source: SqlClient,
	target: SqlClient,
	dataMode: 'copy' | 'replace'
): Promise<Record<string, number>> {
	const snapshot = await source.transaction(async (tx) => {
		const rows: Record<string, SqlRow[]> = {};
		for (const table of copyOrder)
			rows[table] = await tx.all(`SELECT * FROM ${quoteIdentifier(table)}`);
		return rows;
	});
	const copied: Record<string, number> = Object.fromEntries(copyOrder.map((table) => [table, 0]));

	await target.transaction(async (tx) => {
		if (dataMode === 'copy') {
			const existing = await tx.get<SqlRow>('SELECT CAST(COUNT(*) AS INTEGER) AS count FROM users');
			if (Number(existing?.count ?? 0) !== 0) {
				throw new Error('Copy requires the target users table to be empty.');
			}
		} else {
			for (const table of [...copyOrder].reverse()) {
				await tx.run(`DELETE FROM ${quoteIdentifier(table)}`);
			}
		}

		for (const table of copyOrder) {
			for (const row of snapshot[table]) {
				const columns = Object.keys(row);
				if (columns.length === 0) continue;
				const placeholders = columns.map(() => '?').join(', ');
				const columnList = columns.map(quoteIdentifier).join(', ');
				const values = columns.map((column) => asSqlParam(row[column], table, column));
				await tx.run(
					`INSERT INTO ${quoteIdentifier(table)} (${columnList}) VALUES (${placeholders})`,
					values
				);
				copied[table] += 1;
			}
		}
	});

	return copied;
}

async function recordSwitchAudit(
	client: SqlClient,
	actor: DatabaseSwitchActor,
	backend: DatabaseConfig['backend'],
	dataMode: DatabaseSwitchOptions['dataMode']
): Promise<void> {
	try {
		await client.run(
			`INSERT INTO audit_log (id, at, actor_id, actor_label, action, target, detail)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[
				randomUUID(),
				new Date().toISOString(),
				actor?.id ?? null,
				actor?.label ?? null,
				'db_switch',
				backend,
				JSON.stringify({ dataMode })
			]
		);
	} catch (error) {
		console.warn('Unable to record the database switch in the audit log.', error);
	}
}

async function performSwitch(
	untrusted: DatabaseConfig,
	options: DatabaseSwitchOptions
): Promise<DatabaseSwitchResult> {
	const config = parseDatabaseConfig(untrusted);
	const source = await getDatabase();
	const sourceConfig = activeConfig;

	if (sameConfig(sourceConfig, config)) {
		if (options.dataMode === 'keep') {
			const counts = await readCounts(source);
			if (counts.adminCount < 1)
				throw new Error('Keep requires at least one active admin in the target database.');
		}
		await persistConfig(config);
		activeConfig = config;
		activeSource = 'config-file';
		return { backend: config.backend, copied: {} };
	}

	const target = await openClient(config);
	try {
		await ensureSchema(target);
		let copied: Record<string, number> = {};
		if (options.dataMode === 'copy' || options.dataMode === 'replace') {
			copied = await copyData(source, target, options.dataMode);
		} else {
			const counts = await readCounts(target);
			if (counts.adminCount < 1) {
				throw new Error('Keep requires at least one active admin in the target database.');
			}
		}

		await persistConfig(config);
		activeClient = target;
		activeConfig = config;
		activeSource = 'config-file';
		await source.close().catch((error) => {
			console.warn('Unable to close the previous database connection after switching.', error);
		});
		await recordSwitchAudit(target, options.actor, config.backend, options.dataMode);
		return { backend: config.backend, copied };
	} catch (error) {
		await target.close().catch(() => undefined);
		throw error;
	}
}

/**
 * Switches backends after applying the selected data policy.
 *
 * Switches are serialized. The target schema and migration complete before configuration is written;
 * any pre-activation failure closes the target and leaves the current backend active. `copy` requires
 * no users on the target, `replace` clears target tables in reverse dependency order, and `keep`
 * requires an active administrator in the target.
 *
 * @param config - Validated target backend configuration.
 * @param options - Data policy and audit actor.
 * @returns New active backend and the number of rows copied per table.
 * @throws {Error} If the target cannot be initialized, policy checks fail or persistence fails.
 * @example
 * await switchBackend(config, { dataMode: 'copy', actor: { id: 'u1', label: 'Admin' } });
 */
export function switchBackend(
	config: DatabaseConfig,
	options: DatabaseSwitchOptions
): Promise<DatabaseSwitchResult> {
	const operation = switchQueue.then(() => performSwitch(config, options));
	switchQueue = operation.then(
		() => undefined,
		() => undefined
	);
	return operation;
}

/**
 * Closes the active client and resets lazy initialization state.
 *
 * This is intended for tests and graceful server shutdown. A later {@link getDatabase} call will
 * resolve configuration and open a fresh client.
 *
 * @returns A promise that resolves after the active pool or file handle is closed.
 * @throws {Error} If the active client's close operation fails.
 * @example
 * await closeDatabase();
 */
export async function closeDatabase(): Promise<void> {
	await switchQueue;
	const pendingInitialization = initialization;
	if (pendingInitialization) await pendingInitialization.catch(() => undefined);
	const client = activeClient;
	activeClient = null;
	activeConfig = null;
	activeSource = null;
	initialization = null;
	if (client) await client.close();
}

/**
 * Installs or clears the client factory used by manager tests.
 *
 * Close the active database before changing the factory; an already-open singleton is intentionally
 * not replaced by this setter.
 *
 * @param factory - Factory for test clients, or `null` to restore the production drivers.
 * @returns Nothing.
 * @example
 * setClientFactoryForTests((config) => makeInMemoryClient(config));
 */
export function setClientFactoryForTests(factory: ClientFactory | null): void {
	clientFactoryForTests = factory;
}
