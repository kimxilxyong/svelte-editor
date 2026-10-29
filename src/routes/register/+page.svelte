<script lang="ts">
	/**
	 * @component RegisterPage
	 *
	 * `/register` – create an account with name, email and password, or continue with an OAuth
	 * provider / crypto wallet. When an administrator has closed registration the form is replaced by
	 * a "registration closed" notice (the server action refuses submissions as well).
	 *
	 * ## Live validation
	 * Name, email and password are checked in the browser with the isomorphic validators from
	 * `src/lib/auth/validation.ts` (the server uses the very same functions), shown after a field was
	 * visited. Submitting an invalid form is cancelled client-side (all messages are revealed); the
	 * button is *not* disabled by validity so the plain-POST fallback keeps working without
	 * JavaScript, where the server-side field errors (`form.errors`) are shown instead.
	 *
	 * @prop {import('./$types').PageData} data - Server load result (`next`, `providers`, `allowRegistration`).
	 * @prop {import('./$types').ActionData} form - Last action result (`values`, `errors`, `error`).
	 */
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import AuthCard from '../../lib/components/auth/AuthCard.svelte';
	import NewPasswordFields from '../../lib/components/auth/NewPasswordFields.svelte';
	import SignInOptions from '../../lib/components/auth/SignInOptions.svelte';
	import { normalizeEmail, validateName } from '../../lib/auth/validation.js';

	let { data, form }: PageProps = $props();

	// `untrack`-free on purpose: the initial value is read once from the (possibly failed) last
	// submission; afterwards the inputs own the state.
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

<AuthCard title="Create an account" subtitle="Register to start building your site.">
	{#if !data.allowRegistration}
		<p class="alert info" role="status">
			Registration is currently closed. Ask an administrator to create an account for you.
		</p>
	{:else}
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
					// Keep the typed values (SvelteKit would otherwise reset the form on success).
					await update({ reset: false });
					submitting = false;
				};
			}}
		>
			<input type="hidden" name="next" value={data.next} />

			<div class="field">
				<label for="reg-name">Name</label>
				<input
					id="reg-name"
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
				<label for="reg-email">Email</label>
				<input
					id="reg-email"
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
				idPrefix="reg"
			/>
			{#if form?.errors?.password}
				<p class="field-error" role="alert">{form.errors.password}</p>
			{/if}

			<button type="submit" class="primary" disabled={submitting}>
				{submitting ? 'Creating account…' : 'Create account'}
			</button>
		</form>

		<SignInOptions providers={data.providers} next={data.next} mode="register" />
	{/if}

	{#snippet footer()}
		Already have an account? <a href={resolve('/login')}>Sign in</a>
	{/snippet}
</AuthCard>
