<script lang="ts">
	/**
	 * @component AppNav
	 *
	 * Application navigation strip shown at the top of both builder routes (`/` page list and
	 * `/editor` single-page editor). It answers four questions at any time:
	 *
	 * | Question          | UI element                                                       |
	 * | ----------------- | ---------------------------------------------------------------- |
	 * | Where am I?       | Breadcrumb (`Pages › Editor · Home`) and the highlighted tab     |
	 * | Where was I?      | Back button label ("Back to …") and the History menu            |
	 * | Where can I go?   | Tabs (Pages / Editor / Components / Admin), the "Open page" switcher, History forward |
	 * | Go back one step  | Back button – identical to the browser Back button               |
	 *
	 * ## Browser history integration
	 * All navigation uses real SvelteKit navigation (`<a href>` / `goto`), so every step is a
	 * browser history entry. Back/Forward call `history.back()` / `history.forward()`; the trail
	 * shown here is kept in sync by the root layout (`afterNavigate`), so browser buttons, the
	 * keyboard and these app buttons always agree.
	 *
	 * ## Role-aware tabs
	 * The signed-in user's role is read from the root layout data (`page.data.user`, see
	 * `+layout.server.ts`) – no prop needed. A tab is rendered only when the central access policy
	 * (`requiredRoleFor` via `canAccess`) lets that role open its route, so e.g. "Admin" is visible
	 * for admins only and "Components" for power users and above. This is a convenience: the server
	 * hook remains the enforcement point.
	 *
	 * ## Unsaved changes
	 * The host route passes `unsavedChanges`; the root layout then asks for confirmation before
	 * leaving the route (see `+layout.svelte`).
	 *
	 * @prop {{ id: string; name: string }[]} [pages=[]] - Pages of the site, used for the switcher and labels (empty on routes without pages, e.g. the component editor).
	 * @prop {string | null} [activePageId=null] - Page currently selected in the host route (editor).
	 * @prop {boolean} [unsavedChanges=false] - Whether leaving the route would discard edits.
	 *
	 * @example
	 * <AppNav {pages} activePageId={currentPageId} unsavedChanges={hasUnsavedChanges} />
	 */
	import { browser } from '$app/env';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page as routePage } from '$app/state';
	import {
		backTarget,
		breadcrumbsFor,
		describePath,
		forwardTarget,
		splitPath,
		toPath,
		componentEditorPath
	} from '../navigation-trail.js';
	import { canAccess } from '../auth/access.js';
	import { goBack, goForward, goToEntry, nav, rememberPages } from '../navigation.svelte.js';

	interface Props {
		pages?: { id: string; name: string }[];
		activePageId?: string | null;
		unsavedChanges?: boolean;
	}

	let { pages = [], activePageId = null, unsavedChanges = false }: Props = $props();

	let historyOpen = $state(false);

	// `url.search` is unavailable while prerendering (both routes are prerendered), so the
	// query string is only included in the browser. Server HTML therefore shows the bare path.
	const currentPath = $derived(browser ? toPath(routePage.url) : routePage.url.pathname);
	const onEditor = $derived(splitPath(currentPath).pathname === '/editor');
	const onPages = $derived(splitPath(currentPath).pathname === '/');
	const onComponents = $derived(splitPath(currentPath).pathname === componentEditorPath);
	const onAdmin = $derived(splitPath(currentPath).pathname.startsWith('/admin'));

	/** Role of the signed-in user (`null` while anonymous); drives which tabs are shown. */
	const role = $derived(routePage.data.user?.role ?? null);
	const showPages = $derived(canAccess(role, '/'));
	const showEditor = $derived(canAccess(role, '/editor'));
	const showComponents = $derived(canAccess(role, componentEditorPath));
	const showAdmin = $derived(canAccess(role, '/admin'));

	/** Page the "Editor" tab opens: the active one, else the last edited one, else the first. */
	const editorTargetId = $derived.by(() => {
		const candidates = [activePageId, nav.lastEditorPageId, pages[0]?.id];
		return candidates.find((id) => id && pages.some((item) => item.id === id)) ?? null;
	});
	const editorHref = $derived(
		editorTargetId
			? resolve(`/editor?page=${encodeURIComponent(editorTargetId)}`)
			: resolve('/editor')
	);
	const switcherValue = $derived(onEditor ? (activePageId ?? '') : '');

	const crumbs = $derived(breadcrumbsFor(currentPath, nav.pageNames));
	const back = $derived(backTarget(nav.trail, currentPath));
	const backLabel = $derived(back ? describePath(back.path, nav.pageNames).label : null);
	const forwardPath = $derived(forwardTarget(nav.trail));
	const forwardLabel = $derived(
		forwardPath ? describePath(forwardPath, nav.pageNames).label : null
	);
	const entries = $derived(
		nav.trail.entries.map((path, index) => ({
			index,
			label: describePath(path, nav.pageNames).label,
			state: index === nav.trail.index ? 'current' : index < nav.trail.index ? 'visited' : 'forward'
		}))
	);

	$effect(() => {
		rememberPages(pages);
	});

	$effect(() => {
		nav.unsavedChanges = unsavedChanges;
		return () => {
			nav.unsavedChanges = false;
		};
	});

	/** Opens the chosen page in the editor (a new history entry, so Back returns here). */
	function openPage(id: string) {
		if (!id) return;
		void goto(resolve(`/editor?page=${encodeURIComponent(id)}`));
	}

	function jumpTo(index: number) {
		historyOpen = false;
		goToEntry(index);
	}
