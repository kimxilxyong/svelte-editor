<script lang="ts">
	/**
	 * @component NewPasswordFields
	 *
	 * "New password" + "Confirm password" inputs with **live validation** shared by `/register`,
	 * `/setup` and the password section of `/account`.
	 *
	 * ## Validation
	 * Uses {@link validatePassword} from `src/lib/auth/validation.ts` – the *same* function the server
	 * runs – so the browser feedback can never disagree with the authoritative check. Messages only
	 * appear once the user has left the field (or typed in it after having left once), so people are
	 * not scolded while still typing their first characters. The match check shows as soon as the
	 * confirmation has content.
	 *
	 * The inputs have `name="password"` / `name="confirm"` so they work without JavaScript (the server
	 * re-validates everything). `autocomplete="new-password"` lets password managers offer to generate
	 * and store the credential.
	 *
	 * @prop {string} [password=''] - Bindable. The new password.
	 * @prop {string} [confirm=''] - Bindable. The repeated password.
	 * @prop {boolean} [valid=false] - Bindable, read-only in practice. `true` when both fields are acceptable.
	 * @prop {string | null} [email=null] - Account email, so the password may not simply equal it.
	 * @prop {string | null} [name=null] - Account name, so the password may not simply equal it.
	 * @prop {string} [idPrefix='pw'] - Prefix for element ids (several instances can share a page).
	 * @prop {string} [label='Password'] - Label of the first field.
	 *
	 * @example
	 * <NewPasswordFields bind:password bind:confirm bind:valid={passwordOk} {email} {name} />
	 */
	import {
		PASSWORD_MAX_LENGTH,
		PASSWORD_MIN_LENGTH,
		validatePassword
	} from '../../auth/validation.js';

	interface Props {
		password?: string;
		confirm?: string;
		valid?: boolean;
		email?: string | null;
		name?: string | null;
		idPrefix?: string;
		label?: string;
	}

	let {
		password = $bindable(''),
		confirm = $bindable(''),
		// eslint-disable-next-line no-useless-assignment -- output-only bindable, only written here
		valid = $bindable(false),
		email = null,
		name = null,
		idPrefix = 'pw',
		label = 'Password'
	}: Props = $props();

	let passwordTouched = $state(false);
	let confirmTouched = $state(false);

	/** Policy problem with the password, or `null`. Context is the *entered* email/name. */
	const passwordProblem = $derived(validatePassword(password, { email, name }));
	const mismatch = $derived(confirm.length > 0 && confirm !== password);
	const confirmMissing = $derived(confirmTouched && confirm.length === 0);

	// `valid` is derived state exposed upward; assigned from an effect because $bindable props
	// cannot be `$derived` themselves.
	$effect(() => {
		valid = passwordProblem === null && confirm === password && confirm.length > 0;
	});
</script>

<div class="field">
	<label for="{idPrefix}-new">{label}</label>
	<input
		id="{idPrefix}-new"
		name="password"
		type="password"
		autocomplete="new-password"
		required
		minlength={PASSWORD_MIN_LENGTH}
		maxlength={PASSWORD_MAX_LENGTH}
		bind:value={password}
		onblur={() => (passwordTouched = true)}
		aria-invalid={passwordTouched && passwordProblem ? 'true' : undefined}
		aria-describedby="{idPrefix}-new-help"
	/>
	<span id="{idPrefix}-new-help" class="hint">
		{PASSWORD_MIN_LENGTH}–{PASSWORD_MAX_LENGTH} characters. A long passphrase works best.
	</span>
	{#if passwordTouched && passwordProblem}
		<span class="field-error" role="alert">{passwordProblem}</span>
	{/if}
</div>

<div class="field">
	<label for="{idPrefix}-confirm">Confirm password</label>
	<input
		id="{idPrefix}-confirm"
		name="confirm"
		type="password"
		autocomplete="new-password"
		required
		bind:value={confirm}
		onblur={() => (confirmTouched = true)}
		aria-invalid={mismatch || confirmMissing ? 'true' : undefined}
	/>
	{#if mismatch}
		<span class="field-error" role="alert">The passwords do not match.</span>
	{:else if confirmMissing}
		<span class="field-error" role="alert">Repeat the password.</span>
	{/if}
</div>
