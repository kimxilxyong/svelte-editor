<script lang="ts">
	import { onMount } from 'svelte';
	import type { BuilderBlock, BlockKind } from '../../lib/editor.js';

	type DragPayload = { source: 'palette'; kind: BlockKind } | { source: 'canvas'; id: string };
	type EditorApiResponse = {
		created?: boolean;
		blocks?: BuilderBlock[] | null;
		success?: boolean;
		error?: string;
	};

	const componentInfo: Record<BlockKind, { label: string; detail: string; mark: string }> = {
		hero: { label: 'Hero section', detail: 'A bold opening for your page', mark: '✳' },
		text: { label: 'Text block', detail: 'Share a little more detail', mark: 'T' },
		button: { label: 'Call to action', detail: 'Give visitors a next step', mark: '↗' },
		features: { label: 'Feature cards', detail: 'Showcase what makes you great', mark: '▦' },
		image: { label: 'Image section', detail: 'A visual moment for your story', mark: '▧' },
		quote: { label: 'Testimonial', detail: 'Let a happy customer speak', mark: '“' }
	};
	const componentKinds = Object.keys(componentInfo) as BlockKind[];

	const defaults: Record<BlockKind, Omit<BuilderBlock, 'id'>> = {
		hero: {
			kind: 'hero',
			title: 'Make room for your next big idea.',
			body: 'A thoughtful space to share what you do and why it matters.',
			action: 'Explore what we do',
			theme: 'lavender'
		},
		text: {
			kind: 'text',
			title: 'A little about us',
			body: 'We believe the best work starts with curiosity, good people, and the freedom to try something new.',
			action: '',
			theme: 'light'
		},
		button: {
			kind: 'button',
			title: 'Ready when you are',
			body: 'Take the first step. We’ll take it from here.',
			action: 'Get started',
			theme: 'dark'
		},
		features: {
			kind: 'features',
			title: 'The details make the difference',
			body: 'Simple tools, considered design, and a team that cares.',
			action: '',
			theme: 'light'
		},
		image: {
			kind: 'image',
			title: 'A brighter way to build',
			body: 'Made for the moments that move you forward.',
			action: '',
			theme: 'lavender'
		},
		quote: {
			kind: 'quote',
			title: '“It just feels like us.”',
			body: 'The whole process felt easy, and the result is something we’re genuinely proud to share.',
			action: 'Maya Chen · Studio founder',
			theme: 'light'
		}
	};

	let blocks = $state<BuilderBlock[]>([
		{
			id: 'sample-hero',
			kind: 'hero',
			title: 'Make room for your next big idea.',
			body: 'A thoughtful space to share what you do and why it matters.',
			action: 'Explore what we do',
			theme: 'lavender'
		},
		{
			id: 'sample-features',
			kind: 'features',
			title: 'The details make the difference',
			body: 'Simple tools, considered design, and a team that cares.',
			action: '',
			theme: 'light'
		},
		{
			id: 'sample-quote',
			kind: 'quote',
			title: '“It just feels like us.”',
			body: 'The whole process felt easy, and the result is something we’re genuinely proud to share.',
			action: 'Maya Chen · Studio founder',
			theme: 'light'
		}
	]);
	let selectedId = $state<string | null>('sample-hero');
	let dropIndex = $state<number | null>(null);
	let isPreview = $state(false);
	let mobileViewport = $state(false);
	let databaseReady = $state(false);
	let databaseBusy = $state(true);
	let databaseStatus = $state('Checking SQLite…');
	let hasUnsavedChanges = $state(true);
	let revision = $state(0);

	let selectedBlock = $derived(blocks.find((block) => block.id === selectedId));
	let blockCount = $derived(blocks.length);
	let selectedLabel = $derived(
		selectedBlock ? componentInfo[selectedBlock.kind].label : 'Nothing selected'
	);

	onMount(() => {
		void loadDatabaseState();
	});

	async function requestApi(
		method: 'GET' | 'POST',
		payload?: { action: 'create-tables' } | { action: 'save'; blocks: BuilderBlock[] }
	): Promise<EditorApiResponse> {
		const response = await fetch('/editor/api', {
			method,
			...(payload
				? {
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(payload)
					}
				: {})
		});
		const result = (await response.json()) as EditorApiResponse;

		if (!response.ok) {
			throw new Error(result.error ?? `SQLite request failed (${response.status}).`);
		}

		return result;
	}

	function applyDatabaseState(result: EditorApiResponse) {
		databaseReady = result.created === true;
		if (!databaseReady) {
			databaseStatus = 'Create tables to enable saving';
			return;
		}

		if (Array.isArray(result.blocks)) {
			blocks = result.blocks;
			selectedId = blocks[0]?.id ?? null;
			hasUnsavedChanges = false;
			databaseStatus = 'Saved page loaded from SQLite';
		} else {
			hasUnsavedChanges = true;
			databaseStatus = 'SQLite ready · page not saved';
		}
	}

	async function loadDatabaseState() {
		databaseBusy = true;
		try {
			applyDatabaseState(await requestApi('GET'));
		} catch (error) {
			databaseStatus =
				error instanceof Error ? error.message : 'Unable to load the page from SQLite.';
		} finally {
			databaseBusy = false;
		}
	}

	async function createDatabaseTables() {
		databaseBusy = true;
		databaseStatus = 'Creating SQLite tables…';
		try {
			await requestApi('POST', { action: 'create-tables' });
			applyDatabaseState(await requestApi('GET'));
		} catch (error) {
			databaseStatus =
				error instanceof Error ? error.message : 'Unable to create the SQLite tables.';
		} finally {
			databaseBusy = false;
		}
	}

	async function savePageToDatabase() {
		if (!databaseReady || databaseBusy) return;

		const savedRevision = revision;
		const pageSnapshot = blocks.map((block) => ({ ...block }));
		databaseBusy = true;
		databaseStatus = 'Saving page to SQLite…';

		try {
			await requestApi('POST', { action: 'save', blocks: pageSnapshot });
			hasUnsavedChanges = revision !== savedRevision;
			databaseStatus = hasUnsavedChanges ? 'More changes still need saving' : 'Saved to SQLite';
		} catch (error) {
			databaseStatus = error instanceof Error ? error.message : 'Unable to save the page.';
		} finally {
			databaseBusy = false;
		}
	}

	function markUnsaved() {
		revision += 1;
		hasUnsavedChanges = true;
		if (databaseReady) databaseStatus = 'Unsaved changes';
	}

	function createBlock(kind: BlockKind): BuilderBlock {
		return { ...defaults[kind], id: globalThis.crypto.randomUUID() };
	}

	function addBlock(kind: BlockKind, index = blocks.length) {
		const block = createBlock(kind);
		blocks.splice(index, 0, block);
		selectedId = block.id;
		isPreview = false;
		markUnsaved();
	}

	function handlePaletteDragStart(event: DragEvent, kind: BlockKind) {
		event.dataTransfer?.setData(
			'application/x-page-builder',
			JSON.stringify({ source: 'palette', kind })
		);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
	}

	function handleBlockDragStart(event: DragEvent, id: string) {
		event.dataTransfer?.setData(
			'application/x-page-builder',
			JSON.stringify({ source: 'canvas', id })
		);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}

	function readPayload(event: DragEvent): DragPayload | null {
		const value = event.dataTransfer?.getData('application/x-page-builder');
		if (!value) return null;

		try {
			const payload: unknown = JSON.parse(value);
			if (
				typeof payload === 'object' &&
				payload !== null &&
				'source' in payload &&
				payload.source === 'palette' &&
				'kind' in payload &&
				typeof payload.kind === 'string' &&
				payload.kind in componentInfo
			) {
				return { source: 'palette', kind: payload.kind as BlockKind };
			}
			if (
				typeof payload === 'object' &&
				payload !== null &&
				'source' in payload &&
				payload.source === 'canvas' &&
				'id' in payload &&
				typeof payload.id === 'string'
			) {
				return { source: 'canvas', id: payload.id };
			}
		} catch {
			return null;
		}

		return null;
	}

	function handleBlockDragOver(event: DragEvent, index: number) {
		event.preventDefault();
		event.stopPropagation();
		if (!event.dataTransfer) return;
		event.dataTransfer.dropEffect = 'move';
		const bounds =
			event.currentTarget instanceof HTMLElement
				? event.currentTarget.getBoundingClientRect()
				: null;
		dropIndex = bounds && event.clientY > bounds.top + bounds.height / 2 ? index + 1 : index;
	}

	function handleCanvasDragOver(event: DragEvent) {
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		dropIndex = blocks.length;
	}

	function handleDrop(event: DragEvent, index: number) {
		event.preventDefault();
		event.stopPropagation();
		const payload = readPayload(event);
		const destination = Math.max(0, Math.min(dropIndex ?? index, blocks.length));

		if (payload?.source === 'palette') {
			addBlock(payload.kind, destination);
		} else if (payload?.source === 'canvas') {
			const sourceIndex = blocks.findIndex((block) => block.id === payload.id);
			if (sourceIndex !== -1) {
				const [block] = blocks.splice(sourceIndex, 1);
				const adjustedIndex = sourceIndex < destination ? destination - 1 : destination;
				blocks.splice(adjustedIndex, 0, block);
				selectedId = block.id;
				markUnsaved();
			}
		}

		dropIndex = null;
	}

	function deleteSelected() {
		if (!selectedId) return;
		const index = blocks.findIndex((block) => block.id === selectedId);
		blocks = blocks.filter((block) => block.id !== selectedId);
		selectedId = blocks[Math.min(index, blocks.length - 1)]?.id ?? null;
		markUnsaved();
	}

	function moveSelected(direction: -1 | 1) {
		if (!selectedId) return;
		const index = blocks.findIndex((block) => block.id === selectedId);
		const destination = index + direction;
		if (index < 0 || destination < 0 || destination >= blocks.length) return;
		const [block] = blocks.splice(index, 1);
		blocks.splice(destination, 0, block);
		markUnsaved();
	}

	function clearPage() {
		blocks = [];
		selectedId = null;
		dropIndex = null;
		markUnsaved();
	}
