<script lang="ts">
	/**
	 * @component AppNav
	 *
	 * The **one and only top navigation** of the application. It is mounted once in the root layout
	 * (`routes/+layout.svelte`), so every route – including `/admin`, `/account` and the sign-in
	 * pages – shows exactly the same bar. (It replaced the former SVG-styled `Header.svelte` plus
	 * the per-route `AppNav`.)
	 *
	 * | Question          | UI element                                                       |
	 * | ----------------- | ---------------------------------------------------------------- |
	 * | Where am I?       | Breadcrumb (`Pages › Editor · Home`) and the highlighted tab     |
	 * | Where was I?      | Back button label ("Back to …") and the History menu            |
	 * | Where can I go?   | Tabs (Pages / Editor / Components / Admin / About), the "Open page" switcher, History forward |
	 * | Go back one step  | Back button – identical to the browser Back button               |
	 * | Who am I?         | `UserMenu` (account, sign out) at the right end                  |
	 *
	 * ## Browser history integration
	 * All navigation uses real SvelteKit navigation (`<a href>` / `goto`), so every step is a
	 * browser history entry. Back/Forward call `history.back()` / `history.forward()`; the trail
	 * shown here is kept in sync by the root layout (`afterNavigate`), so browser buttons, the
	 * keyboard and these app buttons always agree.
	 *
	 * ## Role-aware tabs
	 * The signed-in user's role is read from the root layout data (`page.data.user`, see
	 * `+layout.server.ts`). A tab is rendered only when the central access policy (`canAccess`)
	 * lets that role open its route, so e.g. "Admin" is visible for admins only and "Components"
	 * for power users and above; anonymous visitors see "About" and "Sign in". This is a
	 * convenience: the server hook remains the enforcement point.
	 *
	 * ## Route context (no props)
	 * Because the bar lives in the layout, routes cannot pass props. Routes with pages call
	 * `useNavContext(() => ({ pages, activePageId, unsavedChanges }))` from `navigation.svelte.ts`;
	 * this component reads `nav.pages`, `nav.activePageId` and `nav.unsavedChanges`. On routes that
	 * do not publish anything (admin, about, login …) the "Open page" switcher is simply hidden.
	 * The unsaved flag is consumed by the layout's `beforeNavigate` confirmation.
	 *
	 * @example
	 * <!-- +layout.svelte -->
	 * <AppNav />
	 */
	import { browser } from '$app/env';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page as routePage } from '$app/state';
	import logo from '#lib/images/svelte-logo.svg';
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
	import { goBack, goForward, goToEntry, nav } from '../navigation.svelte.js';
	import UserMenu from './UserMenu.svelte';

	/** Context published by the active route (see `useNavContext`). */
	const pages = $derived(nav.pages);
	const activePageId = $derived(nav.activePageId);

	let historyOpen = $state(false);

	// `url.search` is unavailable while prerendering, so the query string is only included in the
	// browser. Server HTML therefore shows the bare path.
	const currentPath = $derived(browser ? toPath(routePage.url) : routePage.url.pathname);
	const onEditor = $derived(splitPath(currentPath).pathname === '/editor');
	const onPages = $derived(splitPath(currentPath).pathname === '/');
	const onComposites = $derived(splitPath(currentPath).pathname === '/composites');
	const onComponents = $derived(splitPath(currentPath).pathname === componentEditorPath);
	const onTheme = $derived(splitPath(currentPath).pathname === '/theme');
	const onAdmin = $derived(splitPath(currentPath).pathname.startsWith('/admin'));
	const onAbout = $derived(splitPath(currentPath).pathname === '/about');

	/** Role of the signed-in user (`null` while anonymous); drives which tabs are shown. */
	const role = $derived(routePage.data.user?.role ?? null);
	const showPages = $derived(canAccess(role, '/'));
	const showEditor = $derived(canAccess(role, '/editor'));
	const showComposites = $derived(canAccess(role, '/composites'));
	const showComponents = $derived(canAccess(role, componentEditorPath));
	const showTheme = $derived(canAccess(role, '/theme'));
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

	// Without access to the page list (anonymous on /login, /setup …) the "Pages" root would only
	// bounce back to the sign-in page, so the breadcrumb shows just the current location and the
	// Back button never offers the "Pages" fallback.
	const crumbs = $derived(
		showPages
			? breadcrumbsFor(currentPath, nav.pageNames)
			: [{ label: describePath(currentPath, nav.pageNames).label, path: null }]
	);
	const rawBack = $derived(backTarget(nav.trail, currentPath));
	const back = $derived(rawBack?.kind === 'parent' && !showPages ? null : rawBack);
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
	<a class="brand" href={resolve('/')} aria-label="Page Builder – home">
		<img src={logo} alt="" />
	</a>

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
		{#if showComposites}
			<li>
				<a
					href={resolve('/composites')}
					class:active={onComposites}
					aria-current={onComposites ? 'page' : undefined}
				>
					Composites
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
					Code
				</a>
			</li>
		{/if}
		{#if showTheme}
			<li>
				<a
					href={resolve('/theme')}
					class:active={onTheme}
					aria-current={onTheme ? 'page' : undefined}
				>
					Theme
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
		<li>
			<a
				href={resolve('/about')}
				class:active={onAbout}
				aria-current={onAbout ? 'page' : undefined}
			>
				About
			</a>
		</li>
	</ul>

	{#if pages.length > 0}
		<label class="switcher">
			<span>Open page</span>
			<select value={switcherValue} onchange={(event) => openPage(event.currentTarget.value)}>
				<option value="" disabled>Choose…</option>
				{#each pages as item (item.id)}
					<option value={item.id}>{item.name}</option>
				{/each}
			</select>
		</label>
	{/if}

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

	<UserMenu />
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

	.brand {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 9px;
	}

	.brand:hover {
		background: #eeeaff;
	}

	.brand:focus-visible {
		outline: 2px solid var(--purple, #6b5ce7);
		outline-offset: 2px;
	}

	.brand img {
		width: 22px;
		height: 22px;
		object-fit: contain;
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
