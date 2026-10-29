<script lang="ts">
	/**
	 * @component AdminShell
	 *
	 * Page frame shared by all `/admin` pages: title block, a small section navigation
	 * (Overview / Users) and the **shared visual language** of the admin area.
	 *
	 * ## Styling architecture
	 * The look mirrors `/component-editor` (same CSS variables: `--ink`, `--muted`, `--line`,
	 * `--purple`, `--error`, …; white panels on `#f7f7fa`). Because the admin cards are split into
	 * many small components, the reusable classes (`.card`, `.btn`, `.field-control`, `.notice`,
	 * `table.data`, …) are defined here once with `:global()` **scoped under `.admin-shell`**, so
	 * they style every descendant component but never leak to other routes.
	 *
	 * @prop {string} title - Page heading (`<h1>`).
	 * @prop {string} eyebrow - Small uppercase label above the heading.
	 * @prop {'overview' | 'users'} active - Which section tab is highlighted (`aria-current`).
	 * @prop {import('svelte').Snippet} [actions] - Optional buttons shown next to the heading.
	 * @prop {import('svelte').Snippet} children - Page content.
	 *
	 * @example
	 * <AdminShell title="Administration" eyebrow="ADMIN" active="overview">…</AdminShell>
	 */
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		eyebrow: string;
		active: 'overview' | 'users';
		actions?: Snippet;
		children: Snippet;
	}

	let { title, eyebrow, active, actions, children }: Props = $props();
</script>

