<script lang="ts">
	/**
	 * @component AccountPage
	 *
	 * `/account` – the signed-in user's profile, role, password and sign-in methods.
	 *
	 * ## Sections
	 * 1. **Profile** – editable display name; email is read-only (see `+page.server.ts` for why);
	 *    the role is shown with its description from `roleInfo` (only an admin can change it).
	 * 2. **Password** – change it (current password required) or, for accounts that signed up with
	 *    OAuth / a wallet, set a first one. Saving revokes all *other* sessions.
	 * 3. **Sign-in methods** – list of the password and every linked identity with an **Unlink**
	 *    button (the server refuses to remove the last method and the message is shown inline), plus
	 *    "Link GitHub / Google / LinkedIn" (`GET /auth/<provider>?link=1`, a full-page OAuth round
	 *    trip that returns here with `?linked=<provider>`) and "Link wallet"
	 *    (`signInWithWallet({ link: true })`, then the page data is reloaded).
	 * 4. **Sign out** – a plain `POST /logout` form (no JavaScript needed).
	 *
	 * Results of the three form actions carry a `section` key (`profile` | `password` | `unlink`),
	 * which decides next to which form a message is displayed. `?error=` (OAuth link failures) and
	 * `?linked=` (OAuth link success) arrive through `data` as fixed, vetted texts.
	 *
	 * @prop {import('./$types').PageData} data - `account` (full user record), `providers`, `error`, `linked`.
	 * @prop {import('./$types').ActionData} form - Result of the last action, tagged with `section`.
	 */
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import AuthCard from '../../lib/components/auth/AuthCard.svelte';
	import NewPasswordFields from '../../lib/components/auth/NewPasswordFields.svelte';
	import { roleInfo } from '../../lib/auth/roles.js';
	import { providerLabels } from '../../lib/auth/types.js';
	import { normalizeEmail, validateName } from '../../lib/auth/validation.js';
	import { signInWithWallet } from '../../lib/auth/wallet-client.js';

	let { data, form }: PageProps = $props();

	const account = $derived(data.account);
	const role = $derived(roleInfo[account.role]);
	const linkedProviderIds = $derived(
		new Set(account.identities.map((identity) => identity.provider))
	);
	/** OAuth providers that can still be linked (one identity per provider in this UI). */
	const linkableProviders = $derived(
		data.providers.filter((provider) => !linkedProviderIds.has(provider.id))
	);

	let newPassword = $state('');
	let confirmPassword = $state('');
	let passwordOk = $state(false);
	let savingProfile = $state(false);
	let savingPassword = $state(false);
	let walletAvailable = $state(false);
	let walletBusy = $state(false);
	let walletMessage = $state<{ kind: 'success' | 'error'; text: string } | null>(null);
	let newEmail = $state('');

	onMount(() => {
		walletAvailable = typeof (window as Window & { ethereum?: unknown }).ethereum !== 'undefined';
	});

	/** Formats an ISO timestamp for display (date only; locale of the browser). */
	function day(iso: string): string {
		const date = new Date(iso);
		return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
	}

	/** Adds the current wallet to this account, then reloads the page data. */
	async function linkWallet() {
		walletBusy = true;
		walletMessage = null;
		try {
			const result = (await signInWithWallet({ link: true })) as { linked?: boolean };
			walletMessage = {
				kind: 'success',
				text: result.linked ? 'Wallet linked.' : 'This wallet is already linked to your account.'
			};
			await invalidateAll();
		} catch (error) {
			walletMessage = {
				kind: 'error',
				text: error instanceof Error ? error.message : 'Linking the wallet failed.'
			};
		} finally {
			walletBusy = false;
		}
	}
</script>

