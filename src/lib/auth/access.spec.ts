/**
 * @fileoverview Tests for {@link canAccess}.
 */

import { describe, expect, it } from 'vitest';
import { requiredRoleFor } from './roles.js';
import { canAccess } from './access.js';

describe('canAccess', () => {
	it('allows public paths for everybody', () => {
		expect(canAccess(null, '/about')).toBe(true);
		expect(canAccess(undefined, '/login')).toBe(true);
	});

	it('lets guests read the theme page but only power users save it', () => {
		expect(canAccess('guest', '/theme')).toBe(true);
		expect(requiredRoleFor('/theme', 'POST')).toBe('poweruser');
	});

	it('requires a sign-in for everything else', () => {
		expect(canAccess(null, '/')).toBe(false);
		expect(canAccess('guest', '/')).toBe(true);
	});

	it('follows the role hierarchy', () => {
		expect(canAccess('guest', '/editor')).toBe(false);
		expect(canAccess('user', '/editor')).toBe(true);
		expect(canAccess('user', '/component-editor')).toBe(false);
		expect(canAccess('poweruser', '/component-editor')).toBe(true);
		expect(canAccess('poweruser', '/admin')).toBe(false);
		expect(canAccess('admin', '/admin/users')).toBe(true);
	});
});