</script>

<svelte:head>
	<title>Page editor</title>
	<meta name="description" content="Design a page by arranging and customizing components." />
</svelte:head>

<div class="editor-shell">
	<header class="builder-header">
		<div class="project-name">
			<div class="brand-mark" aria-hidden="true">✳</div>
			<div>
				<p class="eyebrow">PAGE BUILDER</p>
				<h1>Untitled website</h1>
			</div>
			<span class="save-status" role="status" aria-live="polite" aria-busy={databaseBusy}>
				<span aria-hidden="true" class:unsaved={hasUnsavedChanges}></span>
				{databaseStatus}
			</span>
		</div>
		<div class="header-actions">
			<div class="persistence-actions">
				<button
					type="button"
					class="table-button"
					disabled={databaseBusy}
					onclick={createDatabaseTables}
				>
					Create tables
				</button>
				<button
					type="button"
					class="save-button"
					disabled={!databaseReady || databaseBusy || !hasUnsavedChanges}
					onclick={savePageToDatabase}
				>
					Save page
				</button>
			</div>
			<div class="viewport-switch" aria-label="Canvas width">
				<button
					type="button"
					class:active={!mobileViewport}
					aria-label="Desktop canvas"
					aria-pressed={!mobileViewport}
					onclick={() => (mobileViewport = false)}
				>
					<svg viewBox="0 0 20 20" aria-hidden="true"
						><rect x="2.5" y="3" width="15" height="10.5" rx="1.5" /><path
							d="M7 17h6m-3-3.5V17"
						/></svg
					>
				</button>
				<button
					type="button"
					class:active={mobileViewport}
					aria-label="Mobile canvas"
					aria-pressed={mobileViewport}
					onclick={() => (mobileViewport = true)}
				>
					<svg viewBox="0 0 20 20" aria-hidden="true"
						><rect x="5.5" y="2" width="9" height="16" rx="2" /><path d="M8.5 15.5h3" /></svg
					>
				</button>
			</div>
			<button class="preview-button" type="button" onclick={() => (isPreview = !isPreview)}>
				{#if isPreview}
					Back to editor
				{:else}
					<svg viewBox="0 0 20 20" aria-hidden="true"
						><path d="M2.5 10s2.7-5 7.5-5 7.5 5 7.5 5-2.7 5-7.5 5-7.5-5-7.5-5Z" /><circle
							cx="10"
							cy="10"
							r="2"
						/></svg
					>
					Preview
				{/if}
			</button>
		</div>
	</header>

	<div class="workspace" class:preview-mode={isPreview}>
		{#if !isPreview}
			<aside class="palette-panel" aria-label="Component palette">
				<div class="panel-heading">
					<div>
						<p class="eyebrow">BUILD YOUR PAGE</p>
						<h2>Components</h2>
					</div>
					<span class="count-pill">{componentKinds.length}</span>
				</div>
				<p class="panel-hint">Drag a block onto your page, or click to add it.</p>

				<div class="component-list">
					{#each componentKinds as kind (kind)}
						<button
							type="button"
							class="palette-item"
							draggable="true"
							aria-label="Add {componentInfo[kind].label}"
							ondragstart={(event) => handlePaletteDragStart(event, kind)}
							onclick={() => addBlock(kind)}
						>
							<span class="component-mark" aria-hidden="true">{componentInfo[kind].mark}</span>
							<span class="component-copy">
								<strong>{componentInfo[kind].label}</strong>
								<small>{componentInfo[kind].detail}</small>
							</span>
							<span class="add-mark" aria-hidden="true">+</span>
						</button>
					{/each}
				</div>

				<div class="palette-tip">
					<span aria-hidden="true">✦</span>
					<p><strong>A small tip</strong> — select any block to edit its content and style.</p>
				</div>
			</aside>
		{/if}

		<section class="canvas-panel" aria-label="Page canvas">
			<div class="canvas-toolbar">
				<div class="canvas-label">
					<span class="live-dot" aria-hidden="true"></span>
					<span>{isPreview ? 'Live preview' : 'Page canvas'}</span>
					<span class="canvas-path">/ home</span>
				</div>
				{#if !isPreview}
					<div class="canvas-actions">
						<span>{blockCount} {blockCount === 1 ? 'section' : 'sections'}</span>
						<button
							type="button"
							class="text-button"
							disabled={blockCount === 0}
							onclick={clearPage}
						>
							Clear page
						</button>
					</div>
				{/if}
			</div>

			<div class="canvas-stage">
				<div
					class="page-canvas"
					class:mobile={mobileViewport}
					class:preview={isPreview}
					role="region"
					aria-label="Page sections drop zone"
					ondragover={handleCanvasDragOver}
					ondrop={(event) => handleDrop(event, blocks.length)}
					ondragleave={(event) => {
						if (event.target === event.currentTarget) dropIndex = null;
					}}
				>
					{#if blocks.length === 0}
						<div class="empty-canvas">
							<div class="empty-icon" aria-hidden="true">✳</div>
							<h2>Your page starts here</h2>
							<p>Choose a component from the panel to start building something great.</p>
							<button type="button" class="empty-add" onclick={() => addBlock('hero')}>
								<span aria-hidden="true">+</span> Add a hero section
							</button>
						</div>
					{:else}
						{#each blocks as block, index (block.id)}
							{#if !isPreview && dropIndex === index}
								<div class="drop-indicator" aria-hidden="true"></div>
							{/if}
							<article
								class="canvas-block {block.kind} theme-{block.theme}"
								class:selected={!isPreview && selectedId === block.id}
								draggable={!isPreview}
								ondragstart={(event) => handleBlockDragStart(event, block.id)}
								ondragover={(event) => !isPreview && handleBlockDragOver(event, index)}
								ondrop={(event) => !isPreview && handleDrop(event, index)}
								ondragend={() => (dropIndex = null)}
							>
								{#if block.kind === 'hero'}
									<div class="hero-preview">
										<span class="preview-kicker">A LITTLE MORE YOU</span>
										<h2>{block.title}</h2>
										<p>{block.body}</p>
										{#if block.action}<span class="mock-cta"
												>{block.action}<span aria-hidden="true"> ↗</span></span
											>{/if}
										<div class="hero-orbit" aria-hidden="true"><span>✳</span><i></i></div>
									</div>
								{:else if block.kind === 'features'}
									<div class="features-preview">
										<span class="preview-kicker">MADE WITH INTENTION</span>
										<h2>{block.title}</h2>
										<p>{block.body}</p>
										<div class="feature-cards" aria-hidden="true">
											<div>
												<span>✧</span><strong>Thoughtful by design</strong><small
													>Every detail has a purpose.</small
												>
											</div>
											<div>
												<span>↗</span><strong>Room to grow</strong><small
													>Built around your next step.</small
												>
											</div>
											<div>
												<span>♡</span><strong>People first</strong><small
													>Good work, together.</small
												>
											</div>
										</div>
									</div>
								{:else if block.kind === 'quote'}
									<div class="quote-preview">
										<span class="quote-mark" aria-hidden="true">“</span>
										<h2>{block.title}</h2>
										<p>{block.body}</p>
										<span class="quote-author">{block.action}</span>
									</div>
								{:else if block.kind === 'text'}
									<div class="text-preview">
										<span class="preview-kicker">OUR STORY</span>
										<h2>{block.title}</h2>
										<p>{block.body}</p>
									</div>
								{:else if block.kind === 'button'}
									<div class="button-preview">
										<div>
											<span class="preview-kicker">YOUR NEXT CHAPTER</span>
											<h2>{block.title}</h2>
											<p>{block.body}</p>
										</div>
										<span class="mock-cta">{block.action}<span aria-hidden="true"> ↗</span></span>
									</div>
								{:else}
									<div class="image-preview">
										<div class="image-art" aria-hidden="true">
											<div class="sun"></div>
											<div class="hill hill-back"></div>
											<div class="hill hill-front"></div>
											<span>✳</span>
										</div>
										<div>
											<span class="preview-kicker">A FRESH PERSPECTIVE</span>
											<h2>{block.title}</h2>
											<p>{block.body}</p>
										</div>
									</div>
								{/if}
								{#if !isPreview}
									<span class="block-type-tag">{componentInfo[block.kind].label}</span>
									<button
										type="button"
										class="selection-overlay"
										aria-label="Select {componentInfo[block.kind].label}: {block.title}"
										aria-pressed={selectedId === block.id}
										onclick={() => (selectedId = block.id)}
									></button>
								{/if}
							</article>
						{/each}
						{#if !isPreview && dropIndex === blocks.length}
							<div class="drop-indicator" aria-hidden="true"></div>
						{/if}
					{/if}
				</div>
			</div>
			{#if !isPreview}
				<p class="canvas-footnote">
					<span aria-hidden="true">⌘</span> Click a section to select it
					<span class="footnote-divider">·</span> Drag to rearrange
				</p>
			{/if}
		</section>

		{#if !isPreview}
			<aside class="inspector-panel" aria-label="Selection inspector">
				<div class="panel-heading inspector-heading">
					<div>
						<p class="eyebrow">MAKE IT YOURS</p>
						<h2>Inspector</h2>
					</div>
					{#if selectedBlock}
						<div class="inspector-actions">
							<button
								class="icon-button"
								type="button"
								aria-label="Move selected section up"
								disabled={blocks[0]?.id === selectedId}
								onclick={() => moveSelected(-1)}
							>
								<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 11 5-5 5 5M10 6v9" /></svg>
							</button>
							<button
								class="icon-button"
								type="button"
								aria-label="Move selected section down"
								disabled={blocks.at(-1)?.id === selectedId}
								onclick={() => moveSelected(1)}
							>
								<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 9 5 5 5-5m-5 5V5" /></svg>
							</button>
							<button
								class="icon-button delete-button"
								type="button"
								aria-label="Delete selected section"
								onclick={deleteSelected}
							>
								<svg viewBox="0 0 20 20" aria-hidden="true"
									><path d="M4.5 6h11m-9.5 0 .6 10h6.8l.6-10M8 6V4h4v2m-3 3v4m2-4v4" /></svg
								>
							</button>
						</div>
					{/if}
				</div>
				{#if selectedBlock}
					<div class="inspector-content">
						<div class="selected-component">
							<span class="component-mark" aria-hidden="true"
								>{componentInfo[selectedBlock.kind].mark}</span
							>
							<div><strong>{selectedLabel}</strong><small>Selected section</small></div>
						</div>
						<label class="field-label" for="block-title">Heading</label>
						<input
							id="block-title"
							class="field-control"
							bind:value={selectedBlock.title}
							maxlength="100"
							oninput={markUnsaved}
						/>
						<label class="field-label" for="block-body">Description</label>
						<textarea
							id="block-body"
							class="field-control field-textarea"
							bind:value={selectedBlock.body}
							rows="4"
							maxlength="240"
							oninput={markUnsaved}></textarea>
						{#if ['hero', 'button', 'quote'].includes(selectedBlock.kind)}
							<label class="field-label" for="block-action">
								{selectedBlock.kind === 'quote' ? 'Attribution' : 'Button label'}
							</label>
							<input
								id="block-action"
								class="field-control"
								bind:value={selectedBlock.action}
								maxlength="48"
								oninput={markUnsaved}
							/>
						{/if}

						<div class="field-divider"></div>
						<span class="field-label">Section style</span>
						<div class="theme-options" role="group" aria-label="Section style">
							<button
								type="button"
								class:theme-active={selectedBlock.theme === 'light'}
								aria-pressed={selectedBlock.theme === 'light'}
								onclick={() => {
									selectedBlock.theme = 'light';
									markUnsaved();
								}}
							>
								<span class="swatch swatch-light"></span>Light
							</button>
							<button
								type="button"
								class:theme-active={selectedBlock.theme === 'lavender'}
								aria-pressed={selectedBlock.theme === 'lavender'}
								onclick={() => {
									selectedBlock.theme = 'lavender';
									markUnsaved();
								}}
							>
								<span class="swatch swatch-lavender"></span>Soft
							</button>
							<button
								type="button"
								class:theme-active={selectedBlock.theme === 'dark'}
								aria-pressed={selectedBlock.theme === 'dark'}
								onclick={() => {
									selectedBlock.theme = 'dark';
									markUnsaved();
								}}
							>
								<span class="swatch swatch-dark"></span>Bold
							</button>
						</div>
					</div>
				{:else}
					<div class="inspector-empty">
						<div aria-hidden="true">✧</div>
						<h3>Nothing selected</h3>
						<p>Select a section on your page to edit its content and style.</p>
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

	.project-name,
	.header-actions,
	.save-status,
	.viewport-switch,
	.canvas-label,
	.canvas-actions {
		display: flex;
		align-items: center;
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

	h1,
	h2,
	h3,
	p {
		margin-top: 0;
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

	.save-status span,
	.live-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #69c89d;
	}

	.save-status span.unsaved {
		background: #e4a746;
	}

	.header-actions {
		gap: 0.7rem;
	}

	.persistence-actions {
		display: flex;
		gap: 0.35rem;
	}

	.table-button,
	.save-button {
		min-height: 36px;
		padding: 0 0.75rem;
		border: 1px solid #e6e3f5;
		border-radius: 8px;
		font-size: 0.74rem;
		font-weight: 650;
		cursor: pointer;
	}

	.table-button {
		background: #fff;
		color: #4b456f;
	}

	.save-button {
		border-color: var(--purple);
		background: var(--purple);
		color: #fff;
	}

	.table-button:hover:not(:disabled) {
		border-color: #c9c1ff;
		background: #faf9ff;
	}

	.save-button:hover:not(:disabled) {
		background: #5949d2;
	}

	.table-button:disabled,
	.save-button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.viewport-switch {
		gap: 0.15rem;
		padding: 0.2rem;
		border: 1px solid var(--line);
		border-radius: 9px;
	}

	.viewport-switch button,
	.icon-button {
		display: grid;
		width: 32px;
		height: 30px;
		place-items: center;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: #9697a9;
		cursor: pointer;
	}

	.viewport-switch button.active {
		background: #f0edff;
		color: var(--purple);
	}

	.viewport-switch svg,
	.preview-button svg,
	.icon-button svg {
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.5;
	}

	.preview-button,
	.empty-add {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		min-height: 38px;
		padding: 0 0.95rem;
		border: 1px solid #e6e3f5;
		border-radius: 8px;
		background: white;
		color: #4b456f;
		font-size: 0.78rem;
		font-weight: 650;
		cursor: pointer;
	}

	.preview-button:hover,
	.empty-add:hover {
		border-color: #c9c1ff;
		background: #faf9ff;
	}

	.workspace {
		display: grid;
		min-height: calc(100vh - 7.75rem);
		grid-template-columns: 252px minmax(0, 1fr) 276px;
	}

	.palette-panel,
	.inspector-panel {
		background: #fff;
	}

	.palette-panel {
		padding: 1.5rem 1.1rem;
		border-right: 1px solid var(--line);
	}

	.inspector-panel {
		padding: 1.5rem 1.1rem;
		border-left: 1px solid var(--line);
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

	.component-list {
		display: grid;
		gap: 0.5rem;
	}

	.palette-item {
		display: flex;
		width: 100%;
		min-height: 61px;
		align-items: center;
		gap: 0.65rem;
		padding: 0.55rem 0.5rem;
		border: 1px solid transparent;
		border-radius: 10px;
		background: #fff;
		color: var(--ink);
		text-align: left;
		cursor: grab;
		transition:
			border-color 140ms ease,
			background 140ms ease,
			transform 140ms ease;
	}

	.palette-item:hover {
		transform: translateY(-1px);
		border-color: #e6e2fc;
		background: #fbfaff;
	}

	.palette-item:active {
		cursor: grabbing;
	}

	.component-mark {
		display: grid;
		width: 36px;
		height: 36px;
		flex: 0 0 36px;
		place-items: center;
		border-radius: 9px;
		background: #f1efff;
		color: var(--purple);
		font-size: 1rem;
		font-weight: 700;
	}

	.palette-item:nth-child(2) .component-mark,
	.palette-item:nth-child(5) .component-mark {
		background: #eaf5f3;
		color: #419a87;
	}

	.palette-item:nth-child(3) .component-mark,
	.palette-item:nth-child(6) .component-mark {
		background: #fff2e8;
		color: #d1844e;
	}

	.component-copy,
	.selected-component > div {
		display: grid;
		min-width: 0;
		gap: 0.2rem;
	}

	.component-copy strong,
	.selected-component strong {
		overflow: hidden;
		font-size: 0.73rem;
		font-weight: 680;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.component-copy small,
	.selected-component small {
		overflow: hidden;
		color: var(--muted);
		font-size: 0.62rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.add-mark {
		margin-left: auto;
		color: #b6b4c7;
		font-size: 1.1rem;
	}

	.palette-tip {
		display: flex;
		gap: 0.55rem;
		margin-top: 1.5rem;
		padding: 0.8rem;
		border: 1px solid #efedfb;
		border-radius: 10px;
		background: #faf9ff;
		color: #7466ce;
	}

	.palette-tip > span {
		padding-top: 0.05rem;
		font-size: 0.8rem;
	}

	.palette-tip p {
		margin: 0;
		color: #88869f;
		font-size: 0.65rem;
		line-height: 1.55;
	}

	.palette-tip strong {
		color: #5e568f;
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

	.canvas-actions {
		gap: 0.85rem;
		color: #999aab;
		font-size: 0.66rem;
		font-weight: 500;
	}

	.text-button {
		padding: 0.3rem 0;
		border: 0;
		background: transparent;
		color: #7a70c4;
		font-size: 0.67rem;
		font-weight: 600;
		cursor: pointer;
	}

	.text-button:disabled {
		color: #c1c1cc;
		cursor: not-allowed;
	}

	.canvas-stage {
		display: flex;
		min-height: 520px;
		flex: 1;
		justify-content: center;
		padding: 1.2rem;
		overflow: auto;
		border: 1px solid #ebebf1;
		border-radius: 12px;
		background-color: #efeff4;
		background-image: radial-gradient(#d8d8e2 0.7px, transparent 0.7px);
		background-size: 14px 14px;
	}

	.page-canvas {
		position: relative;
		display: flex;
		width: 100%;
		max-width: 800px;
		min-height: 600px;
		flex-direction: column;
		align-self: flex-start;
		overflow: hidden;
		border: 1px solid #e8e8ed;
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 8px 26px rgb(34 34 56 / 0.09);
		transition: max-width 200ms ease;
	}

	.page-canvas.mobile {
		max-width: 390px;
	}

	.page-canvas.preview {
		min-height: 600px;
	}

	.canvas-block {
		position: relative;
		display: block;
		width: 100%;
		overflow: hidden;
		border: 0;
		border-radius: 0;
		background: #fff;
		color: var(--ink);
		font: inherit;
		text-align: left;
	}

	.canvas-block + .canvas-block {
		border-top: 1px solid #f0eff3;
	}

	.canvas-block:hover,
	.canvas-block.selected {
		z-index: 1;
		box-shadow: inset 0 0 0 2px #8d7cff;
	}

	.selection-overlay:focus-visible {
		z-index: 2;
		outline: 3px solid #8d7cff;
		outline-offset: -3px;
	}

	.canvas-block[draggable='true'] {
		cursor: grab;
	}

	.selection-overlay {
		position: absolute;
		inset: 0;
		z-index: 2;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: grab;
	}

	.canvas-block.hero {
		min-height: 290px;
	}

	.hero-preview {
		position: relative;
		min-height: 290px;
		padding: clamp(2rem, 6vw, 4.2rem);
		overflow: hidden;
		background: linear-gradient(115deg, #f3efff 0%, #f5f2ff 52%, #e8e4ff 100%);
	}

	.preview-kicker {
		display: block;
		margin-bottom: 0.8rem;
		color: #8174c6;
		font-size: 0.55rem;
		font-weight: 750;
		letter-spacing: 0.14em;
	}

	.hero-preview h2,
	.features-preview h2,
	.text-preview h2,
	.image-preview h2,
	.button-preview h2 {
		position: relative;
		z-index: 1;
		max-width: 500px;
		margin: 0 0 0.75rem;
		font-size: clamp(1.45rem, 3vw, 2.45rem);
		font-weight: 690;
		letter-spacing: -0.055em;
		line-height: 1.08;
	}

	.hero-preview p,
	.features-preview > p,
	.text-preview p,
	.image-preview p,
	.button-preview p {
		position: relative;
		z-index: 1;
		max-width: 400px;
		margin: 0;
		color: #73748b;
		font-size: 0.8rem;
		line-height: 1.65;
	}

	.mock-cta {
		position: relative;
		z-index: 1;
		display: inline-flex;
		align-items: center;
		gap: 0.65rem;
		margin-top: 1.25rem;
		padding: 0.7rem 0.95rem;
		border-radius: 7px;
		background: #6554d8;
		color: white;
		font-size: 0.68rem;
		font-weight: 650;
	}

	.hero-orbit {
		position: absolute;
		right: 8%;
		bottom: 5%;
		display: grid;
		width: 140px;
		height: 140px;
		place-items: center;
		border: 1px solid rgb(126 110 221 / 0.2);
		border-radius: 50%;
		color: #9586e7;
		font-size: 3rem;
	}

	.hero-orbit::before,
	.hero-orbit::after {
		position: absolute;
		inset: 13px;
		border: 1px solid rgb(126 110 221 / 0.15);
		border-radius: 50%;
		content: '';
	}

	.hero-orbit::after {
		inset: 30px;
	}

	.hero-orbit i {
		position: absolute;
		top: 13px;
		right: 25px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #e1a782;
	}

	.features-preview,
	.text-preview {
		padding: clamp(1.8rem, 5vw, 3.2rem);
	}

	.features-preview h2,
	.text-preview h2,
	.image-preview h2,
	.button-preview h2 {
		font-size: clamp(1.2rem, 2.5vw, 1.8rem);
	}

	.feature-cards {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.65rem;
		margin-top: 1.5rem;
	}

	.feature-cards > div {
		display: grid;
		min-height: 95px;
		align-content: start;
		gap: 0.35rem;
		padding: 0.8rem;
		border: 1px solid #eeeef2;
		border-radius: 8px;
		background: #fdfdfe;
	}

	.feature-cards span {
		color: #8072dc;
		font-size: 0.9rem;
	}

	.feature-cards strong {
		font-size: 0.62rem;
		font-weight: 680;
	}

	.feature-cards small {
		color: #8d8e9e;
		font-size: 0.55rem;
	}

	.quote-preview {
		display: grid;
		min-height: 180px;
		align-content: center;
		justify-items: center;
		padding: 2rem;
		background: #fbfaf8;
		text-align: center;
	}

	.quote-mark {
		height: 26px;
		color: #b3a5e8;
		font-family: Georgia, serif;
		font-size: 3rem;
		line-height: 1;
	}

	.quote-preview h2 {
		margin: 0.4rem 0;
		font-family: Georgia, serif;
		font-size: clamp(1.15rem, 2.3vw, 1.7rem);
		font-weight: 500;
		letter-spacing: -0.035em;
	}

	.quote-preview p {
		max-width: 440px;
		margin: 0 auto;
		color: #7e7d89;
		font-size: 0.7rem;
		line-height: 1.6;
	}

	.quote-author {
		margin-top: 0.75rem;
		color: #858494;
		font-size: 0.6rem;
		font-weight: 650;
	}

	.button-preview {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 2rem clamp(1.8rem, 5vw, 3.2rem);
		background: #27263c;
		color: white;
	}

	.button-preview .preview-kicker {
		color: #b1a7ef;
	}

	.button-preview h2 {
		margin-bottom: 0.45rem;
		color: white;
	}

	.button-preview p {
		color: #c3c0d0;
	}

	.button-preview .mock-cta {
		flex-shrink: 0;
		background: white;
		color: #39344e;
	}

	.image-preview {
		display: grid;
		grid-template-columns: 1fr 1fr;
		align-items: center;
		gap: 1.8rem;
		padding: clamp(1.3rem, 4vw, 2.5rem);
		background: #f7f4ff;
	}

	.canvas-block.theme-lavender .hero-preview {
		background: linear-gradient(115deg, #f3efff 0%, #f5f2ff 52%, #e8e4ff 100%);
	}

	.canvas-block.theme-light .hero-preview {
		background: linear-gradient(115deg, #fff 0%, #fbfbfd 58%, #f3f2f7 100%);
	}

	.canvas-block.theme-dark .hero-preview {
		background: linear-gradient(115deg, #29273d 0%, #34314e 58%, #464064 100%);
	}

	.canvas-block.theme-lavender .features-preview,
	.canvas-block.theme-lavender .text-preview,
	.canvas-block.theme-lavender .quote-preview,
	.canvas-block.theme-lavender .image-preview {
		background: #f5f2ff;
	}

	.canvas-block.theme-light .features-preview,
	.canvas-block.theme-light .text-preview,
	.canvas-block.theme-light .quote-preview,
	.canvas-block.theme-light .image-preview {
		background: #fff;
	}

	.canvas-block.theme-dark .features-preview,
	.canvas-block.theme-dark .text-preview,
	.canvas-block.theme-dark .quote-preview,
	.canvas-block.theme-dark .image-preview {
		background: #29273d;
		color: #fff;
	}

	.canvas-block.theme-dark .hero-preview h2,
	.canvas-block.theme-dark .features-preview h2,
	.canvas-block.theme-dark .text-preview h2,
	.canvas-block.theme-dark .quote-preview h2,
	.canvas-block.theme-dark .image-preview h2 {
		color: #fff;
	}

	.canvas-block.theme-dark .hero-preview p,
	.canvas-block.theme-dark .features-preview > p,
	.canvas-block.theme-dark .text-preview p,
	.canvas-block.theme-dark .quote-preview p,
	.canvas-block.theme-dark .image-preview p {
		color: #c6c3d6;
	}

	.image-art {
		position: relative;
		min-height: 145px;
		overflow: hidden;
		border-radius: 8px;
		background: linear-gradient(150deg, #dbd3fa, #efe4e7 65%, #f2d5bd);
	}

	.image-art .sun {
		position: absolute;
		top: 18%;
		right: 22%;
		width: 35px;
		height: 35px;
		border-radius: 50%;
		background: #ffd59b;
		box-shadow: 0 0 30px rgb(255 213 155 / 60%);
	}

	.hill {
		position: absolute;
		right: -10%;
		bottom: -48%;
		width: 120%;
		height: 100%;
		transform: rotate(-12deg);
		border-radius: 50% 50% 0 0;
		background: #a59bd7;
	}

	.hill-back {
		right: 32%;
		bottom: -55%;
		background: #c5b7df;
	}

	.hill-front {
		bottom: -70%;
		background: #7772b4;
	}

	.image-art > span {
		position: absolute;
		top: 20%;
		left: 18%;
		color: white;
		font-size: 1rem;
	}

	.image-preview h2 {
		margin-bottom: 0.5rem;
	}

	.block-type-tag {
		position: absolute;
		top: 0.65rem;
		right: 0.7rem;
		z-index: 3;
		padding: 0.28rem 0.45rem;
		border: 1px solid #e9e6f4;
		border-radius: 5px;
		background: rgb(255 255 255 / 92%);
		color: #77728e;
		font-size: 0.53rem;
		font-weight: 600;
		opacity: 0;
		transition: opacity 120ms ease;
	}

	.canvas-block:hover .block-type-tag,
	.canvas-block.selected .block-type-tag {
		opacity: 1;
	}

	.drop-indicator {
		position: relative;
		z-index: 4;
		height: 4px;
		flex: 0 0 4px;
		background: #7666e7;
		box-shadow: 0 0 8px rgb(118 102 231 / 40%);
	}

	.empty-canvas {
		display: grid;
		min-height: 600px;
		flex: 1;
		align-content: center;
		justify-items: center;
		padding: 2rem;
		text-align: center;
	}

	.empty-icon,
	.inspector-empty > div {
		display: grid;
		width: 48px;
		height: 48px;
		place-items: center;
		border-radius: 15px;
		background: #f0edff;
		color: var(--purple);
		font-size: 1.5rem;
	}

	.empty-canvas h2 {
		margin: 1rem 0 0.4rem;
		font-size: 1.1rem;
		font-weight: 700;
		letter-spacing: -0.03em;
	}

	.empty-canvas p,
	.inspector-empty p {
		max-width: 290px;
		margin: 0;
		color: #898a9a;
		font-size: 0.73rem;
		line-height: 1.6;
	}

	.empty-add {
		margin-top: 1.2rem;
		background: #6b5ce7;
		color: #fff;
	}

	.empty-add:hover {
		background: #5e50d1;
		color: #fff;
	}

	.empty-add span {
		font-size: 1.05rem;
	}

	.canvas-footnote {
		margin: 0.7rem 0 0;
		color: #999aaa;
		font-size: 0.62rem;
		text-align: center;
	}

	.footnote-divider {
		padding: 0 0.4rem;
	}

	.inspector-heading {
		margin-bottom: 1.2rem;
	}

	.inspector-actions {
		display: flex;
		gap: 0.2rem;
	}

	.inspector-actions .icon-button:disabled {
		color: #d3d3dc;
		cursor: not-allowed;
	}

	.delete-button {
		border: 1px solid transparent;
		color: #a1a1b1;
	}

	.delete-button:hover {
		border-color: #f2dada;
		background: #fff5f5;
		color: #cf5c67;
	}

	.selected-component {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		margin-bottom: 1.35rem;
		padding: 0.7rem;
		border: 1px solid #efedf7;
		border-radius: 9px;
		background: #fcfbff;
	}

	.selected-component .component-mark {
		width: 32px;
		height: 32px;
		flex-basis: 32px;
	}

	.field-label {
		display: block;
		margin: 0.85rem 0 0.4rem;
		color: #686a80;
		font-size: 0.67rem;
		font-weight: 650;
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

	.field-textarea {
		min-height: 94px;
		resize: vertical;
		line-height: 1.5;
	}

	.field-divider {
		height: 1px;
		margin: 1.3rem 0 1rem;
		background: #eeeef3;
	}

	.theme-options {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.35rem;
	}

	.theme-options button {
		display: grid;
		justify-items: center;
		gap: 0.4rem;
		padding: 0.55rem 0.2rem;
		border: 1px solid #ececf1;
		border-radius: 8px;
		background: #fff;
		color: #77798c;
		font-size: 0.61rem;
		cursor: pointer;
	}

	.theme-options button.theme-active {
		border-color: #aa9ff1;
		background: #faf9ff;
		color: #6253ca;
	}

	.swatch {
		width: 24px;
		height: 18px;
		border: 1px solid #e8e8ed;
		border-radius: 5px;
	}

	.swatch-light {
		background: #fff;
	}

	.swatch-lavender {
		background: linear-gradient(135deg, #f3efff, #dcd5ff);
	}

	.swatch-dark {
		background: #29273d;
	}

	.inspector-empty {
		display: grid;
		justify-items: center;
		padding: 3rem 0.5rem;
		text-align: center;
	}

	.inspector-empty h3 {
		margin: 0.9rem 0 0.35rem;
		font-size: 0.85rem;
		font-weight: 680;
	}

	.workspace.preview-mode {
		grid-template-columns: minmax(0, 1fr);
	}

	.preview-mode .canvas-panel {
		width: min(100%, 1100px);
		margin: 0 auto;
		padding-top: 1.5rem;
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

		.inspector-content {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			column-gap: 1rem;
		}

		.selected-component,
		.field-divider,
		.theme-options {
			grid-column: 1 / -1;
		}

		.inspector-content .field-label:first-of-type {
			grid-column: 1;
		}
	}

	@media (max-width: 700px) {
		.editor-shell {
			min-height: calc(100vh - 3rem);
		}

		.builder-header {
			flex-wrap: wrap;
			min-height: 68px;
			padding: 0.5rem 0.8rem;
		}

		.project-name {
			gap: 0.55rem;
		}

		.brand-mark {
			width: 32px;
			height: 32px;
		}

		.save-status {
			display: none;
		}

		.header-actions {
			width: 100%;
			justify-content: flex-end;
			gap: 0.35rem;
			padding-bottom: 0.3rem;
		}

		.persistence-actions {
			margin-right: auto;
		}

		.table-button,
		.save-button {
			min-height: 34px;
			padding: 0 0.55rem;
			font-size: 0.66rem;
		}

		.save-status {
			max-width: 125px;
		}

		.preview-button {
			min-height: 34px;
			padding: 0 0.65rem;
			font-size: 0.7rem;
		}

		.workspace {
			grid-template-columns: minmax(0, 1fr);
		}

		.palette-panel {
			padding: 1rem;
			border-right: 0;
			border-bottom: 1px solid var(--line);
		}

		.component-list {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.palette-item {
			min-height: 56px;
		}

		.palette-tip {
			display: none;
		}

		.canvas-panel {
			padding: 0.8rem 0.65rem;
		}

		.canvas-stage {
			min-height: 440px;
			padding: 0.55rem;
		}

		.page-canvas,
		.empty-canvas {
			min-height: 480px;
		}

		.hero-preview {
			min-height: 250px;
			padding: 2rem 1.3rem;
		}

		.hero-orbit {
			right: -38px;
			bottom: -38px;
			width: 110px;
			height: 110px;
		}

		.features-preview,
		.text-preview {
			padding: 1.5rem 1.2rem;
		}

		.feature-cards {
			gap: 0.35rem;
		}

		.feature-cards > div {
			min-height: 90px;
			padding: 0.55rem;
		}

		.feature-cards strong {
			font-size: 0.56rem;
		}

		.feature-cards small {
			font-size: 0.5rem;
		}

		.button-preview {
			align-items: flex-start;
			flex-direction: column;
			padding: 1.5rem 1.2rem;
		}

		.button-preview .mock-cta {
			margin-top: 0.1rem;
		}

		.image-preview {
			grid-template-columns: 1fr;
			gap: 1rem;
			padding: 1.1rem;
		}

		.image-art {
			min-height: 120px;
		}

		.inspector-panel {
			padding: 1.1rem;
		}

		.inspector-content {
			display: block;
		}

		.inspector-content .field-label:first-of-type {
			grid-column: auto;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		* {
			scroll-behavior: auto !important;
			transition-duration: 0.01ms !important;
		}
	}
</style>