<AuthCard title="Your account" subtitle={account.email ?? account.name} width="wide">
	{#if data.error}
		<p class="alert error" role="alert">{data.error}</p>
	{/if}
	{#if data.linked}
		<p class="alert success" role="status">
			{providerLabels[data.linked as keyof typeof providerLabels]} linked to your account.
		</p>
	{/if}

	<!-- ============ Profile ============ -->
	<section class="block" aria-labelledby="profile-heading">
		<h2 id="profile-heading">Profile</h2>
		{#if form?.section === 'profile'}
			{#if form.error}
				<p class="alert error" role="alert">{form.error}</p>
			{:else if form.success}
				<p class="alert success" role="status">{form.success}</p>
			{/if}
		{/if}
		<form
			method="POST"
			action="?/profile"
			use:enhance={() => {
				savingProfile = true;
				return async ({ update }) => {
					await update({ reset: false });
					savingProfile = false;
				};
			}}
		>
			<div class="field">
				<label for="acc-name">Name</label>
				<input
					id="acc-name"
					name="name"
					type="text"
					autocomplete="name"
					required
					maxlength="80"
					value={form?.section === 'profile' && form.name ? form.name : account.name}
				/>
			</div>
			<div class="field">
				<label for="acc-email">Email</label>
				<input
					id="acc-email"
					type="email"
					readonly
					value={account.email ?? ''}
					placeholder="No email address"
				/>
				<span class="hint">
					The email address cannot be changed here. {account.email && !account.emailVerified
						? 'It has not been verified yet.'
						: ''}
				</span>
			</div>
			<div class="field">
				<span class="label-text">Role</span>
				<p class="role-line">
					<span class="role-badge role-{account.role}">{role.label}</span>
					<span class="hint">{role.description}</span>
				</p>
			</div>
			<div class="actions">
				<button type="submit" class="primary" disabled={savingProfile}>
					{savingProfile ? 'Saving…' : 'Save profile'}
				</button>
			</div>
		</form>
	</section>

	<!-- ============ Password ============ -->
	<section class="block" aria-labelledby="password-heading">
		<h2 id="password-heading">{account.hasPassword ? 'Change password' : 'Set a password'}</h2>
		{#if !account.hasPassword}
			<p class="hint">
				You currently sign in without a password. Set one to also sign in with email and password.
			</p>
		{/if}
		{#if form?.section === 'password'}
			{#if form.error}
				<p class="alert error" role="alert">{form.error}</p>
			{:else if form.success}
				<p class="alert success" role="status">{form.success}</p>
			{/if}
		{/if}
		<form
			method="POST"
			action="?/password"
			use:enhance={({ cancel }) => {
				if (!passwordOk) {
					cancel();
					return;
				}
				savingPassword = true;
				return async ({ result, update }) => {
					await update({ reset: result.type === 'success' });
					if (result.type === 'success') {
						newPassword = '';
						confirmPassword = '';
					}
					savingPassword = false;
				};
			}}
		>
			{#if account.hasPassword}
				<div class="field">
					<label for="acc-current">Current password</label>
					<input
						id="acc-current"
						name="current"
						type="password"
						autocomplete="current-password"
						required
					/>
				</div>
			{/if}
			{#if !account.email}
				<div class="field">
					<label for="acc-new-email">Email for password sign-in</label>
					<input
						id="acc-new-email"
						name="email"
						type="email"
						autocomplete="email"
						required
						bind:value={newEmail}
						aria-invalid={newEmail && !normalizeEmail(newEmail) ? 'true' : undefined}
					/>
					<span class="hint">Your account has no email address yet; a password needs one.</span>
				</div>
			{/if}
			<NewPasswordFields
				bind:password={newPassword}
				bind:confirm={confirmPassword}
				bind:valid={passwordOk}
				email={account.email ?? normalizeEmail(newEmail)}
				name={validateName(account.name)}
				idPrefix="acc"
				label="New password"
			/>
			<div class="actions">
				<button type="submit" class="primary" disabled={savingPassword}>
					{savingPassword ? 'Saving…' : account.hasPassword ? 'Change password' : 'Set password'}
				</button>
			</div>
			<p class="hint">Changing the password signs you out on all your other devices.</p>
		</form>
	</section>

	<!-- ============ Sign-in methods ============ -->
	<section class="block" aria-labelledby="methods-heading">
		<h2 id="methods-heading">Sign-in methods</h2>
		{#if form?.section === 'unlink'}
			{#if form.error}
				<p class="alert error" role="alert">{form.error}</p>
			{:else if form.success}
				<p class="alert success" role="status">{form.success}</p>
			{/if}
		{/if}

		<ul class="methods">
			{#if account.hasPassword}
				<li>
					<div>
						<strong>{providerLabels.password}</strong>
						<span class="hint">{account.email}</span>
					</div>
					<span class="hint">Change it above</span>
				</li>
			{/if}
			{#each account.identities as identity (identity.id)}
				<li>
					<div>
						<strong>{providerLabels[identity.provider]}</strong>
						{#if identity.label}<span class="hint">{identity.label}</span>{/if}
						<span class="hint">Linked {day(identity.createdAt)}</span>
					</div>
					<form method="POST" action="?/unlink" use:enhance>
						<input type="hidden" name="identityId" value={identity.id} />
						<button
							type="submit"
							class="danger"
							aria-label="Unlink {providerLabels[identity.provider]}"
						>
							Unlink
						</button>
					</form>
				</li>
			{:else}
				{#if !account.hasPassword}
					<li><span class="hint">No sign-in method found.</span></li>
				{/if}
			{/each}
		</ul>

		<h3>Link another method</h3>
		<div class="link-buttons">
			{#each linkableProviders as provider (provider.id)}
				{#if provider.configured}
					<a
						class="button"
						data-sveltekit-reload
						href={resolve('/auth/[provider=oauthprovider]?link=1', { provider: provider.id })}
					>
						Link {provider.label}
					</a>
				{:else}
					<button
						type="button"
						disabled
						title="{provider.label} sign-in is not configured on this server"
					>
						Link {provider.label}
					</button>
				{/if}
			{/each}
			<button
				type="button"
				disabled={!walletAvailable || walletBusy}
				title={walletAvailable ? undefined : 'No browser wallet detected'}
				onclick={linkWallet}
			>
				{walletBusy ? 'Waiting for wallet…' : 'Link wallet'}
			</button>
		</div>
		{#if linkableProviders.some((provider) => !provider.configured)}
			<p class="hint">Greyed-out providers have not been configured by the administrator.</p>
		{/if}
		{#if walletMessage}
			<p
				class="alert {walletMessage.kind}"
				role={walletMessage.kind === 'error' ? 'alert' : 'status'}
			>
				{walletMessage.text}
			</p>
		{/if}
	</section>

	<!-- ============ Sign out ============ -->
	<section class="block" aria-labelledby="signout-heading">
		<h2 id="signout-heading">Sign out</h2>
		<form method="POST" action={resolve('/logout')}>
			<div class="actions">
				<button type="submit">Sign out of this device</button>
			</div>
		</form>
	</section>
</AuthCard>

<style>
	.block {
		padding: 1.2rem 0;
		border-top: 1px solid var(--line);
	}

	.block:first-of-type {
		padding-top: 0;
		border-top: 0;
	}

	h2 {
		margin: 0 0 0.7rem;
		font-size: 0.95rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		text-align: left;
	}

	h3 {
		margin: 1.1rem 0 0.5rem;
		font-size: 0.78rem;
		font-weight: 650;
		color: var(--muted);
	}

	.label-text {
		font-size: 0.74rem;
		font-weight: 650;
	}

	.role-line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.2rem 0.6rem;
		margin: 0;
	}

	.role-badge {
		padding: 0.12rem 0.55rem;
		border-radius: 999px;
		background: #f4f2ff;
		color: var(--purple);
		font-size: 0.72rem;
		font-weight: 700;
	}

	.role-badge.role-admin {
		background: #fdecef;
		color: var(--error);
	}

	.role-badge.role-guest {
		background: #f1f1f5;
		color: var(--muted);
	}

	.actions {
		display: flex;
		justify-content: flex-start;
	}

	.methods {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.methods li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		padding: 0.6rem 0.8rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		font-size: 0.82rem;
	}

	.methods li > div {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.1rem 0.7rem;
	}

	.methods :global(form) {
		display: block;
	}

	.link-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
</style>
