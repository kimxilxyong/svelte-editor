<script lang="ts">
	/**
	 * @component PasswordField
	 *
	 * Password input for admin-set passwords (create user / reset password). It wraps the shared
	 * `PasswordInput` (yellow field with an eye toggle) and adds a "Generate" button that fills a random password (Web Crypto) and reveals it so
	 * the admin can pass it on. The value is only ever submitted with the form; it is never stored
	 * in client state beyond the input and is not echoed back by the server.
	 *
	 * @prop {string} [name='password'] - Form field name.
	 * @prop {string} [label='Password'] - Visible label text.
	 * @prop {string} [value=''] - Bindable current value.
	 *
	 * @example
	 * <PasswordField bind:value={password} label="New password" />
	 */
	import PasswordInput from '../PasswordInput.svelte';
	import { generatePassword } from '../../admin/format.js';
	import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../auth/validation.js';

	interface Props {
		name?: string;
		label?: string;
		value?: string;
	}

	let { name = 'password', label = 'Password', value = $bindable('') }: Props = $props();

	const uid = $props.id();
	let reveal = $state(false);

	/** Fills a random password and shows it, otherwise the admin could not read it out. */
	function fillGenerated() {
		value = generatePassword();
		reveal = true;
	}
</script>

<div class="field">
	<label class="field-label" for="{uid}-input">{label}</label>
	<div class="pw-row">
		<PasswordInput
			id="{uid}-input"
			{name}
			bind:value
			bind:revealed={reveal}
			required
			minlength={PASSWORD_MIN_LENGTH}
			maxlength={PASSWORD_MAX_LENGTH}
			autocomplete="new-password"
			spellcheck="false"
			aria-describedby="{uid}-help"
		/>
		<button type="button" class="btn small" onclick={fillGenerated}>Generate</button>
	</div>
	<p id="{uid}-help" class="hint">
		{PASSWORD_MIN_LENGTH}–{PASSWORD_MAX_LENGTH} characters, not equal to the email or name and not a very
		common password.
	</p>
</div>

<style>
	.pw-row {
		display: flex;
		gap: 0.4rem;
	}

	.pw-row :global(.password-input) {
		flex: 1;
	}
</style>
