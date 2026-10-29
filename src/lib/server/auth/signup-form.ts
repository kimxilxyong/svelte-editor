/**
 * @fileoverview Server-side parsing and validation of the "create an account with a password" form
 * shared by `/register` and `/setup`.
 *
 * The browser already validates live (`NewPasswordFields.svelte`), but the client is never trusted:
 * this module re-runs the same pure validators from `src/lib/auth/validation.ts` and produces
 * per-field errors for the no-JavaScript fallback.
 *
 * The returned `values` deliberately contain **only** `name` and `email`: they are echoed back to
 * refill the form after a failure, passwords are never sent back to the browser.
 */

import { normalizeEmail, validateName, validatePassword } from '../../auth/validation.js';

/** Per-field error messages of a failed submission. */
export type SignupFieldErrors = Partial<Record<'name' | 'email' | 'password' | 'confirm', string>>;

/** Result of {@link parseSignupForm}. */
export type SignupParseResult =
	| { ok: true; data: { name: string; email: string; password: string } }
	| { ok: false; values: { name: string; email: string }; errors: SignupFieldErrors };

/**
 * Validates the sign-up fields `name`, `email`, `password` and `confirm`.
 *
 * @param form - Submitted form data (untrusted).
 * @returns The cleaned input, or the echoable values plus field errors.
 * @example
 * const parsed = parseSignupForm(await request.formData());
 * if (!parsed.ok) return fail(400, { values: parsed.values, errors: parsed.errors });
 */
export function parseSignupForm(form: FormData): SignupParseResult {
	const rawName = String(form.get('name') ?? '');
	const rawEmail = String(form.get('email') ?? '');
	const password = String(form.get('password') ?? '');
	const confirm = String(form.get('confirm') ?? '');

	const errors: SignupFieldErrors = {};
	const name = validateName(rawName);
	if (!name) errors.name = 'Enter a name (1–80 characters, no control characters).';
	const email = normalizeEmail(rawEmail);
	if (!email) errors.email = 'Enter a valid email address.';
	const passwordProblem = validatePassword(password, { email, name });
	if (passwordProblem) errors.password = passwordProblem;
	if (confirm !== password) errors.confirm = 'The passwords do not match.';

	if (Object.keys(errors).length > 0 || !name || !email) {
		return {
			ok: false,
			// Cap what is echoed back so a hostile oversized field cannot bloat the response.
			values: { name: rawName.slice(0, 200), email: rawEmail.slice(0, 300) },
			errors
		};
	}
	return { ok: true, data: { name, email, password } };
}
