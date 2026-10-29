/**
 * @fileoverview Tests for {@link parseSignupForm}.
 */

import { describe, expect, it } from 'vitest';
import { parseSignupForm } from './signup-form.js';

/** Builds a FormData from a plain object. */
function formOf(fields: Record<string, string>): FormData {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	return form;
}

const valid = {
	name: '  Ada   Lovelace ',
	email: ' Ada@Example.COM ',
	password: 'correct horse battery',
	confirm: 'correct horse battery'
};

describe('parseSignupForm', () => {
	it('cleans valid input', () => {
		const parsed = parseSignupForm(formOf(valid));
		expect(parsed).toEqual({
			ok: true,
			data: { name: 'Ada Lovelace', email: 'ada@example.com', password: 'correct horse battery' }
		});
	});

	it('reports every invalid field and echoes only name and email', () => {
		const parsed = parseSignupForm(
			formOf({ name: ' ', email: 'nope', password: 'x', confirm: 'y' })
		);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(Object.keys(parsed.errors).sort()).toEqual(['confirm', 'email', 'name', 'password']);
		expect(parsed.values).toEqual({ name: ' ', email: 'nope' });
		expect('password' in parsed.values).toBe(false);
	});

	it('rejects a mismatching confirmation and a password equal to the email', () => {
		const mismatch = parseSignupForm(formOf({ ...valid, confirm: 'something else entirely' }));
		expect(mismatch.ok === false && mismatch.errors.confirm).toBeTruthy();
		const same = parseSignupForm(
			formOf({ ...valid, password: 'ada@example.com', confirm: 'ada@example.com' })
		);
		expect(same.ok === false && same.errors.password).toMatch(/email/);
	});

	it('treats missing fields as empty', () => {
		expect(parseSignupForm(new FormData()).ok).toBe(false);
	});
});
