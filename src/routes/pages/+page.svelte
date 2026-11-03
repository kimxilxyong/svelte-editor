<script lang="ts">
	/**
	 * @fileoverview Page management of the active project (`/pages`).
	 *
	 * - Multi-page management: Add, duplicate, delete, and configure pages and slugs. A new project has
	 *   no pages; the empty state offers "Add first page". The last page may be deleted as well.
	 * - Persistence: Save writes the pages (and the untouched composites) of the **active project** to the
	 *   database through `/editor/api`; the project is chosen on the Projects page (`/`) or with the
	 *   project chip in the top navigation.
	 * - Canvas settings: Configure page widths (mobile/tablet/desktop) and minimum heights.
	 * - Visual overview: the selected page rendered with the real components via `PageView`
	 *   (same content as the editor, reloaded from the database on every visit), plus an interactive
	 *   Preview mode with working internal links.
	 * - Direct navigation to the visual WYSIWYG editor (`/editor?page=<id>`).
	 * - The SvelteKit folder, export/import and "Create new project" live on the Projects page.
	 * - Right-click menus (see `editor-menus.ts`): a page row offers Edit / Preview / Duplicate /
	 *   Delete / Copy route, the list background Add / Save / Reload, the preview Edit / Preview /
	 *   Save. Right-clicking a row also selects it, so the action targets what the user pointed at.
	 */

	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page as routePage } from '$app/state';
	import BuilderHeader from '../../lib/components/BuilderHeader.svelte';
	import PageView from '../../lib/components/PageView.svelte';
	import { nav, useNavContext } from '../../lib/navigation.svelte.js';
	import CanvasSizePicker from '../../lib/components/CanvasSizePicker.svelte';
	import { useContextMenu } from '../../lib/context-menu.svelte.js';
	import { pageItemMenu, pageListMenu, pagePreviewMenu } from '../../lib/editor-menus.js';
	import {
		canvasLimits,
		defaultCanvasSize,
		type BuilderBlock,
		type EditorComposite,
		type EditorPage,
		type EditorSite
	} from '../../lib/editor.js';

	type ApiResponse = {
		project?: { id: string; name: string } | null;
		site?: EditorSite;
		error?: string;
	};

	/**
	 * Set for `guest` users, who may view but not change the site (the server rejects their writes
	 * as well; this only explains and disables the Save button). Read from the root layout data.
	 */
	const readOnlyNotice = $derived(
		routePage.data.user?.role === 'guest' ? 'Read-only: your role cannot save' : undefined
	);
	const project = $derived(routePage.data.project);

	let pages = $state<EditorPage[]>([]);
	// Kept so saving from this view never drops the composites edited on /composites.
	let composites = $state<EditorComposite[]>([]);
	let selectedId = $state('');
	let busy = $state(true);
	let status = $state('Loading project…');
	let dirty = $state(false);
	// Feeds the shared top navigation (page switcher, labels, unsaved-changes guard).
	useNavContext(() => ({ pages, unsavedChanges: dirty }));
	let slugBeforeEdit = '';
	let isPreview = $state(false);
	let routeError = $state('');

	let selected = $derived(pages.find((page) => page.id === selectedId) ?? pages[0]);
	const contextMenu = useContextMenu();
	const canSave = $derived(!readOnlyNotice && !!project && dirty);

	onMount(() => {
		void load();
	});

	// Another project became active (project chip): show its pages instead.
	let loadedProjectId = routePage.data.project?.id;
	$effect(() => {
		const id = routePage.data.project?.id;
		if (id === loadedProjectId) return;
		loadedProjectId = id;
		void load();
	});

	async function request(
		method: 'GET' | 'POST',
		payload?: { action: 'save'; site: EditorSite }
	): Promise<ApiResponse> {
		const response = await fetch('/editor/api', {
			method,
			cache: 'no-store',
			...(payload
				? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
				: {})
		});
		const result = (await response.json()) as ApiResponse;
		if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status}).`);
		return result;
	}

	function apply(result: ApiResponse) {
		pages = result.site?.pages ?? [];
		composites = result.site?.composites ?? [];
		// Show the page that was just edited in the editor, so recent changes are visible.
		selectedId = pages.find((p) => p.id === nav.lastEditorPageId)?.id ?? pages[0]?.id ?? '';
		dirty = false;
		status = !result.project
			? 'No project yet'
			: pages.length === 0
				? `${result.project.name} · no pages yet`
				: `${result.project.name} · loaded from the database`;
	}

	async function run(label: string, task: () => Promise<void>) {
		busy = true;
		status = label;
		try {
			await task();
		} catch (error) {
			status = error instanceof Error ? error.message : 'Something went wrong.';
		} finally {
			busy = false;
		}
	}

	async function load() {
		await run('Loading project…', async () => apply(await request('GET')));
	}

	async function save() {
		if (readOnlyNotice || !project) return;
		await run('Saving site…', async () => {
			await request('POST', {
				action: 'save',
				site: { pages: $state.snapshot(pages), composites: $state.snapshot(composites) }
			});
			dirty = false;
			status = 'Saved to the database';
		});
	}

	function touch() {
		dirty = true;
		status = 'Unsaved changes';
	}

	function slugify(value: string) {
		return value
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 40);
	}

	function uniqueSlug(value: string, ignoreId?: string) {
		const root = slugify(value) || 'page';
		let slug = root;
		let suffix = 2;
		while (pages.some((page) => page.id !== ignoreId && page.slug === slug)) {
			slug = `${root.slice(0, 36)}-${suffix++}`;
		}
		return slug;
	}

	function addPage() {
		if (pages.length >= 20 || !project) return;
		const number = pages.length + 1;
		const page: EditorPage = {
			id: globalThis.crypto.randomUUID(),
			name: `Page ${number}`,
			slug: uniqueSlug(`page-${number}`),
			width: defaultCanvasSize.width,
			height: defaultCanvasSize.height,
			blocks: []
		};
		pages.push(page);
		selectedId = page.id;
		touch();
	}

	function duplicatePage() {
		if (pages.length >= 20 || !selected) return;
		const source: EditorPage = $state.snapshot(selected);
		const page: EditorPage = {
			...source,
			id: globalThis.crypto.randomUUID(),
			name: `${source.name} copy`.slice(0, 40),
			slug: uniqueSlug(`${source.slug}-copy`),
			blocks: source.blocks.map((block) => ({ ...block, id: globalThis.crypto.randomUUID() }))
		};
		pages.push(page);
		selectedId = page.id;
		touch();
	}

	function deletePage() {
		if (!selected) return;
		const index = pages.findIndex((page) => page.id === selected.id);
		pages = pages.filter((page) => page.id !== selected.id);
		selectedId = pages[Math.min(index, pages.length - 1)]?.id ?? '';
		touch();
	}

	function commitName() {
		if (!selected.name.trim()) selected.name = 'Untitled';
		touch();
	}

	function commitSlug() {
		const previous = slugBeforeEdit;
		selected.slug = uniqueSlug(selected.slug, selected.id);
		if (previous && previous !== selected.slug) {
			// Keep internal links pointing at the renamed route.
			for (const item of pages) {
				for (const block of item.blocks) {
					if (block.href === `/${previous}`) block.href = `/${selected.slug}`;
					else if (block.href.startsWith(`/${previous}#`) || block.href.startsWith(`/${previous}?`))
						block.href = `/${selected.slug}${block.href.slice(previous.length + 1)}`;
				}
			}
		}
		slugBeforeEdit = selected.slug;
		touch();
	}

	function clampSize(field: 'width' | 'height') {
		const [min, max] =
			field === 'width'
				? [canvasLimits.minWidth, canvasLimits.maxWidth]
				: [canvasLimits.minHeight, canvasLimits.maxHeight];
		selected[field] = Math.round(Math.max(min, Math.min(max, Number(selected[field]) || min)));
		touch();
	}

	function editPage(id: string) {
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() is applied to the base path
		void goto(`${resolve('/editor')}?page=${encodeURIComponent(id)}`);
	}

	/** Menu of one page row; selecting it first makes Duplicate / Delete act on that page. */
	function pageRowEntries(target: EditorPage) {
		selectedId = target.id;
		return pageItemMenu({
			name: target.name,
			canDuplicate: pages.length < 20,
			canDelete: true,
			edit: () => editPage(target.id),
			preview: () => {
				isPreview = true;
				routeError = '';
			},
			duplicate: duplicatePage,
			remove: deletePage,
			copyRoute: () => void navigator.clipboard?.writeText(`/${target.slug}`).catch(() => {})
		});
	}

	function pageListEntries() {
		return pageListMenu({
			canAdd: pages.length < 20 && !!project,
			canSave,
			add: addPage,
			save: () => void save(),
			reload: () => {
				if (!dirty || confirm('Discard unsaved changes and reload the saved site?')) void load();
			},
			openComposites: () => void goto(resolve('/composites'))
		});
	}

	function pagePreviewEntries() {
		if (!selected) return [];
		const target = selected;
		return pagePreviewMenu({
			previewing: isPreview,
			canSave,
			edit: () => editPage(target.id),
			togglePreview,
			save: () => void save()
		});
	}

	function togglePreview() {
		isPreview = !isPreview;
		routeError = '';
	}

	// In Preview, internal links jump to the matching page like they would on the live site.
	function followLink(event: MouseEvent, block: BuilderBlock) {
		if (!block.href.startsWith('/')) return;
		event.preventDefault();
		const slug = block.href.slice(1).split(/[?#]/)[0];
		const target = slug === '' ? pages[0] : pages.find((page) => page.slug === slug);
		if (target) {
			selectedId = target.id;
			routeError = '';
		} else {
			routeError = `No page found at ${block.href}`;
		}
	}
</script>

<svelte:head>
	<title>Pages{project ? ` · ${project.name}` : ''}</title>
	<meta name="description" content="Manage the pages, routes and canvas sizes of your project" />
</svelte:head>

<div class="editor-shell">
	<BuilderHeader
		{status}
		{busy}
		unsaved={dirty}
		{canSave}
		{readOnlyNotice}
		title={project?.name ?? 'No project'}
		onsave={save}
		previewing={isPreview}
		onpreview={selected ? togglePreview : undefined}
	/>

	<div class="workspace" class:preview-mode={isPreview}>
		{#if !isPreview}
			<aside class="palette-panel" aria-label="Pages" {@attach contextMenu.attach(pageListEntries)}>
				<div class="panel-heading">
					<div>
						<p class="eyebrow">{project ? project.name.toUpperCase() : 'NO PROJECT'}</p>
						<h2>Pages</h2>
					</div>
					<span class="count-pill">{pages.length}</span>
				</div>
				<p class="panel-hint">
					{#if !project}
						Create a project first.
					{:else if pages.length === 0}
						This project has no pages yet.
					{:else}
						Select a page to edit its route and canvas size.
					{/if}
				</p>
				<ul class="page-list" aria-label="Pages">
					{#each pages as page (page.id)}
						<li>
							<button
								type="button"
								class="page-item"
								class:active={selected && page.id === selected.id}
								aria-current={selected && page.id === selected.id ? 'page' : undefined}
								onclick={() => (selectedId = page.id)}
								{@attach contextMenu.attach(() => pageRowEntries(page))}
							>
								<strong>{page.name}</strong>
								<small>/{page.slug} · {page.width}px · {page.blocks.length} items</small>
							</button>
						</li>
					{/each}
				</ul>
				<div class="actions">
					<button type="button" disabled={pages.length >= 20 || !project} onclick={addPage}>
						Add
					</button>
					<button type="button" disabled={pages.length >= 20 || !selected} onclick={duplicatePage}>
						Duplicate
					</button>
					<button type="button" class="danger" disabled={!selected} onclick={deletePage}>
						Delete
					</button>
				</div>
			</aside>
		{/if}

		<section
			class="canvas-panel"
			aria-label="Page overview"
			{@attach contextMenu.attach(pagePreviewEntries)}
		>
			<div class="canvas-toolbar">
				<div class="canvas-label">
					<span class="live-dot" aria-hidden="true"></span>
					<span>{isPreview ? 'Live preview' : 'Page overview'}</span>
					{#if selected}<span class="canvas-path">/{selected.slug}</span>{/if}
				</div>
				{#if selected && !isPreview}
					<a class="edit-link" href="{resolve('/editor')}?page={selected.id}">Edit this page →</a>
				{/if}
			</div>
			<div class="canvas-stage">
				{#if !selected}
					<div class="empty-state" data-testid="pages-empty">
						{#if project}
							<h3>No pages yet</h3>
							<p>
								<strong>{project.name}</strong> starts empty. Add the first page, then open it in the
								editor to place widgets.
							</p>
							<button
								type="button"
								class="primary-action"
								disabled={!!readOnlyNotice}
								onclick={addPage}
							>
								Add first page
							</button>
						{:else}
							<h3>No project yet</h3>
							<p>Pages belong to a project. Create one on the Projects page first.</p>
							<a class="primary-action" href={resolve('/')}>Go to Projects</a>
						{/if}
					</div>
				{:else}
					<PageView
						page={selected}
						{composites}
						theme={routePage.data.siteTheme}
						interactive={isPreview}
						onlink={followLink}
					/>
				{/if}
			</div>
			<p class="canvas-footnote">
				{selected ? `${selected.width} × ${selected.height} px` : ''}
				{#if routeError}<span class="route-error" role="alert"> · {routeError}</span>{/if}
			</p>
		</section>

		{#if !isPreview}
			<aside class="inspector-panel" aria-label="Page settings">
				<div class="panel-heading">
					<div>
						<p class="eyebrow">MAKE IT YOURS</p>
						<h2>Page settings</h2>
					</div>
				</div>
				{#if selected}
					<div class="inspector-content">
						<label class="field-label" for="page-name">Name</label>
						<input
							id="page-name"
							class="field-control"
							maxlength="40"
							bind:value={selected.name}
							oninput={touch}
							onchange={commitName}
						/>
						<label class="field-label" for="page-slug">Route</label>
						<div class="slug">
							<span aria-hidden="true">/</span>
							<input
								id="page-slug"
								class="field-control"
								maxlength="40"
								bind:value={selected.slug}
								onfocus={() => (slugBeforeEdit = selected.slug)}
								onchange={commitSlug}
							/>
						</div>
						<label class="field-label" for="canvas-size">Canvas size</label>
						<CanvasSizePicker
							id="canvas-size"
							bind:width={selected.width}
							bind:height={selected.height}
							onchange={touch}
						/>
						<div class="position-fields">
							<div>
								<label class="field-label" for="canvas-width">Width (px)</label>
								<input
									id="canvas-width"
									class="field-control"
									type="number"
									min={canvasLimits.minWidth}
									max={canvasLimits.maxWidth}
									step="10"
									bind:value={selected.width}
									onchange={() => clampSize('width')}
								/>
							</div>
							<div>
								<label class="field-label" for="canvas-height">Min height (px)</label>
								<input
									id="canvas-height"
									class="field-control"
									type="number"
									min={canvasLimits.minHeight}
									max={canvasLimits.maxHeight}
									step="10"
									bind:value={selected.height}
									onchange={() => clampSize('height')}
								/>
							</div>
						</div>
					</div>
				{/if}
			</aside>
		{/if}
	</div>
</div>

<style>
	:global(main:has(.editor-shell)) {
		width: 100%;
		max-width: none;
		padding: 0;
	}

	.editor-shell {
		--ink: #20233a;
		--muted: #898ba0;
		--line: #e9e9f0;
		--purple: #6b5ce7;
		min-height: calc(100vh - 3rem);
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

	.workspace {
		display: grid;
		min-height: calc(100vh - 7.75rem);
		grid-template-columns: 252px minmax(0, 1fr) 276px;
	}

	.palette-panel {
		display: flex;
		height: 100%;
		min-height: 0;
		flex-direction: column;
		padding: 1.5rem 1.1rem;
		border-right: 1px solid var(--line);
	}

	.inspector-panel {
		padding: 1.5rem 1.1rem;
		border-left: 1px solid var(--line);
		background: #fff;
	}

	.panel-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.panel-heading h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: -0.025em;
	}

	.count-pill {
		display: grid;
		width: 25px;
		height: 25px;
		place-items: center;
		border-radius: 8px;
		background: #f4f2ff;
		color: var(--purple);
		font-size: 0.72rem;
		font-weight: 700;
	}

	.panel-hint {
		margin: 0.8rem 0 1.15rem;
		color: var(--muted);
		font-size: 0.72rem;
		line-height: 1.55;
	}

	.canvas-panel {
		display: flex;
		min-width: 0;
		flex-direction: column;
		padding: 1.2rem 1.3rem 0.8rem;
	}

	.canvas-toolbar {
		display: flex;
		min-height: 38px;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 0 0.2rem 0.8rem;
		color: #65677e;
		font-size: 0.69rem;
		font-weight: 600;
	}

	.canvas-label {
		gap: 0.5rem;
	}

	.canvas-path {
		margin-left: 0.2rem;
		padding: 0.22rem 0.45rem;
		border: 1px solid #e9e9f0;
		border-radius: 5px;
		color: #9a9bac;
		font-size: 0.62rem;
		font-weight: 500;
	}

	.field-label {
		display: block;
		margin: 0.85rem 0 0.4rem;
		color: #686a80;
		font-size: 0.67rem;
		font-weight: 650;
	}

	.position-fields {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.15rem 0.6rem;
	}

	.field-control {
		display: block;
		width: 100%;
		min-height: 37px;
		padding: 0.55rem 0.65rem;
		border: 1px solid #e7e7ee;
		border-radius: 7px;
		background: #fff;
		color: #33354a;
		font: inherit;
		font-size: 0.7rem;
		outline: none;
	}

	.field-control:focus {
		border-color: #978be9;
		box-shadow: 0 0 0 3px rgb(119 102 223 / 12%);
	}

	.canvas-label {
		display: flex;
		align-items: center;
	}

	.live-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #69c89d;
	}

	.actions button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	h2,
	p {
		margin-top: 0;
	}

	.page-list {
		list-style: none;
		margin: 0 0 0.6rem;
		padding: 0;
		display: flex;
		flex: 1 1 0;
		min-height: 0;
		flex-direction: column;
		gap: 0.3rem;
		overflow-y: auto;
	}

	.page-item {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.1rem;
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: #fff;
		color: var(--ink);
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
	}

	.page-item small {
		color: var(--muted);
		font-size: 0.65rem;
	}

	.page-item.active {
		border-color: #c9c1ff;
		background: #faf9ff;
	}

	.actions {
		display: flex;
		gap: 0.35rem;
	}

	.actions button {
		flex: 1;
		min-height: 34px;
		border: 1px solid #e6e3f5;
		border-radius: 8px;
		background: #fff;
		color: #4b456f;
		font: inherit;
		font-size: 0.72rem;
		font-weight: 650;
		cursor: pointer;
	}

	.actions .danger {
		color: #b3261e;
	}

	.slug {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	.edit-link {
		color: #7a70c4;
		font-size: 0.72rem;
		font-weight: 650;
	}

	.canvas-stage {
		display: flex;
		min-height: 520px;
		flex: 1;
		align-items: flex-start;
		justify-content: center;
		padding: 1.2rem;
		overflow: auto;
		border: 1px solid #ebebf1;
		border-radius: 12px;
		background-color: #efeff4;
		background-image: radial-gradient(#d8d8e2 0.7px, transparent 0.7px);
		background-size: 14px 14px;
	}

	.workspace.preview-mode {
		grid-template-columns: minmax(0, 1fr);
	}

	.route-error {
		color: #c0392b;
	}

	.canvas-footnote {
		margin: 0.7rem 0 0;
		color: #999aab;
		font-size: 0.66rem;
		text-align: center;
	}

	.empty-state {
		display: flex;
		max-width: 26rem;
		flex-direction: column;
		align-items: center;
		align-self: center;
		gap: 0.2rem;
		padding: 2rem 1.5rem;
		border: 1px dashed #d4cff3;
		border-radius: 14px;
		background: #fff;
		color: #65677e;
		text-align: center;
	}

	.empty-state h3 {
		margin: 0;
		color: var(--ink);
		font-size: 1rem;
	}

	.empty-state p {
		margin: 0.2rem 0 0.9rem;
		font-size: 0.76rem;
		line-height: 1.55;
	}

	.primary-action {
		display: inline-flex;
		min-height: 36px;
		align-items: center;
		padding: 0 1.1rem;
		border: 0;
		border-radius: 9px;
		background: var(--purple);
		color: #fff;
		font: inherit;
		font-size: 0.76rem;
		font-weight: 700;
		text-decoration: none;
		cursor: pointer;
	}

	.primary-action:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	@media (max-width: 1050px) {
		.workspace {
			grid-template-columns: 220px minmax(0, 1fr);
		}

		.inspector-panel {
			grid-column: 1 / -1;
			border-top: 1px solid var(--line);
			border-left: 0;
		}
	}

	@media (max-width: 700px) {
		.workspace {
			grid-template-columns: 1fr;
		}
	}
</style>
