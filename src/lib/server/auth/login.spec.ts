import { describe, expect, it, vi } from 'vitest';
import { clientIp, safeNext } from './login.js';

describe('safeNext', () => {
	it('keeps same-site paths with query strings', () => {
		expect(safeNext('/admin/users?page=2')).toBe('/admin/users?page=2');
		expect(safeNext('/')).toBe('/');
	});

	it.each([
		'//evil.example',
		'/\\evil.example',
		'https://evil.example',
		'javascript:alert(1)',
		'evil',
		'/a\nb',
		'/' + 'a'.repeat(600)
	])('rejects %j', (value) => {
		expect(safeNext(value)).toBe('/');
	});

	it('falls back for missing values and honours a custom fallback', () => {
		expect(safeNext(null)).toBe('/');
		expect(safeNext(undefined, '/account')).toBe('/account');
	});
});

describe('clientIp', () => {
	it('returns the address or "unknown" when the adapter cannot tell', () => {
		expect(clientIp({ getClientAddress: () => '1.2.3.4' })).toBe('1.2.3.4');
		expect(
			clientIp({
				getClientAddress: vi.fn(() => {
					throw new Error('no address');
				})
			})
		).toBe('unknown');
	});
});
