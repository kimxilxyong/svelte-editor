/**
 * @fileoverview Backend-neutral SQL client contract used by every server-side repository.
 *
 * The application can run on **SQLite** (zero-config, default) or **PostgreSQL**. The admin picks the
 * backend at runtime (`/admin`). To make that possible all persistence code is written against the
 * small {@link SqlClient} interface below instead of a specific driver. Two adapters implement it:
 * `sqlite-client.ts` (`node:sqlite`) and `postgres-client.ts` (`pg`).
 *
 * ## Portable SQL dialect (rules for every query in this code base)
 * 1. Placeholders are `?`. The Postgres adapter rewrites them to `$1, $2, …`, so never put a literal
 *    `?` inside a string constant.
 * 2. Column types are only `TEXT` and `INTEGER`. Timestamps are ISO-8601 strings (`new Date().toISOString()`,
 *    sortable as text), booleans are `0`/`1`. This avoids driver differences (e.g. `pg` returns
 *    `BIGINT`/`TIMESTAMPTZ` as strings/Dates).
 * 3. Upserts use `INSERT … ON CONFLICT (col) DO UPDATE SET x = excluded.x` (valid in both).
 * 4. Case-insensitive search: `LOWER(col) LIKE ?` (Postgres `LIKE` is case sensitive).
 * 5. Aggregates must be cast: `CAST(COUNT(*) AS INTEGER)` (Postgres returns `bigint` as a string).
 * 6. Result column names are lower-case `snake_case` (Postgres folds unquoted identifiers to lower case).
 * 7. Booleans, dates and JSON are converted by the repository layer – the client returns raw column values.
 */

/** Supported storage backends. */
export type DatabaseBackend = 'sqlite' | 'postgres';

/**
 * Persisted/selected database configuration (see `manager.ts`).
 * The Postgres URL contains credentials and must never be sent to the browser.
 */
export type DatabaseConfig =
	{ backend: 'sqlite'; sqlitePath: string } | { backend: 'postgres'; postgresUrl: string };

/** Values that may be bound to a `?` placeholder. */
export type SqlParam = string | number | null;

/** A row as returned by the drivers: column name → raw value. */
export type SqlRow = Record<string, unknown>;

/** Outcome of a data-modifying statement. */
export type RunResult = {
	/** Number of rows inserted/updated/deleted. */
	changes: number;
};

/**
 * Minimal asynchronous SQL client. Implementations must be safe to call concurrently from many
 * requests; {@link SqlClient.transaction} gives the callback an exclusive transactional client.
 */
export interface SqlClient {
	/** Which driver sits behind this client. */
	readonly backend: DatabaseBackend;

	/**
	 * Runs a query and returns all rows.
	 * @param sql - Portable SQL with `?` placeholders.
	 * @param params - Values for the placeholders, in order.
	 */
	all<T extends SqlRow = SqlRow>(sql: string, params?: SqlParam[]): Promise<T[]>;

	/** Runs a query and returns the first row, or `undefined` if there is none. */
	get<T extends SqlRow = SqlRow>(sql: string, params?: SqlParam[]): Promise<T | undefined>;

	/** Runs an INSERT/UPDATE/DELETE and reports the number of affected rows. */
	run(sql: string, params?: SqlParam[]): Promise<RunResult>;

	/** Runs one or more statements without parameters (used for DDL). */
	exec(sql: string): Promise<void>;

	/**
	 * Runs `fn` inside a transaction: committed when it resolves, rolled back when it throws.
	 * Calls on the passed-in client participate in the same transaction; nested `transaction` calls
	 * simply reuse the outer transaction.
	 */
	transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>;

	/** Releases the underlying connection(s). The client must not be used afterwards. */
	close(): Promise<void>;
}
