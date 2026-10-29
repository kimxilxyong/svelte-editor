<script lang="ts">
	/**
	 * @fileoverview Site & Multi-Page Management Home View (`/`).
	 *
	 * Serves as the central administration cockpit for website projects:
	 * - Multi-page management: Add, duplicate, delete, and configure pages and slugs.
	 * - SQLite persistence: Create tables and save/load entire `EditorSite` models.
	 * - Canvas settings: Configure page widths (mobile/tablet/desktop) and minimum heights.
	 * - SvelteKit project sync:
	 *   - Browse server filesystem via `DirectoryPickerModal`.
	 *   - Two-way export & import of native `.svelte` components and route pages.
	 * - Visual preview: Live scaled thumbnail view of page layout and blocks.
	 * - Direct navigation to the visual WYSIWYG editor (`/editor?page=<id>`).
	 */

	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import DirectoryPickerModal from '../lib/components/DirectoryPickerModal.svelte';
	import AppNav from '../lib/components/AppNav.svelte';
	import { canvasLimits, type EditorPage, type EditorSite } from '../lib/editor.js';

	type ApiResponse = { created?: boolean; site?: EditorSite | null; error?: string };

	let pages = $state<EditorPage[]>([]);
	let selectedId = $state('');
	let databaseReady = $state(false);
	let busy = $state(true);
	let status = $state('Checking SQLite…');
	let dirty = $state(false);
	let slugBeforeEdit = '';
	let projectRoot = $state('');
	let projectMessage = $state('');
	let projectDetails = $state<string[]>([]);
	let showPickerModal = $state(false);

	let selected = $derived(pages.find((page) => page.id === selectedId) ?? pages[0]);
	let overviewHeight = $derived(
		selected
			? Math.max(selected.height, ...selected.blocks.map((block) => block.y + block.height + 40))
			: 0
	);

	onMount(() => {
		projectRoot = localStorage.getItem('editor-project-root') ?? '';
		void load();
	});

	async function request(
		method: 'GET' | 'POST',
		payload?: { action: 'create-tables' } | { action: 'save'; site: EditorSite }
	): Promise<ApiResponse> {
		const response = await fetch('/editor/api', {
			method,
			...(payload
				? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
				: {})
		});
		const result = (await response.json()) as ApiResponse;
		if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status}).`);
		return result;
	}

	function apply(result: ApiResponse) {
		databaseReady = result.created === true;
		if (!databaseReady) {
			status = 'Create tables to enable saving';
			return;
		}
		if (result.site) {
			pages = result.site.pages;
			selectedId = pages[0].id;
			dirty = false;
			status = 'Saved site loaded from SQLite';
		} else {
			status = 'SQLite ready · site not saved';
		}
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
		await run('Checking SQLite…', async () => apply(await request('GET')));
	}

	async function createTables() {
		await run('Creating SQLite tables…', async () => {
			await request('POST', { action: 'create-tables' });
			apply(await request('GET'));
		});
	}

	async function save() {
		await run('Saving site…', async () => {
			await request('POST', { action: 'save', site: { pages: $state.snapshot(pages) } });
			dirty = false;
			status = 'Saved to SQLite';
		});
	}

	type FileNote = { file: string; reason: string };

	async function projectRequest(
		payload:
			{ action: 'export'; root: string; site: EditorSite } | { action: 'import'; root: string }
	) {
		const response = await fetch('/editor/api/project', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});
		const result = await response.json();
		if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status}).`);
		return result;
	}

	async function exportProject() {
		const root = projectRoot.trim();
		localStorage.setItem('editor-project-root', root);
		await run('Exporting…', async () => {
			const result: { written: string[]; skipped: FileNote[] } = await projectRequest({
				action: 'export',
				root,
				site: { pages: $state.snapshot(pages) }
			});
			projectMessage = `Exported ${result.written.length} files${result.skipped.length ? `, skipped ${result.skipped.length}` : ''}.`;
			projectDetails = [
				...result.written.map((file) => `wrote ${file}`),
				...result.skipped.map((item) => `skipped ${item.file} (${item.reason})`)
			];
			status = projectMessage;
		});
	}

	async function importProject() {
		const root = projectRoot.trim();
		localStorage.setItem('editor-project-root', root);
		await run('Importing…', async () => {
			const result: {
				pages: EditorPage[];
				components: { name: string; fileName: string; props: unknown[] }[];
				skipped: FileNote[];
			} = await projectRequest({
				action: 'import',
				root
			});
			const merged = [...pages];
			for (const page of result.pages) {
				const index = merged.findIndex((item) => item.slug === page.slug);
				if (index >= 0) merged[index] = { ...page, id: merged[index].id };
				else if (merged.length < 20) merged.push(page);
			}
			pages = merged;
			if (!pages.some((page) => page.id === selectedId)) selectedId = pages[0]?.id ?? '';
			if (result.pages.length > 0 || (result.components && result.components.length > 0)) touch();
			const compCount = result.components?.length ?? 0;
			projectMessage = `Imported ${result.pages.length} pages, ${compCount} components${result.skipped.length ? `, skipped ${result.skipped.length}` : ''}.`;
			projectDetails = [
				...(result.components?.map((c) => `component ${c.name} (${c.fileName})`) ?? []),
				...result.pages.map((page) => `read /${page.slug}`),
				...result.skipped.map((item) => `skipped ${item.file} (${item.reason})`)
			];
			status = projectMessage;
		});
	}

	function touch() {
		dirty = true;
		if (databaseReady) status = 'Unsaved changes';
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
		if (pages.length >= 20) return;
		const number = pages.length + 1;
		const page: EditorPage = {
			id: globalThis.crypto.randomUUID(),
			name: `Page ${number}`,
			slug: uniqueSlug(`page-${number}`),
			width: selected?.width ?? 800,
			height: selected?.height ?? 600,
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
		if (pages.length <= 1 || !selected) return;
		const index = pages.findIndex((page) => page.id === selected.id);
		pages = pages.filter((page) => page.id !== selected.id);
		selectedId = pages[Math.min(index, pages.length - 1)].id;
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
</script>

<svelte:head>
	<title>Pages</title>
	<meta name="description" content="Manage the pages, routes and canvas sizes of your site" />
</svelte:head>

<div class="editor-shell">
	<AppNav {pages} unsavedChanges={dirty} />
	<header class="builder-header">
		<div class="project-name">
			<div class="brand-mark" aria-hidden="true">✳</div>
			<div>
				<p class="eyebrow">PAGE BUILDER</p>
				<h1>Untitled website</h1>
			</div>
			<span class="save-status" role="status" aria-live="polite" aria-busy={busy}>
				<span aria-hidden="true" class:unsaved={dirty}></span>
				{status}
			</span>
		</div>
		<div class="header-actions">
			<button type="button" class="table-button" disabled={busy} onclick={createTables}>
				Create tables
			</button>
			<button
				type="button"
				class="save-button"
				disabled={!databaseReady || busy || !dirty}
				onclick={save}
			>
				Save pages
			</button>
		</div>
	</header>

	<div class="workspace">
		<aside class="palette-panel" aria-label="Pages">
			<div class="panel-heading">
				<div>
					<p class="eyebrow">YOUR SITE</p>
					<h2>Pages</h2>
				</div>
				<span class="count-pill">{pages.length}</span>
			</div>
			<p class="panel-hint">Select a page to edit its route and canvas size.</p>
			<ul class="page-list" aria-label="Pages">
				{#each pages as page (page.id)}
					<li>
						<button
							type="button"
							class="page-item"
							class:active={selected && page.id === selected.id}
							aria-current={selected && page.id === selected.id ? 'page' : undefined}
							onclick={() => (selectedId = page.id)}
						>
							<strong>{page.name}</strong>
							<small>/{page.slug} · {page.width}px · {page.blocks.length} items</small>
						</button>
					</li>
				{/each}
			</ul>
			<div class="actions">
				<button type="button" disabled={pages.length >= 20 || !selected} onclick={addPage}>
					Add
				</button>
				<button type="button" disabled={pages.length >= 20 || !selected} onclick={duplicatePage}>
					Duplicate
				</button>
				<button type="button" class="danger" disabled={pages.length <= 1} onclick={deletePage}>
					Delete
				</button>
			</div>
		</aside>

		<section class="canvas-panel" aria-label="Page overview">
			<div class="canvas-toolbar">
				<div class="canvas-label">
					<span class="live-dot" aria-hidden="true"></span>
					<span>Page overview</span>
					{#if selected}<span class="canvas-path">/{selected.slug}</span>{/if}
				</div>
				{#if selected}
					<a class="edit-link" href="{resolve('/editor')}?page={selected.id}">Edit this page →</a>
				{/if}
			</div>
			<div class="canvas-stage">
				{#if selected}
					<div
						class="mini-page"
						style:width="{Math.min(selected.width, 640)}px"
						style:aspect-ratio="{selected.width} / {overviewHeight}"
						role="img"
						aria-label="Layout of {selected.name}"
					>
						{#each selected.blocks as block (block.id)}
							<span
								class="mini-block"
								style:left="{block.x}%"
								style:top="{(block.y / overviewHeight) * 100}%"
								style:width="{(block.width / selected.width) * 100}%"
								style:height="{(block.height / overviewHeight) * 100}%"
							></span>
						{/each}
					</div>
				{/if}
			</div>
			<p class="canvas-footnote">{selected ? `${selected.width} × ${selected.height} px` : ''}</p>
		</section>

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
					<span class="field-label">Canvas size</span>
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

			<div class="inspector-content project-section">
				<span class="field-label">SvelteKit project folder</span>
				<p class="panel-hint">
					Export writes <code>src/routes/&lt;route&gt;/+page.svelte</code> and
					<code>src/lib/components/editor/*.svelte</code>. Import reads the pages the editor
					exported.
				</p>
				<label class="field-label" for="project-root">Project path</label>
				<div class="project-input-row">
					<input
						id="project-root"
						class="field-control"
						placeholder="/home/me/my-app"
						maxlength="500"
						bind:value={projectRoot}
					/>
					<button type="button" class="browse-button" onclick={() => (showPickerModal = true)}>
						Browse…
					</button>
				</div>
				<DirectoryPickerModal
					open={showPickerModal}
					initialPath={projectRoot}
					onselect={(path) => {
						projectRoot = path;
						localStorage.setItem('editor-project-root', path);
					}}
					onclose={() => (showPickerModal = false)}
				/>
				<div class="actions">
					<button
						type="button"
						disabled={busy || !projectRoot.trim() || pages.length === 0}
						onclick={exportProject}
					>
						Export
					</button>
					<button type="button" disabled={busy || !projectRoot.trim()} onclick={importProject}>
						Import
					</button>
				</div>
				{#if projectMessage}
					<p class="panel-hint" role="status">{projectMessage}</p>
					<ul class="project-details">
						{#each projectDetails as line (line)}<li>{line}</li>{/each}
					</ul>
				{/if}
			</div>
		</aside>
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

	.builder-header {
		display: flex;
		min-height: 76px;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0 1.5rem;
		border-bottom: 1px solid var(--line);
		background: #fff;
	}

	.project-name {
		gap: 0.8rem;
	}

	.brand-mark {
		display: grid;
		width: 38px;
		height: 38px;
		place-items: center;
		border-radius: 12px;
		background: #eeeaff;
		color: var(--purple);
		font-size: 1.4rem;
	}

	.eyebrow {
		margin: 0 0 0.15rem;
		color: #9999ab;
		font-size: 0.61rem;
		font-weight: 750;
		letter-spacing: 0.13em;
	}

	.project-name h1 {
		margin: 0;
		font-size: 0.94rem;
		font-weight: 680;
		letter-spacing: -0.02em;
	}

	.save-status {
		gap: 0.4rem;
		margin-left: 0.35rem;
		color: #8d8fa1;
		font-size: 0.7rem;
		max-width: 220px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.save-status span.unsaved {
		background: #e4a746;
	}

	.header-actions {
		gap: 0.7rem;
	}

	.table-button {
		background: #fff;
		color: #4b456f;
	}

	.save-button {
		min-height: 36px;
		padding: 0 0.75rem;
		border: 1px solid #e6e3f5;
		border-radius: 8px;
		font-size: 0.74rem;
		font-weight: 650;
		cursor: pointer;
	}

	.table-button:hover:not(:disabled) {
		border-color: #c9c1ff;
		background: #faf9ff;
	}

	.save-button:hover:not(:disabled) {
		background: #5949d2;
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

	.project-name,
	.header-actions,
	.save-status,
	.canvas-label {
		display: flex;
		align-items: center;
	}

	.save-status span,
	.live-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #69c89d;
	}

	.table-button:disabled,
	.save-button:disabled,
	.actions button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	h1,
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

	.mini-page {
		position: relative;
		max-width: 100%;
		flex: 0 0 auto;
		border: 1px solid #e8e8ed;
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 8px 26px rgb(34 34 56 / 0.09);
	}

	.mini-block {
		position: absolute;
		border: 1px solid #b9b0f5;
		border-radius: 3px;
		background: #f0edff;
	}

	.canvas-footnote {
		margin: 0.7rem 0 0;
		color: #999aab;
		font-size: 0.66rem;
		text-align: center;
	}

	.project-section {
		margin-top: 1.4rem;
		padding-top: 0.4rem;
		border-top: 1px solid var(--line);
	}

	.project-input-row {
		display: flex;
		gap: 0.35rem;
		align-items: center;
	}

	.browse-button {
		flex-shrink: 0;
		min-height: 37px;
		padding: 0 0.75rem;
		border: 1px solid #d8d4cc;
		border-radius: 7px;
		background: #fff;
		font: inherit;
		font-size: 0.72rem;
		font-weight: 650;
		cursor: pointer;
		color: #4b456f;
	}

	.browse-button:hover {
		border-color: #c9c1ff;
		background: #faf9ff;
	}

	.project-section .actions {
		margin-top: 0.7rem;
	}

	.project-details {
		margin: 0;
		padding-left: 1rem;
		color: var(--muted);
		font-size: 0.62rem;
		line-height: 1.6;
		overflow-wrap: anywhere;
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

		.builder-header {
			flex-wrap: wrap;
			padding: 0.5rem 0.8rem;
		}
	}
</style>
