<script lang="ts">
	/**
	 * @component ImagesPage
	 *
	 * Project image library: searches and filters the active project's images, previews a selection,
	 * and lets users create links, upload files, import images and edit or delete entries. List rows
	 * include the full URL as a tooltip and the list scrolls independently. Guests
	 * can browse but cannot mutate the library. Navigation and project selection remain in AppNav.
	 *
	 * The root layout supplies the active project and user via `$app/state`; this route has no
	 * component props. Each project change invalidates outstanding work and clears its drafts.
	 * Responses are accepted only for the project and request generation that started them; a
	 * server response for a different active project is never displayed as the current library.
	 *
	 * @prop {never} none - This route declares no component props; it reads inherited layout data.
	 */
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { page as routePage } from '$app/state';
	import { hasRole } from '../../lib/auth/roles.js';
	import {
		imageCategories as categories,
		type ImageCategory,
		type ProjectImage
	} from '../../lib/image-types.js';
	import { useNavContext } from '../../lib/navigation.svelte.js';

	type Category = ImageCategory;
	type LibraryResponse = {
		project?: { id: string; name: string } | null;
		images?: ProjectImage[];
		image?: ProjectImage;
		success?: boolean;
		error?: string;
	};
	type AddMode = 'link' | 'import' | 'upload';

	const project = $derived(routePage.data.project ?? null);
	const canEdit = $derived(hasRole(routePage.data.user?.role, 'user'));
	let images = $state.raw<ProjectImage[]>([]);
	let selectedId = $state('');
	let search = $state('');
	let category = $state('All');
	let loading = $state(true);
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');
	let viewProjectId = $state<string | null>(null);
	let addMode = $state<AddMode | null>(null);
	let newName = $state('');
	let newUrl = $state('');
	let newCategory = $state<Category>('Other');
	let newFile = $state<File | null>(null);
	let draftName = $state('');
	let draftUrl = $state('');
	let draftCategory = $state<Category>('Other');
	let confirmDelete = $state(false);
	let controller: AbortController | null = null;
	let generation = 0;
	let mutationGeneration = 0;

	const selected = $derived(images.find((image) => image.id === selectedId) ?? null);
	const filtered = $derived.by(() => {
		const query = search.trim().toLocaleLowerCase();
		return images.filter(
			(image) =>
				(category === 'All' || image.category === category) &&
				(!query || `${image.name} ${image.url}`.toLocaleLowerCase().includes(query))
		);
	});
	const dirty = $derived(
		!!selected &&
			(draftName !== selected.name ||
				draftCategory !== selected.category ||
				(selected.kind === 'link' && draftUrl !== selected.url))
	);
	const hasDraft = $derived(addMode !== null ? !!(newName || newUrl || newFile) : dirty);
	// The shared layout owns leave confirmation; publish drafts without adding another nav bar.
	useNavContext(() => ({ unsavedChanges: hasDraft }));

	/**
	 * Starts a fresh request generation. Aborting only saves work: the generation and project
	 * checks are essential because an aborted POST may already have reached the server.
	 */
	function nextRequest(): { signal: AbortSignal; version: number } {
		controller?.abort();
		controller = new AbortController();
		return { signal: controller.signal, version: ++generation };
	}

	/** Checks that a response still belongs to the current view, even after a project switch. */
	function isCurrent(version: number, projectId: string | null): boolean {
		return version === generation && (routePage.data.project?.id ?? null) === projectId;
	}

	/** Reads JSON errors without masking a useful HTTP status when the server returns non-JSON. */
	async function readResponse(response: Response): Promise<LibraryResponse> {
		const result: unknown = await response.json().catch(() => null);
		const data =
			result && typeof result === 'object' && !Array.isArray(result)
				? (result as LibraryResponse)
				: null;
		if (!response.ok) throw new Error(data?.error || `Request failed (${response.status}).`);
		if (!data) throw new Error('The image library returned an invalid response.');
		return data;
	}

	/** Copies a selection into an independent draft; managed URLs are never editable. */
	function selectImage(image: ProjectImage | null) {
		selectedId = image?.id ?? '';
		draftName = image?.name ?? '';
		draftUrl = image?.url ?? '';
		draftCategory = image?.category ?? 'Other';
		confirmDelete = false;
		addMode = null;
	}

	/** Confirm before replacing a draft through an in-page selection or mode change. */
	function leaveDraft(): boolean {
		return !hasDraft || window.confirm('Discard your unsaved image changes?');
	}

	/** Switches to a fresh add form after protecting the current draft. */
	function beginAdd(mode: AddMode) {
		if (!leaveDraft()) return;
		selectImage(selected);
		newName = '';
		newUrl = '';
		newCategory = 'Other';
		newFile = null;
		addMode = mode;
		error = '';
		notice = '';
	}

	/** Selects an entry without silently discarding another image's edits. */
	function chooseImage(image: ProjectImage) {
		if (!leaveDraft()) return;
		selectImage(image);
		error = '';
		notice = '';
	}

	/** Clears project-specific data before fetching, preventing stale previews during a switch. */
	function clearLibrary() {
		images = [];
		selectImage(null);
		addMode = null;
		newName = '';
		newUrl = '';
		newCategory = 'Other';
		newFile = null;
		search = '';
		category = 'All';
		notice = '';
		error = '';
	}

	/**
	 * Loads the cookie-selected library and verifies that it matches layout data. A mismatch can
	 * occur while AppNav is changing the cookie and invalidating layout data.
	 */
	async function reload(projectId: string | null, preserveId = '') {
		const { signal, version } = nextRequest();
		loading = true;
		error = '';
		try {
			const result = await readResponse(await fetch('/images/api', { signal, cache: 'no-store' }));
			if (!isCurrent(version, projectId)) return;
			if ((result.project?.id ?? null) !== projectId) {
				clearLibrary();
				throw new Error('The active project changed. Please reload the library.');
			}
			if (!Array.isArray(result.images))
				throw new Error('The image library returned invalid data.');
			images = result.images;
			selectImage(images.find((image) => image.id === preserveId) ?? images[0] ?? null);
		} catch (cause) {
			if (!isCurrent(version, projectId) || signal.aborted) return;
			error = cause instanceof Error ? cause.message : 'Could not load the image library.';
		} finally {
			if (isCurrent(version, projectId)) loading = false;
		}
	}

	// AppNav changes the cookie then calls invalidateAll(); effect cleanup invalidates all responses
	// from the previous project. `untrack` keeps the effect dependent only on the project id.
	$effect(() => {
		const projectId = routePage.data.project?.id ?? null;
		untrack(() => {
			clearLibrary();
			viewProjectId = projectId;
			mutationGeneration++;
			busy = false;
			void reload(projectId);
		});
		return () => {
			controller?.abort();
			generation++;
			mutationGeneration++;
		};
	});

	/**
	 * Serializes mutations and checks the cookie-selected project immediately before writing.
	 * The server also compares expectedProjectId with the cookie-selected project for the POST;
	 * unlike the preflight alone, that precondition protects against a switch between requests.
	 */
	async function mutate(body: Record<string, unknown> | FormData, success: string) {
		const projectId = project?.id ?? null;
		if (!projectId || projectId !== viewProjectId || !canEdit || busy || loading) return;
		const { signal, version } = nextRequest();
		const mutation = ++mutationGeneration;
		busy = true;
		error = '';
		notice = '';
		try {
			const current = await readResponse(await fetch('/images/api', { signal, cache: 'no-store' }));
			if (!isCurrent(version, projectId)) return;
			if (current.project?.id !== projectId) {
				throw new Error(
					'The active project changed. Wait for the project to reload and try again.'
				);
			}
			const isForm = body instanceof FormData;
			if (isForm) body.set('expectedProjectId', projectId);
			const result = await readResponse(
				await fetch('/images/api', {
					method: 'POST',
					signal,
					...(isForm
						? { body }
						: {
								headers: { 'content-type': 'application/json' },
								body: JSON.stringify({ ...body, expectedProjectId: projectId })
							})
				})
			);
			if (!isCurrent(version, projectId)) return;
			if (!result.image && result.success !== true)
				throw new Error('The image library returned an invalid response.');
			// A successful POST is already committed even if the follow-up GET fails. Retire the
			// submitted draft immediately so a refresh failure cannot invite a duplicate creation.
			const committedImage = result.image;
			const preserveId = committedImage?.id ?? selectedId;
			if (committedImage) {
				images = [...images.filter((image) => image.id !== committedImage.id), committedImage];
				selectImage(committedImage);
			} else {
				images = images.filter((image) => image.id !== selectedId);
				selectImage(null);
			}
			notice = success;
			await reload(projectId, preserveId);
		} catch (cause) {
			if (!isCurrent(version, projectId) || signal.aborted) return;
			error = cause instanceof Error ? cause.message : 'The image request failed.';
		} finally {
			// A refresh creates another generation; a switched project resets busy in the effect.
			if (mutation === mutationGeneration) busy = false;
		}
	}

	/** Adds a linked URL, imports a remote image, or sends a multipart managed-file upload. */
	function addImage(event: SubmitEvent) {
		event.preventDefault();
		if (addMode === 'upload') {
			if (!newFile) {
				error = 'Choose an image file to upload.';
				return;
			}
			const data = new FormData();
			data.set('action', 'upload');
			data.set('file', newFile);
			data.set('name', newName);
			data.set('category', newCategory);
			void mutate(data, 'Image uploaded.');
		} else {
			void mutate(
				{
					action: addMode === 'import' ? 'import' : 'create',
					name: newName,
					url: newUrl,
					category: newCategory
				},
				addMode === 'import' ? 'Image imported.' : 'Image added.'
			);
		}
	}

	/** Saves editable metadata. The server owns the URL of a managed upload. */
	function saveImage(event: SubmitEvent) {
		event.preventDefault();
		if (!selected) return;
		void mutate(
			{
				action: 'update',
				id: selected.id,
				name: draftName,
				category: draftCategory,
				// The API requires the URL even for managed entries; send the unchanged server value.
				url: selected.kind === 'link' ? draftUrl : selected.url
			},
			'Image updated.'
		);
	}

	/** Formats optional file size without treating a zero-byte value as missing. */
	function formatSize(size: number): string {
		if (size < 1024) return `${size} B`;
		if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
		return `${(size / (1024 * 1024)).toFixed(1)} MB`;
	}
