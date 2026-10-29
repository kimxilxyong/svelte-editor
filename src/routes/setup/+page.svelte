<script lang="ts">
	/**
	 * @component SetupPage
	 *
	 * `/setup` – first-run wizard that creates the initial administrator (name, email, password).
	 * Reachable only while no user exists; afterwards the server redirects to `/login`. On success the
	 * new admin is signed in and sent to the home page.
	 *
	 * Validation is identical to `/register`: live in the browser via `src/lib/auth/validation.ts`,
	 * authoritative on the server (`parseSignupForm`). The submit button is only disabled while a
	 * request is running so the plain-POST fallback (no JavaScript) keeps working.
	 *
	 * @prop {import('./$types').ActionData} form - Last action result (`values`, `errors`, `error`).
	 */
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';
	import AuthCard from '../../lib/components/auth/AuthCard.svelte';
	import NewPasswordFields from '../../lib/components/auth/NewPasswordFields.svelte';
	import { normalizeEmail, validateName } from '../../lib/auth/validation.js';

	let { form }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	let name = $state(form?.values?.name ?? '');
	// svelte-ignore state_referenced_locally
	let email = $state(form?.values?.email ?? '');
	let password = $state('');
	let confirm = $state('');
	let passwordOk = $state(false);
	let nameTouched = $state(false);
	let emailTouched = $state(false);
	let submitting = $state(false);

	const nameOk = $derived(validateName(name) !== null);
	const emailOk = $derived(normalizeEmail(email) !== null);
	const formOk = $derived(nameOk && emailOk && passwordOk);
</script>

<AuthCard
	title="Set up your site"
	subtitle="Create the administrator account. You can add more users later."
>
	<p class="alert info">
		This account gets full access, including user management and the database backend.
	</p>

	{#if form?.error}
		<p class="alert error" role="alert">{form.error}</p>
	{/if}

	<form
		method="POST"
		use:enhance={({ cancel }) => {
			if (!formOk) {
				nameTouched = emailTouched = true;
				cancel();
				return;
			}
			submitting = true;
			return async ({ update }) => {
				await update({ reset: false });
				submitting = false;
			};
		}}
	>
		<div class="field">
			<label for="setup-name">Name</label>
			<input
				id="setup-name"
				name="name"
				type="text"
				autocomplete="name"
				required
				maxlength="80"
				bind:value={name}
				onblur={() => (nameTouched = true)}
				aria-invalid={(nameTouched && !nameOk) || form?.errors?.name ? 'true' : undefined}
			/>
			{#if nameTouched && !nameOk}
				<span class="field-error" role="alert">Enter a name (1–80 characters).</span>
			{:else if form?.errors?.name}
				<span class="field-error" role="alert">{form.errors.name}</span>
			{/if}
		</div>

		<div class="field">
			<label for="setup-email">Email</label>
			<input
				id="setup-email"
				name="email"
				type="email"
				autocomplete="email"
				required
				bind:value={email}
				onblur={() => (emailTouched = true)}
				aria-invalid={(emailTouched && !emailOk) || form?.errors?.email ? 'true' : undefined}
			/>
			{#if emailTouched && !emailOk}
				<span class="field-error" role="alert">Enter a valid email address.</span>
			{:else if form?.errors?.email}
				<span class="field-error" role="alert">{form.errors.email}</span>
			{/if}
		</div>

		<NewPasswordFields
			bind:password
			bind:confirm
			bind:valid={passwordOk}
			email={normalizeEmail(email)}
			name={validateName(name)}
			idPrefix="setup"
		/>
		{#if form?.errors?.password}
			<p class="field-error" role="alert">{form.errors.password}</p>
		{/if}

		<button type="submit" class="primary" disabled={submitting}>
			{submitting ? 'Creating administrator…' : 'Create administrator'}
		</button>
	</form>
</AuthCard>