</script>

<nav class="app-nav" aria-label="Application navigation">
	<div class="nav-group" role="group" aria-label="History navigation">
		<button
			type="button"
			class="back-button"
			disabled={!back}
			aria-label={backLabel ? `Back to ${backLabel}` : 'Back (nothing to go back to)'}
			title={backLabel ? `Back to ${backLabel} (Alt+←)` : 'Nothing to go back to'}
			onclick={() => goBack(currentPath)}
		>
			<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 4 6 10l6 6M6.5 10H17" /></svg>
			<span class="back-text">
				Back
				{#if backLabel}<small>{backLabel}</small>{/if}
			</span>
		</button>
		<button
			type="button"
			class="icon-button"
			disabled={!forwardPath}
			aria-label={forwardLabel ? `Forward to ${forwardLabel}` : 'Forward (nothing ahead)'}
			title={forwardLabel ? `Forward to ${forwardLabel} (Alt+→)` : 'Nothing to go forward to'}
			onclick={goForward}
		>
			<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 4 6 6-6 6M13.5 10H3" /></svg>
		</button>
	</div>

	<ol class="breadcrumbs" aria-label="You are here">
		{#each crumbs as crumb, i (i)}
			<li aria-current={crumb.path === null ? 'page' : undefined}>
				{#if crumb.path !== null}
					<a href={resolve('/')}>{crumb.label}</a>
					<span class="separator" aria-hidden="true">›</span>
				{:else}
					<strong>{crumb.label}</strong>
				{/if}
			</li>
		{/each}
	</ol>

	<ul class="tabs" aria-label="Go to">
		{#if showPages}
			<li>
				<a href={resolve('/')} class:active={onPages} aria-current={onPages ? 'page' : undefined}>
					Pages
				</a>
			</li>
		{/if}
		{#if showEditor}
			<li>
				<a href={editorHref} class:active={onEditor} aria-current={onEditor ? 'page' : undefined}>
					Editor
				</a>
			</li>
		{/if}
		{#if showComponents}
			<li>
				<a
					href={resolve('/component-editor')}
					class:active={onComponents}
					aria-current={onComponents ? 'page' : undefined}
				>
					Components
				</a>
			</li>
		{/if}
		{#if showAdmin}
			<li>
				<a
					href={resolve('/admin')}
					class:active={onAdmin}
					aria-current={onAdmin ? 'page' : undefined}
				>
					Admin
				</a>
			</li>
		{/if}
	</ul>

	<label class="switcher">
		<span>Open page</span>
		<select
			value={switcherValue}
			disabled={pages.length === 0}
			onchange={(event) => openPage(event.currentTarget.value)}
		>
			<option value="" disabled>Choose…</option>
			{#each pages as item (item.id)}
				<option value={item.id}>{item.name}</option>
			{/each}
		</select>
	</label>

	<details class="trail" bind:open={historyOpen}>
		<summary>History <span class="count">{entries.length}</span></summary>
		<ol class="trail-list" aria-label="Visited locations, oldest first">
			{#each entries as entry (entry.index)}
				<li>
					<button
						type="button"
						class={entry.state}
						aria-current={entry.state === 'current' ? 'location' : undefined}
						disabled={entry.state === 'current'}
						onclick={() => jumpTo(entry.index)}
					>
						<span class="marker" aria-hidden="true">
							{entry.state === 'current' ? '●' : entry.state === 'visited' ? '←' : '→'}
						</span>
						{entry.label}
						<small>
							{entry.state === 'current'
								? 'you are here'
								: entry.state === 'visited'
									? 'was here'
									: 'forward'}
						</small>
					</button>
				</li>
			{/each}
		</ol>
	</details>
</nav>

<style>
	.app-nav {
		position: relative;
		z-index: 5;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem 1.1rem;
		padding: 0.45rem 1.5rem;
		border-bottom: 1px solid var(--line, #e9e9f0);
		background: #fbfbfd;
		font-size: 0.76rem;
	}

	.nav-group {
		display: flex;
		gap: 0.35rem;
	}

	button,
	select {
		font: inherit;
	}

	.back-button,
	.icon-button {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 32px;
		padding: 0 0.7rem;
		border: 1px solid var(--line, #e9e9f0);
		border-radius: 9px;
		background: #fff;
		color: var(--ink, #20233a);
		font-weight: 650;
		cursor: pointer;
	}

	.icon-button {
		justify-content: center;
		width: 32px;
		padding: 0;
	}

	.back-button:hover:not(:disabled),
	.icon-button:hover:not(:disabled) {
		border-color: var(--purple, #6b5ce7);
		color: var(--purple, #6b5ce7);
	}

	.back-button:disabled,
	.icon-button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.back-button:focus-visible,
	.icon-button:focus-visible,
	.tabs a:focus-visible,
	.breadcrumbs a:focus-visible,
	.switcher select:focus-visible,
	.trail summary:focus-visible,
	.trail-list button:focus-visible {
		outline: 2px solid var(--purple, #6b5ce7);
		outline-offset: 2px;
	}

	svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.8;
	}

	.back-text {
		display: inline-flex;
		flex-direction: column;
		align-items: flex-start;
		line-height: 1.05;
	}

	.back-text small {
		max-width: 11rem;
		overflow: hidden;
		color: var(--muted, #898ba0);
		font-size: 0.62rem;
		font-weight: 500;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.breadcrumbs {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.breadcrumbs li {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}

	.breadcrumbs a {
		color: var(--muted, #898ba0);
		text-decoration: none;
	}

	.breadcrumbs a:hover {
		color: var(--purple, #6b5ce7);
		text-decoration: underline;
	}

	.separator {
		color: #c2c3d1;
	}

	.breadcrumbs strong {
		color: var(--ink, #20233a);
		font-weight: 700;
	}

	.tabs {
		display: flex;
		gap: 0.25rem;
		margin: 0 0 0 auto;
		padding: 0;
		list-style: none;
	}

	.tabs a {
		display: inline-flex;
		align-items: center;
		min-height: 30px;
		padding: 0 0.85rem;
		border-radius: 8px;
		color: var(--ink, #20233a);
		font-weight: 650;
		text-decoration: none;
	}

	.tabs a:hover {
		background: #eeeaff;
	}

	.tabs a.active {
		background: var(--purple, #6b5ce7);
		color: #fff;
	}

	.switcher {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--muted, #898ba0);
	}

	.switcher select {
		min-height: 30px;
		max-width: 12rem;
		padding: 0 1.6rem 0 0.55rem;
		border: 1px solid var(--line, #e9e9f0);
		border-radius: 8px;
		background-color: #fff;
		color: var(--ink, #20233a);
	}

	.trail {
		position: relative;
	}

	.trail summary {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 30px;
		padding: 0 0.7rem;
		border: 1px solid var(--line, #e9e9f0);
		border-radius: 8px;
		background: #fff;
		color: var(--ink, #20233a);
		font-weight: 650;
		cursor: pointer;
		list-style: none;
	}

	.trail summary::-webkit-details-marker {
		display: none;
	}

	.count {
		min-width: 1.2rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: #eeeaff;
		color: var(--purple, #6b5ce7);
		font-size: 0.65rem;
		text-align: center;
	}

	.trail-list {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		display: grid;
		min-width: 15rem;
		max-height: 18rem;
		margin: 0;
		padding: 0.35rem;
		overflow: auto;
		border: 1px solid var(--line, #e9e9f0);
		border-radius: 10px;
		background: #fff;
		box-shadow: 0 10px 30px rgb(32 35 58 / 14%);
		list-style: none;
	}

	.trail-list button {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.55rem;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: var(--ink, #20233a);
		text-align: left;
		cursor: pointer;
	}

	.trail-list button:hover:not(:disabled) {
		background: #f3f1ff;
	}

	.trail-list button:disabled {
		background: #eeeaff;
		cursor: default;
		font-weight: 700;
	}

	.trail-list small {
		margin-left: auto;
		color: var(--muted, #898ba0);
		font-size: 0.62rem;
	}

	.trail-list .forward {
		color: var(--purple, #6b5ce7);
	}

	.marker {
		width: 1rem;
		text-align: center;
	}

	@media (max-width: 720px) {
		.app-nav {
			padding: 0.45rem 0.9rem;
		}

		.tabs {
			margin-left: 0;
		}
	}
</style>