</script>

<svelte:head><title>Images</title></svelte:head>

<div class="images-page">
	<div class="page-heading">
		<div>
			<h1>Image library</h1>
			<p>
				{#if project}Images for {project.name}.{:else}Choose a project to view its images.{/if}
			</p>
			{#if project}
				<p>
					Up to 500 images per project, including the 50 linked seed icons, and 50 MiB total managed
					content.
				</p>
			{/if}
		</div>
		{#if project && canEdit}
			<div class="actions">
				<button type="button" disabled={busy || loading} onclick={() => beginAdd('link')}>
					Add link
				</button>
				<button type="button" disabled={busy || loading} onclick={() => beginAdd('import')}>
					Import URL
				</button>
				<button
					class="primary"
					type="button"
					disabled={busy || loading}
					onclick={() => beginAdd('upload')}
				>
					Upload image
				</button>
			</div>
		{/if}
	</div>

	{#if !project}
		<div class="message">
			Create or open a project on the <a href={resolve('/')}>Projects</a> page.
		</div>
	{:else if project.id !== viewProjectId}
		<div class="message" role="status">Loading images…</div>
	{:else}
		{#if !canEdit}<p class="read-only">
				Read-only access: you can browse images but cannot make changes.
			</p>{/if}
		{#if error}
			<div class="feedback error" role="alert">
				{error}
				{#if !busy && !loading}
					<button type="button" onclick={() => void reload(project.id, selectedId)}
						>Reload library</button
					>
				{/if}
			</div>
		{/if}
		{#if notice}<div class="feedback success" role="status">{notice}</div>{/if}
		<div class="library">
			<aside class="list-panel" aria-label="Image library">
				<div class="list-controls">
					<label for="image-search">Search images</label>
					<input
						id="image-search"
						type="search"
						placeholder="Search by name or URL"
						bind:value={search}
					/>
					<label for="image-filter">Category</label>
					<select id="image-filter" bind:value={category}>
						<option value="All">All categories</option>
						{#each categories as item (item)}<option value={item}>{item}</option>{/each}
					</select>
				</div>
				<div class="list-heading">
					<span>Images</span>
					<span>{filtered.length}</span>
				</div>
				{#if loading}
					<p class="list-empty" role="status">Loading images…</p>
				{:else if filtered.length === 0}
					<p class="list-empty">
						{#if images.length === 0}
							{#if canEdit}No images yet. Add a link, import a URL or upload an image to get
								started.
							{:else}This project has no images yet.{/if}
						{:else}No images match these filters.{/if}
					</p>
				{:else}
					<ul class="image-list">
						{#each filtered as image (image.id)}
							<li>
								<button
									type="button"
									class:active={image.id === selectedId && !addMode}
									aria-pressed={image.id === selectedId && !addMode}
									disabled={busy}
									onclick={() => chooseImage(image)}
								>
									<span class="thumb"><img src={image.url} alt="" loading="lazy" /></span>
									<span class="list-text">
										<strong>{image.name}</strong>
										<small
											>{image.category} · {image.kind === 'managed' ? 'Uploaded' : 'Link'}</small
										>
										<small class="list-url" title={image.url}>{image.url}</small>
									</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</aside>

			<section class="detail-panel" aria-label="Image details">
				{#if addMode && canEdit}
					<div class="detail-heading">
						<div>
							<h2>
								{addMode === 'link'
									? 'Add image link'
									: addMode === 'import'
										? 'Import image from URL'
										: 'Upload image'}
							</h2>
							<p>
								{addMode === 'link'
									? 'Save a URL in this project’s library.'
									: addMode === 'import'
										? 'Download an image into this project’s library.'
										: 'Add an image file to this project.'}
							</p>
						</div>
						<button
							type="button"
							disabled={busy}
							onclick={() => {
								if (leaveDraft()) addMode = null;
							}}>Cancel</button
						>
					</div>
					<form class="fields" onsubmit={addImage}>
						<label
							>Name<input required maxlength="120" bind:value={newName} disabled={busy} /></label
						>
						{#if addMode !== 'upload'}
							<label
								>Image URL<input
									required
									maxlength="2048"
									bind:value={newUrl}
									disabled={busy}
									placeholder="https://example.com/image.jpg"
								/></label
							>
						{:else}
							<label
								>Image file<input
									required
									type="file"
									accept="image/*"
									disabled={busy}
									onchange={(event) => (newFile = event.currentTarget.files?.[0] ?? null)}
								/></label
							>
						{/if}
						<label
							>Category<select bind:value={newCategory} disabled={busy}
								>{#each categories as item (item)}<option value={item}>{item}</option
									>{/each}</select
							></label
						>
						<div class="form-actions">
							<button class="primary" type="submit" disabled={busy}
								>{busy
									? 'Saving…'
									: addMode === 'link'
										? 'Add image'
										: addMode === 'import'
											? 'Import image'
											: 'Upload image'}</button
							>
						</div>
					</form>
				{:else if selected}
					<div class="detail-heading">
						<div>
							<h2>{selected.name}</h2>
							<p>
								{selected.category} · {selected.kind === 'managed'
									? 'Uploaded image'
									: 'Image link'}
							</p>
						</div>
					</div>
					<div class="preview"><img src={selected.url} alt={selected.name} /></div>
					{#if selected.mimeType || selected.size != null}<p class="metadata">
							{selected.mimeType ?? 'Image'}{#if selected.size != null}
								· {formatSize(selected.size)}{/if}
						</p>{/if}
					<form class="fields" onsubmit={saveImage}>
						<label
							>Name<input
								required
								maxlength="120"
								bind:value={draftName}
								disabled={!canEdit || busy}
							/></label
						>
						<label
							>Image URL<input
								required
								maxlength="2048"
								bind:value={draftUrl}
								readonly={selected.kind === 'managed'}
								disabled={!canEdit || busy}
							/></label
						>
						{#if selected.kind === 'managed'}<p class="field-hint">
								The URL of an uploaded image cannot be changed.
							</p>{/if}
						<label
							>Category<select bind:value={draftCategory} disabled={!canEdit || busy}
								>{#each categories as item (item)}<option value={item}>{item}</option
									>{/each}</select
							></label
						>
						{#if canEdit}
							<div class="form-actions">
								<button class="primary" type="submit" disabled={!dirty || busy}>
									{busy ? 'Saving…' : 'Save changes'}</button
								>
								<button
									type="button"
									disabled={!dirty || busy}
									onclick={() => selectImage(selected)}>Discard</button
								>
							</div>
						{/if}
					</form>
					{#if canEdit}
						<div class="delete-zone">
							{#if confirmDelete}
								<p>Delete “{selected.name}” from this project? This cannot be undone.</p>
								<div class="actions">
									<button
										class="danger"
										type="button"
										disabled={busy}
										onclick={() =>
											void mutate({ action: 'delete', id: selected?.id }, 'Image deleted.')}
										>Confirm delete</button
									><button type="button" disabled={busy} onclick={() => (confirmDelete = false)}
										>Cancel</button
									>
								</div>
							{:else}
								<button
									class="text-danger"
									type="button"
									disabled={busy}
									onclick={() => (confirmDelete = true)}>Delete image</button
								>
							{/if}
						</div>
					{/if}
				{:else}
					<div class="detail-empty">
						<h2>Select an image</h2>
						<p>Choose an image from the list to see its preview and details.</p>
					</div>
				{/if}
			</section>
		</div>
	{/if}
</div>

<style>
	.images-page {
		width: min(100% - 2rem, 1200px);
		margin: 2rem auto 3rem;
		color: #263345;
	}
	.page-heading,
	.detail-heading,
	.actions,
	.form-actions,
	.list-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.page-heading {
		margin-bottom: 1.25rem;
		flex-wrap: wrap;
	}
	.actions {
		flex-wrap: wrap;
	}
	h1,
	h2,
	p {
		margin: 0;
	}
	h1 {
		font-size: 1.7rem;
		font-weight: 700;
		text-align: left;
	}
	h2 {
		font-size: 1.15rem;
		font-weight: 700;
		overflow-wrap: anywhere;
	}
	.page-heading p,
	.detail-heading p,
	.field-hint,
	.metadata,
	.detail-empty p {
		color: #526174;
		font-size: 0.9rem;
		margin-top: 0.3rem;
	}
	button,
	input,
	select {
		font: inherit;
	}
	button {
		border: 1px solid #b8c5d5;
		border-radius: 0.4rem;
		background: white;
		padding: 0.5rem 0.75rem;
		font-weight: 600;
		cursor: pointer;
		color: #263345;
	}
	button:hover:not(:disabled) {
		background: #edf2f8;
	}
	button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	button:focus-visible,
	input:focus-visible,
	select:focus-visible {
		outline: 3px solid #a78bfa;
		outline-offset: 2px;
	}
	button.primary {
		background: #6d28d9;
		border-color: #6d28d9;
		color: white;
	}
	button.primary:hover:not(:disabled) {
		background: #5b21b6;
	}
	input,
	select {
		width: 100%;
		min-width: 0;
		border: 1px solid #b8c5d5;
		border-radius: 0.4rem;
		background: white;
		padding: 0.55rem 0.65rem;
		color: #263345;
	}
	input:disabled,
	select:disabled,
	input[readonly] {
		background: #f1f5f9;
		color: #475569;
	}
	.library {
		display: grid;
		grid-template-columns: minmax(240px, 310px) minmax(0, 1fr);
		background: white;
		border: 1px solid #cbd5e1;
		border-radius: 0.65rem;
		overflow: hidden;
		min-height: 580px;
	}
	.list-panel {
		background: #f8fafc;
		border-right: 1px solid #d6dee8;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.list-controls {
		display: grid;
		gap: 0.45rem;
		padding: 1rem;
	}
	.list-controls label,
	.fields label {
		font-size: 0.86rem;
		font-weight: 600;
	}
	.list-controls label:not(:first-child) {
		margin-top: 0.4rem;
	}
	.list-heading {
		border-top: 1px solid #d6dee8;
		padding: 0.7rem 1rem;
		color: #526174;
		font-size: 0.8rem;
		font-weight: 700;
	}
	.image-list {
		list-style: none;
		padding: 0 0.5rem;
		margin: 0;
		max-height: 580px;
		overflow-y: auto;
	}
	.image-list button {
		width: 100%;
		display: flex;
		align-items: center;
		text-align: left;
		border: 1px solid transparent;
		background: transparent;
		padding: 0.55rem;
		gap: 0.7rem;
	}
	.image-list button.active {
		background: #ede9fe;
		border-color: #c4b5fd;
	}
	.thumb {
		width: 46px;
		height: 46px;
		flex: none;
		background: #e8edf3;
		border: 1px solid #d6dee8;
		border-radius: 0.3rem;
		overflow: hidden;
	}
	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.list-text {
		display: grid;
		gap: 0.2rem;
		min-width: 0;
		flex: 1;
	}
	.list-text strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.9rem;
	}
	.list-text small {
		font-size: 0.78rem;
		color: #526174;
	}
	.list-url {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.list-empty {
		padding: 0.6rem 1rem;
		color: #526174;
		font-size: 0.9rem;
	}
	.detail-panel {
		min-width: 0;
		padding: 1.5rem;
	}
	.detail-heading {
		align-items: flex-start;
		margin-bottom: 1.25rem;
	}
	.preview {
		display: grid;
		place-items: center;
		min-height: 210px;
		height: 300px;
		background-color: #f1f5f9;
		background-image:
			linear-gradient(45deg, #e2e8f0 25%, transparent 25%),
			linear-gradient(-45deg, #e2e8f0 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, #e2e8f0 75%),
			linear-gradient(-45deg, transparent 75%, #e2e8f0 75%);
		background-size: 20px 20px;
		background-position:
			0 0,
			0 10px,
			10px -10px,
			-10px 0;
		border: 1px solid #d6dee8;
		border-radius: 0.4rem;
		overflow: hidden;
	}
	.preview img {
		display: block;
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
	}
	.metadata {
		margin-top: 0.6rem;
	}
	.fields {
		display: grid;
		gap: 1rem;
		margin-top: 1.4rem;
		max-width: 650px;
	}
	.fields label {
		display: grid;
		gap: 0.4rem;
	}
	.field-hint {
		margin-top: -0.7rem;
	}
	.form-actions {
		justify-content: flex-start;
	}
	.delete-zone {
		border-top: 1px solid #d6dee8;
		margin-top: 2rem;
		padding-top: 1rem;
	}
	.delete-zone p {
		margin-bottom: 0.75rem;
	}
	button.text-danger {
		color: #b42318;
		border-color: #f2c5c1;
	}
	button.danger {
		background: #b42318;
		border-color: #b42318;
		color: white;
	}
	.detail-empty {
		display: grid;
		align-content: center;
		justify-items: center;
		min-height: 380px;
		text-align: center;
	}
	.message,
	.feedback,
	.read-only {
		border: 1px solid #cbd5e1;
		border-radius: 0.4rem;
		padding: 0.75rem 1rem;
		background: white;
		margin-bottom: 1rem;
	}
	.error {
		color: #9f1c15;
		background: #fff3f2;
		border-color: #f2c5c1;
	}
	.success {
		color: #166534;
		background: #f0fdf4;
		border-color: #bbf7d0;
	}
	.read-only {
		color: #475569;
		font-size: 0.9rem;
	}
	@media (max-width: 700px) {
		.images-page {
			width: min(100% - 1rem, 1200px);
			margin-top: 1rem;
		}
		.library {
			grid-template-columns: minmax(0, 1fr);
		}
		.list-panel {
			border-right: 0;
			border-bottom: 1px solid #d6dee8;
		}
		.image-list {
			max-height: 260px;
			overflow-y: auto;
		}
		.detail-panel {
			padding: 1rem;
		}
		.preview {
			height: 240px;
		}
	}
</style>
