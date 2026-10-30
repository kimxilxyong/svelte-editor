/**
 * @fileoverview Unit tests for the PostgreSQL connection URL builder/parser.
 */

import { describe, expect, it } from 'vitest';
import {
	buildPostgresUrl,
	emptyPostgresParts,
	parsePostgresUrl,
	type PostgresUrlParts
} from './postgres-url.js';

const parts: PostgresUrlParts = {
	host: 'db.example.com',
	port: '5433',
	database: 'my app',
	user: 'me@corp',
	password: 'p@ss:/w#rd',
	sslMode: 'require'
};

describe('buildPostgresUrl', () => {
	it('percent-encodes credentials and database', () => {
		expect(buildPostgresUrl(parts)).toBe(
			'postgresql://me%40corp:p%40ss%3A%2Fw%23rd@db.example.com:5433/my%20app?sslmode=require'
		);
	});

	it('omits empty optional parts', () => {
		expect(buildPostgresUrl({ ...emptyPostgresParts(), port: '' })).toBe('postgresql://localhost');
		expect(buildPostgresUrl({ ...emptyPostgresParts(), user: 'u', database: 'd' })).toBe(
			'postgresql://u@localhost:5432/d'
		);
	});

	it('returns an empty string without a host and brackets IPv6 literals', () => {
		expect(buildPostgresUrl({ ...emptyPostgresParts(), host: ' ' })).toBe('');
		expect(buildPostgresUrl({ ...emptyPostgresParts(), host: '::1' })).toBe(
			'postgresql://[::1]:5432'
		);
	});
});

describe('parsePostgresUrl', () => {
	it('round-trips with buildPostgresUrl', () => {
		expect(parsePostgresUrl(buildPostgresUrl(parts))).toEqual(parts);
	});

	it('parses the short scheme and ignores unknown sslmode values', () => {
		expect(parsePostgresUrl('postgres://u:p@h/d?sslmode=prefer')).toEqual({
			host: 'h',
			port: '',
			database: 'd',
			user: 'u',
			password: 'p',
			sslMode: ''
		});
	});

	it('rejects other schemes and garbage', () => {
		expect(parsePostgresUrl('mysql://u@h/d')).toBeNull();
		expect(parsePostgresUrl('postgres://')).toBeNull();
		expect(parsePostgresUrl('hello')).toBeNull();
	});
});
