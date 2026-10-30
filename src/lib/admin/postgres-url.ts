/**
 * @fileoverview Pure helpers to build and parse PostgreSQL connection URLs for the admin
 * "connection builder".
 *
 * Isomorphic and dependency free. The server still validates the final URL with
 * `parseDatabaseConfig`; these helpers only make it comfortable (and correctly percent-encoded) to
 * produce one. User name and password are percent-encoded, so characters such as `@`, `:`, `/` or
 * `#` in a password cannot corrupt the URL.
 */

/** TLS preference written into the URL as `sslmode`. `''` omits the parameter (driver default). */
export type PostgresSslMode = '' | 'disable' | 'require' | 'verify-full';

/** The editable parts of a PostgreSQL connection. */
export type PostgresUrlParts = {
	host: string;
	/** Kept as text so a half-typed value does not break the form; empty means the default 5432. */
	port: string;
	database: string;
	user: string;
	password: string;
	sslMode: PostgresSslMode;
};

/** Default PostgreSQL port. */
export const DEFAULT_POSTGRES_PORT = '5432';

/** Selectable TLS modes with user-facing labels. */
export const sslModeOptions: { value: PostgresSslMode; label: string }[] = [
	{ value: '', label: 'Automatic' },
	{ value: 'disable', label: 'Off (no encryption)' },
	{ value: 'require', label: 'Require' },
	{ value: 'verify-full', label: 'Verify certificate' }
];

/** An empty parts object (localhost defaults). */
export function emptyPostgresParts(): PostgresUrlParts {
	return {
		host: 'localhost',
		port: DEFAULT_POSTGRES_PORT,
		database: '',
		user: '',
		password: '',
		sslMode: ''
	};
}

/**
 * Builds a `postgresql://` URL from its parts.
 *
 * @param parts - Connection parts; a missing host yields an empty string.
 * @returns The URL, or `''` when there is no host yet.
 * @example
 * buildPostgresUrl({ host: 'db.example.com', port: '5432', database: 'app', user: 'me',
 *   password: 'p@ss/word', sslMode: 'require' });
 * // 'postgresql://me:p%40ss%2Fword@db.example.com:5432/app?sslmode=require'
 */
export function buildPostgresUrl(parts: PostgresUrlParts): string {
	const host = parts.host.trim();
	if (!host) return '';
	// IPv6 literals need brackets in URLs.
	const hostPart = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
	const port = parts.port.trim();
	const credentials = parts.user
		? `${encodeURIComponent(parts.user)}${parts.password ? `:${encodeURIComponent(parts.password)}` : ''}@`
		: '';
	const database = parts.database.trim() ? `/${encodeURIComponent(parts.database.trim())}` : '';
	const query = parts.sslMode ? `?sslmode=${parts.sslMode}` : '';
	return `postgresql://${credentials}${hostPart}${port ? `:${port}` : ''}${database}${query}`;
}

/**
 * Parses a PostgreSQL URL into editable parts.
 *
 * @param url - A `postgres://` or `postgresql://` URL.
 * @returns The parts, or `null` when the text is not a parsable PostgreSQL URL.
 * @example
 * parsePostgresUrl('postgres://me:secret@db:5433/app?sslmode=require')?.port; // '5433'
 */
export function parsePostgresUrl(url: string): PostgresUrlParts | null {
	if (!/^postgres(?:ql)?:\/\//i.test(url.trim())) return null;
	let parsed: URL;
	try {
		parsed = new URL(url.trim());
	} catch {
		return null;
	}
	const decode = (value: string) => {
		try {
			return decodeURIComponent(value);
		} catch {
			return value;
		}
	};
	// A bare scheme (e.g. while typing) is not a connection yet; leave the builder untouched.
	if (!parsed.hostname) return null;
	const mode = parsed.searchParams.get('sslmode');
	const sslMode: PostgresSslMode =
		mode === 'disable' || mode === 'require' || mode === 'verify-full' ? mode : '';
	return {
		host: parsed.hostname.replace(/^\[|\]$/g, ''),
		port: parsed.port,
		database: decode(parsed.pathname.replace(/^\//, '')),
		user: decode(parsed.username),
		password: decode(parsed.password),
		sslMode
	};
}
