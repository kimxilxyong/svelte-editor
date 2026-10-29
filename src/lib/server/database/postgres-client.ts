/**
 * @fileoverview PostgreSQL adapter for the backend-neutral SqlClient contract.
 *
 * Ordinary calls use the pool directly, while transaction callbacks reserve one pooled connection
 * for their full duration. The same adapter accepts a small pool-like interface so tests can run it
 * against PGlite without a network database.
 */

import { Pool } from 'pg';
import type { RunResult, SqlClient, SqlParam, SqlRow } from './types.js';

/** Result shape required from a PostgreSQL-compatible pool. */
export type PgQueryResult = {
	rows: SqlRow[];
	rowCount: number | null;
};

/** A dedicated connection returned by a PostgreSQL-compatible pool. */
export type PgConnectionLike = {
	query(text: string, params?: SqlParam[]): Promise<PgQueryResult>;
	release(): void;
};

/**
 * Small subset of `pg.Pool` consumed by this adapter.
 *
 * @example
 * const client = createPostgresClient(pool);
 */
export type PgPoolLike = {
	query(text: string, params?: SqlParam[]): Promise<PgQueryResult>;
	connect(): Promise<PgConnectionLike>;
	end(): Promise<void>;
};

/** Options for creating the production `pg.Pool`. */
export type PostgresClientOptions = {
	/** Maximum number of concurrent connections. Defaults to 10. */
	max?: number;
	/** Maximum wait for a new connection, in milliseconds. Defaults to 5000. */
	connectionTimeoutMillis?: number;
};

/**
 * Rewrites portable `?` placeholders to PostgreSQL's `$n` syntax.
 *
 * Question marks inside single-quoted SQL strings are preserved. Doubled single quotes are handled
 * as escapes so a literal such as `'it''s ?'` does not shift subsequent parameter numbering.
 *
 * @param sql - SQL that uses portable question-mark placeholders.
 * @returns SQL with each placeholder numbered from `$1`.
 * @example
 * rewritePlaceholders("SELECT '?' AS literal, ? AS value");
 * // "SELECT '?' AS literal, $1 AS value"
 */
function rewritePlaceholders(sql: string): string {
	let rewritten = '';
	let inString = false;
	let parameterIndex = 0;

	for (let index = 0; index < sql.length; index += 1) {
		const character = sql[index];
		if (character === "'") {
			rewritten += character;
			if (inString && sql[index + 1] === "'") {
				rewritten += sql[index + 1];
				index += 1;
			} else {
				inString = !inString;
			}
			continue;
		}

		if (character === '?' && !inString) {
			parameterIndex += 1;
			rewritten += `$${parameterIndex}`;
		} else {
			rewritten += character;
		}
	}

	return rewritten;
}

/** Client used within a transaction; the reserved connection is owned by its parent transaction. */
class PostgresTransactionClient implements SqlClient {
	readonly backend = 'postgres' as const;

	constructor(private readonly connection: PgConnectionLike) {}

	async all<T extends SqlRow = SqlRow>(sql: string, params?: SqlParam[]): Promise<T[]> {
		const result = await this.connection.query(rewritePlaceholders(sql), params);
		return result.rows as T[];
	}

	async get<T extends SqlRow = SqlRow>(sql: string, params?: SqlParam[]): Promise<T | undefined> {
		return (await this.all<T>(sql, params))[0];
	}

	async run(sql: string, params?: SqlParam[]): Promise<RunResult> {
		const result = await this.connection.query(rewritePlaceholders(sql), params);
		return { changes: Number(result.rowCount ?? 0) };
	}

	async exec(sql: string): Promise<void> {
		await this.connection.query(rewritePlaceholders(sql));
	}

	/** Nested transactions reuse the transaction already active on this connection. */
	async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
		return fn(this);
	}

	async close(): Promise<void> {
		throw new Error('A transaction client cannot be closed.');
	}
}

/**
 * Creates a PostgreSQL SqlClient over any pool with the small {@link PgPoolLike} interface.
 *
 * @param pool - PostgreSQL-compatible pool; ownership transfers to the returned client.
 * @returns An asynchronous SqlClient using `?` placeholders.
 * @throws {Error} If a query or transaction fails.
 * @example
 * const db = createPostgresClient(pool);
 * await db.run('INSERT INTO task (id, title) VALUES (?, ?)', ['one', 'First']);
 */
export function createPostgresClient(pool: PgPoolLike): SqlClient {
	let closed = false;

	function assertOpen(): void {
		if (closed) throw new Error('The database connection is closed.');
	}

	return {
		backend: 'postgres',
		async all<T extends SqlRow = SqlRow>(sql: string, params?: SqlParam[]): Promise<T[]> {
			assertOpen();
			const result = await pool.query(rewritePlaceholders(sql), params);
			return result.rows as T[];
		},
		async get<T extends SqlRow = SqlRow>(sql: string, params?: SqlParam[]): Promise<T | undefined> {
			return (await this.all<T>(sql, params))[0];
		},
		async run(sql: string, params?: SqlParam[]): Promise<RunResult> {
			assertOpen();
			const result = await pool.query(rewritePlaceholders(sql), params);
			return { changes: Number(result.rowCount ?? 0) };
		},
		async exec(sql: string): Promise<void> {
			assertOpen();
			await pool.query(rewritePlaceholders(sql));
		},
		async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
			assertOpen();
			const connection = await pool.connect();
			let transactionStarted = false;
			try {
				await connection.query('BEGIN');
				transactionStarted = true;
				const result = await fn(new PostgresTransactionClient(connection));
				await connection.query('COMMIT');
				transactionStarted = false;
				return result;
			} catch (error) {
				if (transactionStarted) {
					try {
						await connection.query('ROLLBACK');
					} catch {
						// Preserve the original transaction failure if rollback itself also fails.
					}
				}
				throw error;
			} finally {
				connection.release();
			}
		},
		async close(): Promise<void> {
			if (!closed) {
				closed = true;
				await pool.end();
			}
		}
	};
}

/**
 * Chooses the TLS setting for a connection URL. An explicit `sslmode` in the URL always wins (the
 * `pg` driver interprets it); otherwise remote hosts get verified TLS so credentials and data are
 * never sent in clear text, while loopback hosts (local development) stay unencrypted.
 *
 * @param url - PostgreSQL connection URL.
 * @returns A `pg` `ssl` option, or `undefined` to defer to the URL.
 */
function sslFor(url: string): { rejectUnauthorized: true } | undefined {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}
	if (parsed.searchParams.has('sslmode') || parsed.searchParams.has('ssl')) return undefined;
	const host = parsed.hostname.replace(/^\[|\]$/g, '');
	const local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '';
	return local ? undefined : { rejectUnauthorized: true };
}

/**
 * Opens a pooled PostgreSQL connection using the required production defaults.
 *
 * @param url - A `postgres://` or `postgresql://` connection URL.
 * @param options - Optional pool sizing and connection timeout overrides.
 * @returns A ready-to-use PostgreSQL SqlClient.
 * @example
 * const db = openPostgresClient(process.env.DATABASE_URL!);
 */
export function openPostgresClient(url: string, options: PostgresClientOptions = {}): SqlClient {
	const pool = new Pool({
		connectionString: url,
		ssl: sslFor(url),
		max: options.max ?? 10,
		connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5000
	});
	return createPostgresClient(pool as unknown as PgPoolLike);
}
