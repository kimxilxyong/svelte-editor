/**
 * @fileoverview Unit tests for the role hierarchy and the central route access policy.
 */

import { describe, expect, it } from 'vitest';
import { hasRole, requiredRoleFor, roleRank } from './roles.js';

describe('role hierarchy', () => {
	it('orders guest < user < poweruser < admin', () => {
		expect(roleRank('guest')).toBeLessThan(roleRank('user'));
		expect(roleRank('user')).toBeLessThan(roleRank('poweruser'));
		expect(roleRank('poweruser')).toBeLessThan(roleRank('admin'));
		expect(hasRole('admin', 'poweruser')).toBe(true);
		expect(hasRole('user', 'poweruser')).toBe(false);
	});
});

describe('requiredRoleFor', () => {
	it('applies the longest matching prefix and method split', () => {
		expect(requiredRoleFor('/admin/users', 'GET')).toBe('admin');
		expect(requiredRoleFor('/editor/api', 'GET')).toBe('guest');
		expect(requiredRoleFor('/editor/api', 'POST')).toBe('user');
		expect(requiredRoleFor('/editor/api/project', 'GET')).toBe('poweruser');
		expect(requiredRoleFor('/login', 'GET')).toBe('public');
		expect(requiredRoleFor('/', 'GET')).toBe('guest');
	});

	it('ignores trailing and duplicate slashes', () => {
		expect(requiredRoleFor('/admin/', 'GET')).toBe('admin');
		expect(requiredRoleFor('//admin', 'GET')).toBe('admin');
		expect(requiredRoleFor('/admin//users', 'GET')).toBe('admin');
	});

	it('cannot be bypassed with encoded or dot segments', () => {
		expect(requiredRoleFor('/editor/api/pro%6Aect', 'GET')).toBe('poweruser');
		expect(requiredRoleFor('/%61dmin', 'GET')).toBe('admin');
		expect(requiredRoleFor('/about/../admin', 'GET')).toBe('admin');
		expect(requiredRoleFor('/./admin', 'GET')).toBe('admin');
	});

	it('fails closed on undecodable or structure-changing encodings', () => {
		expect(requiredRoleFor('/%E0%A4%A', 'GET')).toBe('admin');
		expect(requiredRoleFor('/admin%2Fusers', 'GET')).toBe('admin');
		expect(requiredRoleFor('/login%5Cx', 'GET')).toBe('admin');
	});
});
