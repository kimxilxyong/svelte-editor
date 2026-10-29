<script lang="ts">
	/**
	 * @component SignInOptions
	 *
	 * The "or continue with" block of `/login` and `/register`: one button per OAuth provider
	 * (GitHub, Google, LinkedIn) plus "Sign in with wallet" (EIP-4361 / Sign-In with Ethereum).
	 *
	 * ## Behaviour
	 * - **OAuth** buttons are plain links to `GET /auth/<provider>?next=…` (a full page navigation –
	 *   the endpoint redirects to the provider, so `data-sveltekit-reload` keeps the client router
	 *   out of the way). A provider that is not configured on the server is rendered as a **disabled
	 *   button** with an explanatory tooltip/hint instead of leading to an error page.
	 * - **Wallet**: {@link signInWithWallet} asks the injected wallet to sign a one-time challenge;
	 *   on success the browser does a *full* navigation to `next` so the new session cookie is
	 *   picked up by every load function. The wallet button is disabled when no `window.ethereum`
	 *   provider exists.
	 *
	 * ## Security notes
	 * `next` is validated server-side (`postAuthTarget`) before it is passed in; the client repeats a
	 * cheap same-site check before navigating so a bug upstream cannot create an open redirect.
	 *
	 * @prop {{ id: string; label: string; configured: boolean }[]} providers - OAuth providers with availability (from `getOAuthProviderStatus`).
	 * @prop {string} next - Same-site path to open after signing in (already validated by the server).
	 * @prop {'signin' | 'register'} [mode='signin'] - Only changes wording ("Sign in with" vs "Sign up with").
	 *
	 * @example
	 * <SignInOptions providers={data.providers} next={data.next} mode="signin" />
	 */
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { signInWithWallet } from '../../auth/wallet-client.js';

	interface Props {
		providers: { id: string; label: string; configured: boolean }[];
		next: string;
		mode?: 'signin' | 'register';
	}

	let { providers, next, mode = 'signin' }: Props = $props();

	const verb = $derived(mode === 'register' ? 'Sign up with' : 'Sign in with');
	const anyUnconfigured = $derived(providers.some((provider) => !provider.configured));

	/** `window.ethereum` only exists in the browser, so availability is detected after mount. */
	let walletAvailable = $state(false);
	let walletBusy = $state(false);
	let walletError = $state<string | null>(null);

	onMount(() => {
		walletAvailable = typeof (window as Window & { ethereum?: unknown }).ethereum !== 'undefined';
	});

	/** Starts the wallet flow and navigates to `next` on success. */
	async function connectWallet() {
		walletBusy = true;
		walletError = null;
		try {
			await signInWithWallet();
			// Same-site guard (defence in depth; the server already validated `next`).
			const target = next.startsWith('/') && !next.startsWith('//') ? next : '/';
			window.location.assign(target);
		} catch (error) {
			walletError = error instanceof Error ? error.message : 'Wallet sign-in failed.';
			walletBusy = false;
		}
	}
</script>

<div class="options">
	<p class="divider"><span>or continue with</span></p>

	<div class="buttons">
		{#each providers as provider (provider.id)}
			{#if provider.configured}
				<a
					class="button provider"
					data-sveltekit-reload
					href={resolve(`/auth/[provider=oauthprovider]?next=${encodeURIComponent(next)}`, {
						provider: provider.id
					})}
				>
					{verb}
					{provider.label}
				</a>
			{:else}
				<button
					type="button"
					class="provider"
					disabled
					title="{provider.label} sign-in is not configured on this server"
				>
					{verb}
					{provider.label}
				</button>
			{/if}
		{/each}

		<button
			type="button"
			class="provider"
			disabled={!walletAvailable || walletBusy}
			title={walletAvailable ? undefined : 'No browser wallet detected'}
			onclick={connectWallet}
		>
			{walletBusy ? 'Waiting for wallet…' : `${verb} wallet`}
		</button>
	</div>

	{#if anyUnconfigured}
		<p class="hint">Greyed-out providers have not been configured by the administrator.</p>
	{/if}
	{#if !walletAvailable}
		<p class="hint">Install a browser wallet such as MetaMask to sign in with Ethereum.</p>
	{/if}
	{#if walletError}
		<p class="alert error" role="alert">{walletError}</p>
	{/if}
</div>

<style>
	.options {
		margin-top: 1.2rem;
	}

	.divider {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		margin: 0 0 0.9rem;
		color: var(--muted);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.divider::before,
	.divider::after {
		flex: 1;
		height: 1px;
		background: var(--line);
		content: '';
	}

	.buttons {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.provider {
		width: 100%;
		box-sizing: border-box;
	}

	.hint {
		margin: 0.6rem 0 0;
	}

	.alert {
		margin: 0.8rem 0 0;
	}
</style>
