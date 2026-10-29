<script lang="ts">
	/**
	 * @component LoginPage
	 *
	 * `/login` – sign in with email + password, an OAuth provider (GitHub, Google, LinkedIn) or a
	 * crypto wallet. Anonymous-only: the server load redirects signed-in users away.
	 *
	 * ## Data flow
	 * - `data` comes from `+page.server.ts` `load`: validated `next` target, provider availability,
	 *   `allowRegistration` and the message for `?error=<code>` (fixed texts, never the raw code).
	 * - `form` is the result of the `default` action (`fail` payload with `email` and `error`).
	 * - The form uses `use:enhance` for progressive enhancement: it works as a plain POST without
	 *   JavaScript; with JavaScript a `submitting` flag disables the button and the typed email
	 *   survives a failed attempt (the password field is reset by SvelteKit on purpose).
	 *
	 * @prop {import('./$types').PageData} data - Server load result (`next`, `providers`, `allowRegistration`, `error`).
	 * @prop {import('./$types').ActionData} form - Result of the last form submission (`error`, `email`).
	 */
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import AuthCard from '../../lib/components/auth/AuthCard.svelte';
	import SignInOptions from '../../lib/components/auth/SignInOptions.svelte';

	let { data, form }: PageProps = $props();

	let submitting = $state(false);

	/** A failed form attempt takes precedence over the `?error=` banner of a previous redirect. */
	const message = $derived(form?.error ?? data.error);
</script>

<AuthCard title="Sign in" subtitle="Welcome back — sign in to continue.">
	{#if message}
		<p class="alert error" role="alert">{message}</p>
	{/if}

	<form
		method="POST"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update();
				submitting = false;
			};
		}}
	>
		<input type="hidden" name="next" value={data.next} />

		<div class="field">
			<label for="login-email">Email</label>
			<input
				id="login-email"
				name="email"
				type="email"
				autocomplete="username"
				required
				value={form?.email ?? ''}
			/>
		</div>

		<div class="field">
			<label for="login-password">Password</label>
			<input
				id="login-password"
				name="password"
				type="password"
				autocomplete="current-password"
				required
			/>
		</div>

		<button type="submit" class="primary" disabled={submitting}>
			{submitting ? 'Signing in…' : 'Sign in'}
		</button>
	</form>

	<SignInOptions providers={data.providers} next={data.next} mode="signin" />

	{#snippet footer()}
		{#if data.allowRegistration}
			No account yet? <a href={resolve('/register')}>Create one</a>
		{:else}
			Registration is closed. Ask an administrator for an account.
		{/if}
	{/snippet}
</AuthCard>
