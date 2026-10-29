/**
 * @fileoverview Parsing and serialising of the `/admin/users` list state (search, filters, paging).
 *
 * The list state lives in the URL search parameters so that the browser Back/Forward buttons, reloads
 * and shared links all reproduce the same view. The module is **isomorphic and pure**: the server
 * `load` function uses {@link parseUsersQuery} on untrusted input (every value is clamped or
 * discarded when invalid) and the page uses {@link usersQueryToSearch} to build links.
 *
 * Contract:
 * - Input: any `URLSearchParams` (attacker controlled).
 * - Output: a fully normalised {@link UsersQuery}; never throws.
 */

import { isRole, type Role } from '../auth/roles.js';

/** Allowed page sizes (also offered in the UI). */
export const pageSizes = [10, 25, 50, 100] as const;

/** Page size used when the URL has no (valid) `size`. */
export const DEFAULT_PAGE_SIZE = 25;

/** Longest search text that is honoured (longer input is truncated). */
export const MAX_SEARCH_LENGTH = 100;

/** Highest page number that is honoured; protects `OFFSET` arithmetic from absurd values. */
export const MAX_PAGE = 100_000;

/** Normalised state of the user list. Empty string means "no filter". */
export type UsersQuery = {
	/** Case-insensitive search in name and email. */
	q: string;
	/** Role filter. */
	role: Role | '';
	/** Account status filter. */
	status: 'active' | 'disabled' | '';
	/** 1-based page number. */
	page: number;
	/** Rows per page, one of {@link pageSizes}. */
	pageSize: number;
};

/**
 * Parses untrusted URL search parameters into a {@link UsersQuery}.
 *
 * @param params - `url.searchParams` of the request (keys `q`, `role`, `status`, `page`, `size`).
 * @returns A normalised query; unknown or malformed values fall back to their defaults.
 * @example
 * parseUsersQuery(new URLSearchParams('role=admin&page=2'));
 * // { q: '', role: 'admin', status: '', page: 2, pageSize: 25 }
 */
export function parseUsersQuery(params: URLSearchParams): UsersQuery {
	const q = (params.get('q') ?? '').trim().slice(0, MAX_SEARCH_LENGTH);
	const rawRole = params.get('role');
	const rawStatus = params.get('status');
	const page = Number.parseInt(params.get('page') ?? '', 10);
	const size = Number.parseInt(params.get('size') ?? '', 10);
	return {
		q,
		role: isRole(rawRole) ? rawRole : '',
		status: rawStatus === 'active' || rawStatus === 'disabled' ? rawStatus : '',
		page: Number.isFinite(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1,
		pageSize: (pageSizes as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE
	};
}

/**
 * Serialises a query to a search string, omitting defaults to keep URLs short and canonical.
 *
 * @param query - The state to encode.
 * @param overrides - Fields to change (for example `{ page: 3 }` for a pagination link).
 * @returns `''` when everything is default, otherwise `?key=value&…`.
 * @example
 * usersQueryToSearch(parseUsersQuery(new URLSearchParams('q=ada')), { page: 2 }); // '?q=ada&page=2'
 */
export function usersQueryToSearch(query: UsersQuery, overrides: Partial<UsersQuery> = {}): string {
	const merged = { ...query, ...overrides };
	const params = new URLSearchParams();
	if (merged.q) params.set('q', merged.q);
	if (merged.role) params.set('role', merged.role);
	if (merged.status) params.set('status', merged.status);
	if (merged.pageSize !== DEFAULT_PAGE_SIZE) params.set('size', String(merged.pageSize));
	if (merged.page > 1) params.set('page', String(merged.page));
	const text = params.toString();
	return text ? `?${text}` : '';
}
