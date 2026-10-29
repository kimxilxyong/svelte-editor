<script lang="ts">
	/**
	 * @component AuthCard
	 *
	 * Centered card shell shared by `/login`, `/register`, `/setup` and `/account`. It owns the design
	 * tokens (same palette as the page-builder shell in `/component-editor`) and the **shared form
	 * styling** for everything rendered inside it, so the pages themselves only contain markup:
	 *
	 * | Class (inside the card) | Purpose                                              |
	 * | ----------------------- | ---------------------------------------------------- |
	 * | `.field`                | label + input + optional `.hint` / `.field-error`    |
	 * | `.primary` / `.danger`  | button variants (plain buttons are "secondary")      |
	 * | `.alert.error` / `.alert.success` / `.alert.info` | status banners             |
	 *
	 * The inner rules use `:global(...)` on purpose: the markup lives in the *pages* (snippet content),
	 * which Svelte's scoped CSS could not reach. They are namespaced under `.auth-card` so nothing
	 * leaks into the rest of the app.
	 *
	 * @prop {string} title - Heading of the card (`<h1>`) and document title.
	 * @prop {string} [subtitle] - One-line explanation below the title.
	 * @prop {'narrow' | 'wide'} [width='narrow'] - `narrow` (26rem) for sign-in forms, `wide` (44rem) for the account page.
	 * @prop {Snippet} children - Card body.
	 * @prop {Snippet} [footer] - Optional footer line below the body (links to other auth pages).
	 *
	 * @example
	 * <AuthCard title="Sign in" subtitle="Welcome back">
	 *   <form>…</form>
	 *   {#snippet footer()}No account? <a href="/register">Register</a>{/snippet}
	 * </AuthCard>
	 */
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		subtitle?: string;
		width?: 'narrow' | 'wide';
		children: Snippet;
		footer?: Snippet;
	}

	let { title, subtitle, width = 'narrow', children, footer }: Props = $props();
</script>

<svelte:head>
	<title>{title}</title>
</svelte:head>

<div class="auth-shell">
	<section class="auth-card" class:wide={width === 'wide'} aria-labelledby="auth-card-title">
		<div class="brand-mark" aria-hidden="true">✳</div>
		<h1 id="auth-card-title">{title}</h1>
		{#if subtitle}<p class="subtitle">{subtitle}</p>{/if}
		<div class="body">
			{@render children()}
		</div>
		{#if footer}
			<p class="footer">{@render footer()}</p>
		{/if}
	</section>
</div>

<style>
	.auth-shell {
		--ink: #20233a;
		--muted: #898ba0;
		--line: #e9e9f0;
		--purple: #6b5ce7;
		--error: #d6334a;
		--ok: #1d8a5a;
		display: flex;
		flex: 1;
		align-items: flex-start;
		justify-content: center;
		padding: 2.5rem 0.5rem 3rem;
		color: var(--ink);
		font-family:
			Inter,
			ui-sans-serif,
			system-ui,
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			sans-serif;
	}

	.auth-card {
		width: 100%;
		max-width: 26rem;
		box-sizing: border-box;
		padding: 1.8rem 1.7rem 1.5rem;
		border: 1px solid var(--line);
		border-radius: 16px;
		background: #fff;
		box-shadow: 0 10px 34px rgb(32 35 58 / 8%);
	}

	.auth-card.wide {
		max-width: 44rem;
	}

	.brand-mark {
		display: grid;
		width: 36px;
		height: 36px;
		margin: 0 auto 0.7rem;
		place-items: center;
		border-radius: 11px;
		background: var(--purple);
		color: #fff;
		font-size: 1.1rem;
	}

	h1 {
		margin: 0;
		color: var(--ink);
		font-size: 1.35rem;
		font-weight: 700;
		letter-spacing: -0.025em;
	}

	.subtitle {
		margin: 0.3rem 0 0;
		color: var(--muted);
		font-size: 0.8rem;
		text-align: center;
	}

	.body {
		margin-top: 1.3rem;
	}

	.footer {
		margin: 1.3rem 0 0;
		color: var(--muted);
		font-size: 0.78rem;
		text-align: center;
	}

	.footer :global(a),
	.body :global(a:not(.button)) {
		color: var(--purple);
		font-weight: 600;
	}

	/* ---- shared form controls (markup lives in the pages) ---- */
	.auth-card :global(form) {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.auth-card :global(.field) {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.74rem;
		font-weight: 650;
	}

	.auth-card :global(.field input) {
		min-height: 38px;
		padding: 0 0.7rem;
		border: 1px solid var(--line);
		border-radius: 9px;
		background: #fff;
		color: var(--ink);
		font: inherit;
		font-size: 0.85rem;
		font-weight: 450;
	}

	.auth-card :global(.field input:focus-visible) {
		border-color: var(--purple);
		outline: 2px solid rgb(107 92 231 / 25%);
		outline-offset: 0;
	}

	.auth-card :global(.field input[aria-invalid='true']) {
		border-color: var(--error);
	}

	.auth-card :global(.field input[readonly]) {
		background: #f7f7fa;
		color: var(--muted);
	}

	.auth-card :global(.hint) {
		margin: 0;
		color: var(--muted);
		font-size: 0.7rem;
		font-weight: 400;
		line-height: 1.45;
	}

	.auth-card :global(.field-error) {
		margin: 0;
		color: var(--error);
		font-size: 0.7rem;
		font-weight: 500;
	}

	.auth-card :global(button),
	.auth-card :global(a.button) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-height: 38px;
		padding: 0 1rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: #fff;
		color: var(--ink);
		font: inherit;
		font-size: 0.82rem;
		font-weight: 650;
		text-decoration: none;
		cursor: pointer;
	}

	.auth-card :global(button:hover:not(:disabled)),
	.auth-card :global(a.button:hover) {
		border-color: var(--purple);
		text-decoration: none;
	}

	.auth-card :global(button:disabled),
	.auth-card :global(a.button[aria-disabled='true']) {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.auth-card :global(button.primary) {
		border-color: var(--purple);
		background: var(--purple);
		color: #fff;
	}

	.auth-card :global(button.primary:hover:not(:disabled)) {
		filter: brightness(1.08);
	}

	.auth-card :global(button.danger) {
		border-color: #f3c3cb;
		color: var(--error);
	}

	.auth-card :global(.alert) {
		margin: 0 0 1rem;
		padding: 0.65rem 0.8rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		font-size: 0.78rem;
		line-height: 1.45;
	}

	.auth-card :global(.alert.error) {
		border-color: #f3c3cb;
		background: #fdecef;
		color: #a3243a;
	}

	.auth-card :global(.alert.success) {
		border-color: #bfe5d1;
		background: #eaf7f0;
		color: #176b47;
	}

	.auth-card :global(.alert.info) {
		border-color: #dcd8fb;
		background: #f4f2ff;
		color: #4a3fb5;
	}
</style>
