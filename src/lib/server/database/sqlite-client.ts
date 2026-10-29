/**
 * @fileoverview SQLite adapter for the portable {@link SqlClient} interface, based on Node's built-in
 * `node:sqlite` (`DatabaseSync`).
 *
 * `node:sqlite` is synchronous, but callers may interleave `await`s inside a transaction. To keep
 * statements of unrelated requests out of an open transaction, every operation goes through a
 * single-slot async mutex: a transaction holds the lock for its whole duration and hands its callback a
 * "transaction client" that bypasses the lock (it already owns it). Ordinary calls queue behind it.
 *
 * Foreign keys are enabled (`PRAGMA foreign_keys = ON`) so `ON DELETE CASCADE` works, and WAL mode is
 * used for file databases for better read concurrency.
 */

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { RunResult, SqlClient, SqlParam, SqlRow } from './types.js';

/** Minimal FIFO mutex: `lock()` resolves with a release function. */
class Mutex {
	private tail: Promise<void> = Promise.resolve();

	/** Waits for all earlier holders, then returns the function that releases the lock. */
	lock(): Promise<() => void> {
		let release!: () => void;
		const next = new Promise<void>((resolve) => (release = resolve));
		const ready = this.tail.then(() => release);
		this.tail = this.tail.then(() => next);
		return ready;
	}
}

/** Executes statements directly on the handle; used both by the top-level client and inside transactions. */
class SqliteOps {
	constructor(protected readonly db: DatabaseSync) {}

	protected allSync<T extends SqlRow>(sql: string, params: SqlParam[] = []): T[] {
		return this.db.prepare(sql).all(...(params as SQLInputValue[])) as T[];
	}

	protected runSync(sql: string, params: SqlParam[] = []): RunResult {
		const result = this.db.prepare(sql).run(...(params as SQLInputValue[]));
		return { changes: Number(result.changes) };
	}
}

/** Client handed to transaction callbacks: no locking (the outer transaction owns it). */
class SqliteTransactionClient extends SqliteOps implements SqlClient {
	readonly backend = 'sqlite' as const;

	async all<T extends SqlRow = SqlRow>(sql: string, params?: SqlParam[]): Promise<T[]> {
		return this.allSync<T>(sql, params);
	}
	async get<T extends SqlRow = SqlRow>(sql: string, params?: SqlParam[]): Promise<T | undefined> {
		return this.allSync<T>(sql, params)[0];
	}
	async run(sql: string, params?: SqlParam[]): Promise<RunResult> {
		return this.runSync(sql, params);
	}
	async exec(sql: string): Promise<void> {
		this.db.exec(sql);
	}
	/** Nested transactions reuse the outer one. */
	async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
		return fn(this);
	}
	async close(): Promise<void> {
		throw new Error('A transaction client cannot be closed.');
	}
}

/** Top-level SQLite client; every call is serialised through the mutex. */
class SqliteClient extends SqliteOps implements SqlClient {
	readonly backend = 'sqlite' as const;
	private readonly mutex = new Mutex();
	private closed = false;

	private async locked<T>(work: () => T): Promise<T> {
		const release = await this.mutex.lock();
		try {
			if (this.closed) throw new Error('The database connection is closed.');
			return work();
		} finally {
			release();
		}
	}

	all<T extends SqlRow = SqlRow>(sql: string, params?: SqlParam[]): Promise<T[]> {
		return this.locked(() => this.allSync<T>(sql, params));
	}
	async get<T extends SqlRow = SqlRow>(sql: string, params?: SqlParam[]): Promise<T | undefined> {
		return (await this.all<T>(sql, params))[0];
	}
	run(sql: string, params?: SqlParam[]): Promise<RunResult> {
		return this.locked(() => this.runSync(sql, params));
	}
	exec(sql: string): Promise<void> {
		return this.locked(() => this.db.exec(sql));
	}

	async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
		const release = await this.mutex.lock();
		try {
			if (this.closed) throw new Error('The database connection is closed.');
			this.db.exec('BEGIN IMMEDIATE');
			try {
				const result = await fn(new SqliteTransactionClient(this.db));
				this.db.exec('COMMIT');
				return result;
			} catch (error) {
				this.db.exec('ROLLBACK');
				throw error;
			}
		} finally {
			release();
		}
	}

	async close(): Promise<void> {
		const release = await this.mutex.lock();
		try {
			if (!this.closed) {
				this.closed = true;
				this.db.close();
			}
		} finally {
			release();
		}
	}
}

/**
 * Opens (and creates if necessary) a SQLite database.
 *
 * @param path - File path, or `:memory:` for a private in-memory database (used by tests).
 * @returns A ready-to-use client with foreign keys enabled.
 * @example
 * const db = openSqliteClient(':memory:');
 */
export function openSqliteClient(path: string): SqlClient {
	const db = new DatabaseSync(path);
	db.exec('PRAGMA foreign_keys = ON');
	if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
	return new SqliteClient(db);
}