<div class="admin-shell">
	<header class="admin-head">
		<div>
			<p class="eyebrow">{eyebrow}</p>
			<h1>{title}</h1>
		</div>
		{#if actions}<div class="head-actions">{@render actions()}</div>{/if}
	</header>

	<nav class="admin-tabs" aria-label="Administration sections">
		<a href={resolve('/admin')} aria-current={active === 'overview' ? 'page' : undefined}>
			Overview
		</a>
		<a href={resolve('/admin/users')} aria-current={active === 'users' ? 'page' : undefined}>
			Users
		</a>
	</nav>

	<div class="admin-body">
		{@render children()}
	</div>
</div>

<style>
	/* Let the admin area use the full available width like the editors do. */
	:global(main:has(.admin-shell)) {
		width: 100%;
		max-width: 80rem;
		padding: 0;
	}

	.admin-shell {
		--ink: #20233a;
		--muted: #6c6e85; /* darker than the editor's #898ba0 for AA contrast on white */
		--line: #e9e9f0;
		--purple: #6b5ce7;
		--error: #d6334a;
		--ok: #2f855a;
		--warn: #b7791f;
		min-height: calc(100vh - 3rem);
		padding: 1.2rem 1.2rem 2.5rem;
		background: #f7f7fa;
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

	.admin-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.8rem;
	}

	.admin-head h1 {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		text-align: left;
	}

	.head-actions {
		display: flex;
		gap: 0.5rem;
	}

	.admin-tabs {
		display: flex;
		gap: 0.3rem;
		margin: 1rem 0 1.2rem;
		border-bottom: 1px solid var(--line);
	}

	.admin-tabs a {
		margin-bottom: -1px;
		padding: 0.5rem 0.9rem;
		border-bottom: 2px solid transparent;
		color: var(--muted);
		font-size: 0.82rem;
		font-weight: 650;
		text-decoration: none;
	}

	.admin-tabs a:hover {
		color: var(--ink);
	}

	.admin-tabs a[aria-current='page'] {
		border-bottom-color: var(--purple);
		color: var(--purple);
	}

	.admin-tabs a:focus-visible {
		outline: 2px solid var(--purple);
		outline-offset: -2px;
		border-radius: 6px;
	}

	.admin-body {
		display: grid;
		gap: 1rem;
	}

	/* ---- Shared building blocks (apply to all descendant components) ---- */

	.admin-shell :global(.grid-2) {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr));
		gap: 1rem;
		align-items: start;
	}

	.admin-shell :global(.card) {
		padding: 1.1rem 1.2rem 1.2rem;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: #fff;
		min-width: 0;
	}

	.admin-shell :global(.card h2) {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: -0.025em;
	}

	.admin-shell :global(.card-head) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		margin-bottom: 0.7rem;
	}

	.admin-shell :global(.eyebrow) {
		margin: 0;
		color: var(--muted);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.admin-shell :global(.hint) {
		margin: 0.5rem 0 0.8rem;
		color: var(--muted);
		font-size: 0.75rem;
		line-height: 1.55;
	}

	.admin-shell :global(.muted) {
		color: var(--muted);
	}

	.admin-shell :global(code) {
		padding: 0.05rem 0.3rem;
		border-radius: 5px;
		background: #f1f1f7;
		font-size: 0.72rem;
		overflow-wrap: anywhere;
	}

	.admin-shell :global(.field) {
		display: block;
		margin: 0.8rem 0 0;
	}

	.admin-shell :global(.field-label) {
		display: block;
		margin-bottom: 0.35rem;
		color: #525470;
		font-size: 0.72rem;
		font-weight: 650;
	}

	.admin-shell :global(.field-control) {
		display: block;
		width: 100%;
		min-height: 38px;
		padding: 0.5rem 0.65rem;
		border: 1px solid #dcdde8;
		border-radius: 7px;
		background: #fff;
		color: #33354a;
		font: inherit;
		font-size: 0.8rem;
		outline: none;
	}

	.admin-shell :global(.field-control:focus) {
		border-color: #978be9;
		box-shadow: 0 0 0 3px rgb(119 102 223 / 18%);
	}

	.admin-shell :global(.field-control:disabled) {
		background: #f4f4f8;
		color: var(--muted);
	}

	.admin-shell :global(fieldset) {
		min-width: 0;
		margin: 0.9rem 0 0;
		padding: 0;
		border: 0;
	}

	.admin-shell :global(legend) {
		padding: 0;
		color: #525470;
		font-size: 0.72rem;
		font-weight: 650;
	}

	.admin-shell :global(.choice) {
		display: flex;
		align-items: flex-start;
		gap: 0.55rem;
		margin-top: 0.5rem;
		font-size: 0.78rem;
		line-height: 1.4;
	}

	.admin-shell :global(.choice input) {
		margin-top: 0.15rem;
		flex: none;
		accent-color: var(--purple);
	}

	.admin-shell :global(.choice small) {
		display: block;
		color: var(--muted);
		font-size: 0.7rem;
	}

	.admin-shell :global(.row) {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	.admin-shell :global(.btn) {
		padding: 0.5rem 0.9rem;
		border: 1px solid #d9d4fb;
		border-radius: 7px;
		background: #fff;
		color: var(--purple);
		font: inherit;
		font-size: 0.76rem;
		font-weight: 650;
		cursor: pointer;
	}

	.admin-shell :global(.btn:hover:not(:disabled)) {
		background: #f4f2ff;
	}

	.admin-shell :global(.btn.primary) {
		border-color: var(--purple);
		background: var(--purple);
		color: #fff;
	}

	.admin-shell :global(.btn.primary:hover:not(:disabled)) {
		background: #5b4cd6;
	}

	.admin-shell :global(.btn.danger) {
		border-color: var(--error);
		background: var(--error);
		color: #fff;
	}

	.admin-shell :global(.btn.danger:hover:not(:disabled)) {
		background: #b92a3e;
	}

	.admin-shell :global(.btn.small) {
		padding: 0.3rem 0.6rem;
		font-size: 0.7rem;
	}

	.admin-shell :global(.btn:disabled) {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.admin-shell :global(.btn:focus-visible),
	.admin-shell :global(a:focus-visible) {
		outline: 2px solid var(--purple);
		outline-offset: 2px;
	}

	.admin-shell :global(.notice) {
		margin: 0.9rem 0 0;
		padding: 0.6rem 0.8rem;
		border: 1px solid;
		border-radius: 8px;
		font-size: 0.78rem;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}

	.admin-shell :global(.notice.ok) {
		border-color: #bfe3cd;
		background: #eefaf2;
		color: #1f6a43;
	}

	.admin-shell :global(.notice.error) {
		border-color: #f3c3cb;
		background: #fdecef;
		color: #9b1f33;
	}

	.admin-shell :global(.notice.info) {
		border-color: #d9d4fb;
		background: #f4f2ff;
		color: #3f33a6;
	}

	.admin-shell :global(.notice dl),
	.admin-shell :global(dl.facts) {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.2rem 0.9rem;
		margin: 0;
		font-size: 0.78rem;
	}

	.admin-shell :global(dl.facts dt) {
		color: var(--muted);
	}

	.admin-shell :global(dl.facts dd),
	.admin-shell :global(.notice dd) {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.admin-shell :global(.pill) {
		display: inline-flex;
		align-items: center;
		padding: 0.1rem 0.55rem;
		border-radius: 999px;
		background: #f1f1f5;
		color: #4b4d63;
		font-size: 0.68rem;
		font-weight: 700;
		white-space: nowrap;
	}

	.admin-shell :global(.pill.ok) {
		background: #eefaf2;
		color: #1f6a43;
	}

	.admin-shell :global(.pill.warn) {
		background: #fff6e5;
		color: #8a5a0d;
	}

	.admin-shell :global(.pill.bad) {
		background: #fdecef;
		color: #9b1f33;
	}

	.admin-shell :global(.table-wrap) {
		overflow-x: auto;
	}

	.admin-shell :global(table.data) {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.76rem;
	}

	.admin-shell :global(table.data caption) {
		padding: 0 0 0.5rem;
		text-align: left;
	}

	.admin-shell :global(table.data th),
	.admin-shell :global(table.data td) {
		padding: 0.55rem 0.6rem;
		border-bottom: 1px solid var(--line);
		text-align: left;
		vertical-align: top;
	}

	.admin-shell :global(table.data th) {
		color: var(--muted);
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.admin-shell :global(.sr-only) {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}

	@media (max-width: 40rem) {
		.admin-shell {
			padding: 0.8rem 0.7rem 2rem;
		}
	}
</style>
