import { describe, expect, it } from 'vitest';
import { parseUsersQuery, usersQueryToSearch } from './users-query.js';

describe('parseUsersQuery', () => {
	it('returns defaults for an empty query', () => {
		expect(parseUsersQuery(new URLSearchParams())).toEqual({
			q: '',
			role: '',
			status: '',
			page: 1,
			pageSize: 25
		});
	});

	it('accepts valid values', () => {
		const query = parseUsersQuery(
			new URLSearchParams('q=%20ada%20&role=poweruser&status=disabled&page=3&size=50')
		);
		expect(query).toEqual({
			q: 'ada',
			role: 'poweruser',
			status: 'disabled',
			page: 3,
			pageSize: 50
		});
	});

	it('discards or clamps hostile values', () => {
		const query = parseUsersQuery(
			new URLSearchParams(`q=${'x'.repeat(500)}&role=root&status=banned&page=-4&size=100000`)
		);
		expect(query.q).toHaveLength(100);
		expect(query.role).toBe('');
		expect(query.status).toBe('');
		expect(query.page).toBe(1);
		expect(query.pageSize).toBe(25);
		expect(parseUsersQuery(new URLSearchParams('page=99999999999')).page).toBe(100_000);
		expect(parseUsersQuery(new URLSearchParams('page=abc')).page).toBe(1);
	});
});

describe('usersQueryToSearch', () => {
	it('omits defaults and round-trips', () => {
		const base = parseUsersQuery(new URLSearchParams());
		expect(usersQueryToSearch(base)).toBe('');
		const query = parseUsersQuery(new URLSearchParams('q=a%26b&role=admin&size=10&page=2'));
		const search = usersQueryToSearch(query);
		expect(parseUsersQuery(new URLSearchParams(search))).toEqual(query);
	});

	it('applies overrides', () => {
		const base = parseUsersQuery(new URLSearchParams('q=ada'));
		expect(usersQueryToSearch(base, { page: 2 })).toBe('?q=ada&page=2');
		expect(usersQueryToSearch(base, { page: 1, q: '' })).toBe('');
	});
});
