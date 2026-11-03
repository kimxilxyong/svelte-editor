<script lang="ts">
	/**
	 * @component ImagesPage
	 *
	 * `/images` – manages the catalog of available images and icons shared across widgets (`WidgetImage`,
	 * `WidgetButton`, `WidgetGradientButton`, `WidgetLink`, `WidgetCard`, `WidgetAvatar`, `WidgetBadge`,
	 * `WidgetNavbar`, `WidgetAlert`, `WidgetToast`, `WidgetBanner`).
	 *
	 * Layout follows the application's three-column workbench (`BuilderHeader` · Left list · Centre
	 * preview stage · Right inspector):
	 * - **Left – Available images list.** Displays every image with its thumbnail, `name`, `url` and
	 *   predefined `category`. Includes search, category filter, and actions to **Create new**,
	 *   **Import** (local `.svg`/`.png`/`.jpg`/`.webp`/`.gif` files or remote URLs saved into
	 *   `static/images/<category>/`) and **Delete** images.
	 * - **Centre – Preview & widget showcase.** Renders the selected image on light, checkerboard or
	 *   dark surfaces alongside live previews of how it looks inside Button, Link, Avatar, Badge and
	 *   Card widgets under the active project's theme.
	 * - **Right – Image properties inspector.** Edits `name`, `url` and `category` of the selected
	 *   image, or switches into Create / Import mode.
	 *
	 * @prop {import('./$types').PageData} data - `images` (catalog entries), `canEdit`, plus root
	 *   layout `siteTheme` and `project`.
	 */
	import { invalidateAll } from '$app/navigation';
	import { page as routePage } from '$app/state';
	import BuilderHeader from '../../lib/components/BuilderHeader.svelte';
	import ThemeScope from '../../lib/components/editor/ThemeScope.svelte';
	import WidgetAvatar from '../../lib/components/editor/WidgetAvatar.svelte';
	import WidgetBadge from '../../lib/components/editor/WidgetBadge.svelte';
	import WidgetButton from '../../lib/components/editor/WidgetButton.svelte';
	import WidgetCard from '../../lib/components/editor/WidgetCard.svelte';
	import WidgetImage from '../../lib/components/editor/WidgetImage.svelte';
	import WidgetLink from '../../lib/components/editor/WidgetLink.svelte';
	import {
		extractUrlLastPathElement,
		imageCategories,
		imageCategoryLabel,
		imageLimits,
		imagePathElement,
		listImagePathElements,
		prepopulatedImages,
		type ImageCategory,
		type ManagedImage
	} from '../../lib/images.js';
	import { useNavContext } from '../../lib/navigation.svelte.js';
	import { defaultSiteTheme } from '../../lib/theme.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const canEdit = $derived(data.canEdit);
	const siteTheme = $derived(routePage.data.siteTheme ?? defaultSiteTheme);

	let images = $derived<ManagedImage[]>(data.images);

	let selectedId = $state('');
	let query = $state('');
	let categoryFilter = $state<'all' | ImageCategory>('all');
	let pathFilter = $state('all');
	let surface = $state<'checker' | 'light' | 'dark'>('checker');
	let busy = $state(false);
	let status = $state('');
	let errorMsg = $state('');

	/** Active panel mode: inspecting the selected image, creating a new entry, importing files, or crawling a web URL. */
	let panelMode = $state<'inspect' | 'create' | 'import' | 'crawler'>('inspect');

	// Create-new form state
	let createName = $state('');
	let createUrl = $state('');
	let createCategory = $state<ImageCategory>('custom');
	let createSvgContent = $state('');
	let createDownloadRemote = $state(true);

	// Import file form state
	let importCategory = $state<ImageCategory>('custom');
	let importCustomName = $state('');
	let importFiles = $state<FileList | null>(null);
	let fileInput: HTMLInputElement | null = null;

	// Web SVG Crawler state
	type CrawlPreviewItem = {
		id: string;
		name: string;
		sourceUrl: string;
		previewUrl: string;
		inlineSvg?: string;
		selected: boolean;
	};
	let crawlUrl = $state('');
	let crawlFolder = $state('');
	let crawlFolderTouched = $state(false);
	let crawlCategory = $state<ImageCategory>('custom');
	let crawlSourceUrl = $state('');
	let crawlCandidates = $state<CrawlPreviewItem[]>([]);

	const selectedCrawlItems = $derived(crawlCandidates.filter((item) => item.selected));

	/** Distinct path elements across all images (`isometric`, plus any crawled folder segments). */
	const pathElements = $derived(listImagePathElements(images));

	const visibleImages = $derived(
		images.filter((item) => {
			if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
			if (pathFilter !== 'all' && imagePathElement(item.url) !== pathFilter) return false;
			const needle = query.trim().toLowerCase();
			return (
				!needle ||
				item.name.toLowerCase().includes(needle) ||
				item.url.toLowerCase().includes(needle) ||
				item.category.toLowerCase().includes(needle) ||
				imageCategoryLabel(item.category).toLowerCase().includes(needle) ||
				imagePathElement(item.url).toLowerCase().includes(needle)
			);
		})
	);

	const selected = $derived(
		images.find((item) => item.id === selectedId) ?? visibleImages[0] ?? images[0]
	);

	// Edit draft for the currently selected image (writable $derived resets when `selected` changes)
	let draft = $derived<{ name: string; url: string; category: ImageCategory }>({
		name: selected?.name ?? '',
		url: selected?.url ?? '',
		category: selected?.category ?? 'custom'
	});

	const dirty = $derived(
		!!selected &&
			(draft.name.trim() !== selected.name ||
				draft.url.trim() !== selected.url ||
				draft.category !== selected.category)
	);

	const missingDefaultsCount = $derived(
		prepopulatedImages.filter(
			(seed) =>
				!images.some(
					(img) => img.id === seed.id || img.name.toLowerCase() === seed.name.toLowerCase()
				)
		).length
	);

	useNavContext(() => ({ unsavedChanges: dirty }));

	function attachFileInput(node: HTMLInputElement) {
		fileInput = node;
		return () => {
			if (fileInput === node) fileInput = null;
		};
	}

	async function apiJson(body: Record<string, unknown>): Promise<{
		image?: ManagedImage;
		images?: ManagedImage[];
		deleted?: string;
	}> {
		const response = await fetch('/images/api', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const result = (await response.json().catch(() => ({}))) as {
			image?: ManagedImage;
			images?: ManagedImage[];
			deleted?: string;
			error?: string;
		};
		if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status}).`);
		return result;
	}

	async function saveImage() {
		if (!canEdit || !selected || !dirty) return;
		busy = true;
		errorMsg = '';
		status = 'Saving image…';
		try {
			const res = await apiJson({
				action: 'update',
				id: selected.id,
				name: draft.name,
				url: draft.url,
				category: draft.category
			});
			if (res.images) images = res.images;
			await invalidateAll();
			status = `Saved “${res.image?.name ?? draft.name}”`;
		} catch (error) {
			errorMsg = error instanceof Error ? error.message : 'Could not save image.';
			status = errorMsg;
		} finally {
			busy = false;
		}
	}

	async function submitCreate() {
		if (!canEdit) return;
		busy = true;
		errorMsg = '';
		status = 'Creating image…';
		try {
			const res = await apiJson({
				action: 'create',
				name: createName,
				url: createUrl,
				category: createCategory,
				content: createSvgContent.trim() || undefined,
				downloadRemote: createDownloadRemote
			});
			if (res.images) images = res.images;
			if (res.image) selectedId = res.image.id;
			createName = '';
			createUrl = '';
			createSvgContent = '';
			panelMode = 'inspect';
			await invalidateAll();
			status = `Created “${res.image?.name ?? 'image'}”`;
		} catch (error) {
			errorMsg = error instanceof Error ? error.message : 'Could not create image.';
			status = errorMsg;
		} finally {
			busy = false;
		}
	}

	async function submitImport() {
		if (!canEdit || !importFiles || importFiles.length === 0) {
			errorMsg = 'Choose at least one image file to import.';
			return;
		}
		busy = true;
		errorMsg = '';
		status = 'Importing image files…';
		try {
			const form = new FormData();
			form.set('category', importCategory);
			if (importCustomName.trim()) form.set('name', importCustomName.trim());
			for (const file of Array.from(importFiles)) {
				form.append('files', file);
			}
			const response = await fetch('/images/api', {
				method: 'POST',
				body: form
			});
			const res = (await response.json().catch(() => ({}))) as {
				imported?: ManagedImage[];
				images?: ManagedImage[];
				error?: string;
			};
			if (!response.ok) throw new Error(res.error ?? `Import failed (${response.status}).`);
			if (res.images) images = res.images;
			if (res.imported && res.imported.length > 0) {
				selectedId = res.imported[0].id;
			}
			importCustomName = '';
			importFiles = null;
			if (fileInput) fileInput.value = '';
			panelMode = 'inspect';
			await invalidateAll();
			status = `Imported ${res.imported?.length ?? 1} image(s)`;
		} catch (error) {
			errorMsg = error instanceof Error ? error.message : 'Could not import files.';
			status = errorMsg;
		} finally {
			busy = false;
		}
	}

	async function deleteSelectedImage(target: ManagedImage | undefined = selected) {
		if (!canEdit || !target) return;
		busy = true;
		errorMsg = '';
		status = `Deleting “${target.name}”…`;
		try {
			const idx = visibleImages.findIndex((item) => item.id === target.id);
			const res = await apiJson({ action: 'delete', id: target.id });
			if (res.images) images = res.images;
			const next = visibleImages[Math.min(idx, Math.max(0, visibleImages.length - 2))] ?? images[0];
			selectedId = next?.id ?? '';
			await invalidateAll();
			status = `Deleted “${target.name}”`;
		} catch (error) {
			errorMsg = error instanceof Error ? error.message : 'Could not delete image.';
			status = errorMsg;
		} finally {
			busy = false;
		}
	}

	async function restoreDefaults() {
		if (!canEdit) return;
		busy = true;
		errorMsg = '';
		status = 'Restoring default icons…';
		try {
			const res = await apiJson({ action: 'restore' });
			if (res.images) images = res.images;
			await invalidateAll();
			status = 'Restored prepopulated Isometric 3D icons';
		} catch (error) {
			errorMsg = error instanceof Error ? error.message : 'Could not restore defaults.';
			status = errorMsg;
		} finally {
			busy = false;
		}
	}

	async function copyUrl(url: string) {
		try {
			await navigator.clipboard.writeText(url);
			status = `Copied ${url}`;
		} catch {
			status = url;
		}
	}

	function handleCrawlUrlInput(value: string) {
		crawlUrl = value;
		if (!crawlFolderTouched) {
			const derived = extractUrlLastPathElement(value);
			crawlFolder = derived === 'isometric-3d-interface-icons' ? 'isometric' : derived;
		}
	}

	async function scanWebUrl() {
		if (!canEdit || !crawlUrl.trim()) return;
		busy = true;
		errorMsg = '';
		status = 'Scanning web URL for SVGs…';
		try {
			const response = await fetch('/images/api', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'crawl-preview', url: crawlUrl.trim() })
			});
			const result = (await response.json().catch(() => ({}))) as {
				sourceUrl?: string;
				folder?: string;
				candidates?: {
					id: string;
					name: string;
					sourceUrl: string;
					previewUrl: string;
					inlineSvg?: string;
				}[];
				error?: string;
			};
			if (!response.ok) throw new Error(result.error ?? `Scan failed (${response.status}).`);
			crawlSourceUrl = result.sourceUrl ?? crawlUrl.trim();
			if (!crawlFolderTouched && result.folder) {
				crawlFolder = result.folder;
			}
			crawlCandidates = (result.candidates ?? []).map((item) => ({
				...item,
				selected: true
			}));
			status = `Found ${crawlCandidates.length} SVG(s) – review and select which ones to import`;
		} catch (error) {
			errorMsg = error instanceof Error ? error.message : 'Could not scan URL.';
			status = errorMsg;
		} finally {
			busy = false;
		}
	}

	function removeCrawlCandidate(id: string) {
		crawlCandidates = crawlCandidates.filter((item) => item.id !== id);
	}

	function setAllCrawlSelected(selectedState: boolean) {
		crawlCandidates = crawlCandidates.map((item) => ({ ...item, selected: selectedState }));
	}

	function cancelCrawlImport() {
		crawlCandidates = [];
		crawlSourceUrl = '';
		errorMsg = '';
		panelMode = 'inspect';
		status = 'Cancelled web crawler import';
	}

	async function commitCrawlImport() {
		if (!canEdit || selectedCrawlItems.length === 0) return;
		busy = true;
		errorMsg = '';
		const targetFolder = crawlFolder.trim() || extractUrlLastPathElement(crawlUrl);
		status = `Importing ${selectedCrawlItems.length} SVG(s) into /images/${targetFolder}/…`;
		try {
			const response = await fetch('/images/api', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					action: 'crawl-import',
					folder: targetFolder,
					category: crawlCategory,
					items: selectedCrawlItems.map((item) => ({
						name: item.name,
						sourceUrl: item.sourceUrl === 'inline' ? undefined : item.sourceUrl,
						inlineSvg: item.inlineSvg
					}))
				})
			});
			const res = (await response.json().catch(() => ({}))) as {
				imported?: ManagedImage[];
				images?: ManagedImage[];
				error?: string;
			};
			if (!response.ok) throw new Error(res.error ?? `Import failed (${response.status}).`);
			if (res.images) images = res.images;
			if (res.imported && res.imported.length > 0) {
				selectedId = res.imported[0].id;
				pathFilter = imagePathElement(res.imported[0].url);
			}
			crawlCandidates = [];
			crawlSourceUrl = '';
			panelMode = 'inspect';
			await invalidateAll();
			status = `Imported ${res.imported?.length ?? 0} SVG(s) into /images/${targetFolder}/`;
		} catch (error) {
			errorMsg = error instanceof Error ? error.message : 'Could not import crawled SVGs.';
			status = errorMsg;
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Images</title>
	<meta
		name="description"
		content="Manage icons and images available in widget pickers across your projects"
	/>
</svelte:head>

<div class="editor-shell">
	<BuilderHeader
		{status}
		{busy}
		unsaved={dirty}
		canSave={canEdit && dirty}
		readOnlyNotice={canEdit ? undefined : 'Read-only: your role cannot modify images'}
		title="Image library"
		saveLabel="Save changes"
		onsave={saveImage}
	/>

	<div class="workspace">
		<aside class="palette-panel" aria-label="Available images" data-testid="images-list-panel">
			<div class="panel-heading">
				<h2>Available images</h2>
				<span class="count-pill">{visibleImages.length} / {images.length}</span>
			</div>
			<p class="panel-hint">
				Stored in <code>static/images/</code> and available in every widget image picker (Image, Button,
				Link, Card, Avatar, Badge, Navbar…).
			</p>

			<div class="filters">
				<input
					class="field-control"
					type="search"
					placeholder="Search name, URL or category…"
					aria-label="Search images"
					bind:value={query}
				/>
				<div class="filter-row">
					<select class="field-control" aria-label="Filter by category" bind:value={categoryFilter}>
						<option value="all">All categories ({images.length})</option>
						{#each imageCategories as cat (cat.value)}
							{@const count = images.filter((img) => img.category === cat.value).length}
							<option value={cat.value}>{cat.label} ({count})</option>
						{/each}
					</select>
					<select
						class="field-control"
						aria-label="Filter by path element"
						data-testid="path-element-filter"
						bind:value={pathFilter}
					>
						<option value="all">All paths ({images.length})</option>
						{#each pathElements as seg (seg)}
							{@const count = images.filter((img) => imagePathElement(img.url) === seg).length}
							<option value={seg}>{seg} ({count})</option>
						{/each}
					</select>
				</div>
				{#if pathElements.length > 0}
					<div class="path-chips" role="group" aria-label="Path element filter">
						<button
							type="button"
							class="path-chip"
							class:active={pathFilter === 'all'}
							onclick={() => (pathFilter = 'all')}
						>
							All
						</button>
						{#each pathElements as seg (seg)}
							<button
								type="button"
								class="path-chip"
								class:active={pathFilter === seg}
								onclick={() => (pathFilter = seg)}
							>
								{seg}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<div class="actions top-actions">
				<button
					type="button"
					class:primary={panelMode === 'create'}
					disabled={!canEdit || busy}
					data-testid="new-image-button"
					onclick={() => {
						errorMsg = '';
						panelMode = panelMode === 'create' ? 'inspect' : 'create';
					}}
				>
					New
				</button>
				<button
					type="button"
					class:primary={panelMode === 'import'}
					disabled={!canEdit || busy}
					data-testid="import-image-button"
					onclick={() => {
						errorMsg = '';
						panelMode = panelMode === 'import' ? 'inspect' : 'import';
					}}
				>
					Import
				</button>
				<button
					type="button"
					class:primary={panelMode === 'crawler'}
					disabled={!canEdit || busy}
					data-testid="web-crawler-button"
					onclick={() => {
						errorMsg = '';
						panelMode = panelMode === 'crawler' ? 'inspect' : 'crawler';
					}}
				>
					Web Crawler
				</button>
				<button
					type="button"
					class="danger"
					disabled={!canEdit || busy || !selected}
					data-testid="delete-image-button"
					onclick={() => void deleteSelectedImage(selected)}
				>
					Delete
				</button>
			</div>

			{#if panelMode === 'create'}
				<form
					class="inline-card"
					data-testid="create-image-form"
					onsubmit={(event) => {
						event.preventDefault();
						void submitCreate();
					}}
				>
					<h3>Create new image</h3>
					<label class="field-label" for="create-image-name">Name</label>
					<input
						id="create-image-name"
						class="field-control"
						required
						maxlength={imageLimits.nameLength}
						placeholder="e.g. Cloud Sync"
						bind:value={createName}
					/>

					<label class="field-label" for="create-image-category">Category</label>
					<select id="create-image-category" class="field-control" bind:value={createCategory}>
						{#each imageCategories as cat (cat.value)}
							<option value={cat.value}>{cat.label}</option>
						{/each}
					</select>

					<label class="field-label" for="create-image-url">Image URL or server path</label>
					<input
						id="create-image-url"
						class="field-control"
						maxlength={imageLimits.urlLength}
						placeholder="/images/isometric/cloud.svg or https://…"
						bind:value={createUrl}
					/>

					{#if /^https?:\/\//i.test(createUrl.trim())}
						<label class="check-option">
							<input type="checkbox" bind:checked={createDownloadRemote} />
							<span
								>Save a copy into server folder (<code>static/images/{createCategory}/</code>)</span
							>
						</label>
					{/if}

					<label class="field-label" for="create-image-svg">
						Or paste inline <code>&lt;svg&gt;</code> markup (saved to server folder)
					</label>
					<textarea
						id="create-image-svg"
						class="field-control mono"
						rows="3"
						placeholder="<svg viewBox=&quot;0 0 24 24&quot; ...>...</svg>"
						bind:value={createSvgContent}></textarea>

					<div class="actions">
						<button
							type="submit"
							class="primary"
							disabled={busy ||
								!createName.trim() ||
								(!createUrl.trim() && !createSvgContent.trim())}
						>
							Create image
						</button>
						<button type="button" onclick={() => (panelMode = 'inspect')}>Cancel</button>
					</div>
				</form>
			{:else if panelMode === 'import'}
				<form
					class="inline-card"
					data-testid="import-image-form"
					onsubmit={(event) => {
						event.preventDefault();
						void submitImport();
					}}
				>
					<h3>Import image files</h3>
					<p class="panel-hint">
						Uploaded files are stored in <code>static/images/{importCategory}/</code> and added to the
						available images list.
					</p>
					<label class="field-label" for="import-image-files">Select file(s)</label>
					<input
						id="import-image-files"
						class="field-control"
						type="file"
						accept=".svg,.png,.jpg,.jpeg,.webp,.gif,image/svg+xml,image/png,image/jpeg,image/webp,image/gif"
						multiple
						{@attach attachFileInput}
						onchange={(event) => (importFiles = event.currentTarget.files)}
					/>

					<label class="field-label" for="import-image-category">Category</label>
					<select id="import-image-category" class="field-control" bind:value={importCategory}>
						{#each imageCategories as cat (cat.value)}
							<option value={cat.value}>{cat.label}</option>
						{/each}
					</select>

					<label class="field-label" for="import-image-name">Display name (optional)</label>
					<input
						id="import-image-name"
						class="field-control"
						maxlength={imageLimits.nameLength}
						placeholder="Defaults to filename"
						bind:value={importCustomName}
					/>

					<div class="actions">
						<button type="submit" class="primary" disabled={busy || !importFiles?.length}>
							Upload &amp; import
						</button>
						<button type="button" onclick={() => (panelMode = 'inspect')}>Cancel</button>
					</div>
				</form>
			{:else if panelMode === 'crawler'}
				<form
					class="inline-card"
					data-testid="web-crawler-form"
					onsubmit={(event) => {
						event.preventDefault();
						void scanWebUrl();
					}}
				>
					<h3>Import SVGs from Web Crawler</h3>
					<p class="panel-hint">
						Scan any web page or SVG collection URL (such as SVG Repo), preview all discovered SVGs,
						remove unwanted items or cancel the import.
					</p>
					<label class="field-label" for="crawl-web-url">Web page / collection URL</label>
					<input
						id="crawl-web-url"
						class="field-control"
						type="url"
						required
						placeholder="https://www.svgrepo.com/collection/isometric-3d-interface-icons/"
						value={crawlUrl}
						oninput={(event) => handleCrawlUrlInput(event.currentTarget.value)}
					/>

					<label class="field-label" for="crawl-folder">
						Path element / folder (<code>static/images/&lt;path&gt;/</code>)
					</label>
					<input
						id="crawl-folder"
						class="field-control mono"
						placeholder="e.g. isometric"
						value={crawlFolder}
						oninput={(event) => {
							crawlFolderTouched = true;
							crawlFolder = event.currentTarget.value;
						}}
					/>

					<label class="field-label" for="crawl-category">Category</label>
					<select id="crawl-category" class="field-control" bind:value={crawlCategory}>
						{#each imageCategories as cat (cat.value)}
							<option value={cat.value}>{cat.label}</option>
						{/each}
					</select>

					<div class="actions">
						<button type="submit" class="primary" disabled={busy || !crawlUrl.trim()}>
							{busy ? 'Scanning…' : 'Scan URL for SVGs'}
						</button>
						<button type="button" onclick={cancelCrawlImport}>Cancel</button>
					</div>
				</form>
			{/if}

			{#if errorMsg}
				<p class="error-banner" role="alert">{errorMsg}</p>
			{/if}

			<ul class="image-list" aria-label="Available images" data-testid="image-list">
				{#each visibleImages as item (item.id)}
					<li class="image-row">
						<button
							type="button"
							class="image-item"
							class:selected={selected && item.id === selected.id}
							aria-current={selected && item.id === selected.id ? 'true' : undefined}
							data-testid="image-item"
							onclick={() => {
								selectedId = item.id;
								errorMsg = '';
							}}
						>
							<span class="thumb">
								<img src={item.url} alt="" loading="lazy" />
							</span>
							<span class="meta">
								<span class="title-line">
									<strong>{item.name}</strong>
									<span class="badge-group">
										<span class="badge path-badge">{imagePathElement(item.url)}</span>
										<span class="badge category">{imageCategoryLabel(item.category)}</span>
									</span>
								</span>
								<code class="url-line">{item.url}</code>
							</span>
						</button>
					</li>
				{:else}
					<li class="list-empty">No images match your filter.</li>
				{/each}
			</ul>

			{#if missingDefaultsCount > 0 && canEdit}
				<div class="restore-bar">
					<button type="button" class="link-button" disabled={busy} onclick={restoreDefaults}>
						Restore {missingDefaultsCount} deleted default icon{missingDefaultsCount === 1
							? ''
							: 's'}
					</button>
				</div>
			{/if}
		</aside>

		<section class="canvas-panel" aria-label="Image preview and widget showcase">
			<div class="canvas-toolbar">
				<div class="canvas-label">
					<span class="live-dot" aria-hidden="true"></span>
					<span>Image preview</span>
					{#if selected}
						<span class="canvas-path">{selected.name}</span>
						<span class="badge category">{imageCategoryLabel(selected.category)}</span>
					{/if}
				</div>
				<div class="surface-Quick">
					<div class="surface-switch" role="group" aria-label="Preview backdrop">
						<button
							type="button"
							class:active={surface === 'checker'}
							onclick={() => (surface = 'checker')}
						>
							Checker
						</button>
						<button
							type="button"
							class:active={surface === 'light'}
							onclick={() => (surface = 'light')}
						>
							Light
						</button>
						<button
							type="button"
							class:active={surface === 'dark'}
							onclick={() => (surface = 'dark')}
						>
							Dark
						</button>
					</div>
					{#if selected}
						<button type="button" class="copy-button" onclick={() => copyUrl(selected.url)}>
							Copy URL
						</button>
					{/if}
				</div>
			</div>

			<div class="canvas-stage">
				{#if crawlCandidates.length > 0}
					<div class="preview-layout">
						<div class="crawler-preview-box" data-testid="crawler-preview-panel">
							<div class="crawler-preview-header">
								<div>
									<h3>
										Web Crawler Preview ({selectedCrawlItems.length} of {crawlCandidates.length} selected)
									</h3>
									<p class="panel-hint">
										Source: <code>{crawlSourceUrl}</code> · Target path:
										<code>/images/{crawlFolder || extractUrlLastPathElement(crawlUrl)}/</code>
									</p>
								</div>
								<div class="crawler-header-actions">
									<button
										type="button"
										onclick={() => setAllCrawlSelected(true)}
										disabled={busy || selectedCrawlItems.length === crawlCandidates.length}
									>
										Select all
									</button>
									<button
										type="button"
										onclick={() => setAllCrawlSelected(false)}
										disabled={busy || selectedCrawlItems.length === 0}
									>
										Deselect all
									</button>
									<button
										type="button"
										class="primary"
										data-testid="confirm-crawler-import"
										disabled={busy || selectedCrawlItems.length === 0}
										onclick={commitCrawlImport}
									>
										Import selected ({selectedCrawlItems.length})
									</button>
									<button
										type="button"
										class="danger"
										data-testid="cancel-crawler-import"
										disabled={busy}
										onclick={cancelCrawlImport}
									>
										Cancel import
									</button>
								</div>
							</div>

							<div class="crawler-grid">
								{#each crawlCandidates as candidate (candidate.id)}
									<div
										class="crawler-card"
										class:excluded={!candidate.selected}
										data-testid="crawler-candidate-card"
									>
										<div class="crawler-card-top">
											<label class="crawler-check">
												<input
													type="checkbox"
													bind:checked={candidate.selected}
													aria-label="Include {candidate.name}"
												/>
												<span>Include</span>
											</label>
											<button
												type="button"
												class="crawler-remove"
												title="Remove this SVG from import"
												aria-label="Remove {candidate.name}"
												onclick={() => removeCrawlCandidate(candidate.id)}
											>
												✕
											</button>
										</div>
										<div class="crawler-thumb surface-{surface}">
											<img src={candidate.previewUrl} alt={candidate.name} loading="lazy" />
										</div>
										<input
											class="field-control crawler-name-input"
											aria-label="Name for {candidate.name}"
											bind:value={candidate.name}
										/>
									</div>
								{/each}
							</div>
						</div>
					</div>
				{:else if selected}
					<div class="preview-layout">
						<div class="hero-preview surface-{surface}">
							<img src={selected.url} alt={selected.name} data-testid="selected-image-preview" />
							<div class="hero-caption">
								<strong>{selected.name}</strong>
								<code>{selected.url}</code>
							</div>
						</div>

						<div class="widget-showcase">
							<h3>Live widget preview</h3>
							<p class="panel-hint">
								How <strong>{selected.name}</strong> appears when picked on widgets in the editor:
							</p>
							<ThemeScope theme={siteTheme}>
								<div class="showcase-grid">
									<div class="showcase-cell">
										<span class="cell-label">Button</span>
										<div class="cell-box h-11">
											<WidgetButton
												action={selected.name}
												body={selected.name}
												image={selected.url}
											/>
										</div>
									</div>
									<div class="showcase-cell">
										<span class="cell-label">Link</span>
										<div class="cell-box h-11">
											<WidgetLink
												title="Explore {selected.name}"
												body={selected.name}
												href="/home"
												newTab={false}
												image={selected.url}
											/>
										</div>
									</div>
									<div class="showcase-cell">
										<span class="cell-label">Avatar</span>
										<div class="cell-box h-12">
											<WidgetAvatar
												title={selected.name}
												body={imageCategoryLabel(selected.category)}
												image={selected.url}
											/>
										</div>
									</div>
									<div class="showcase-cell">
										<span class="cell-label">Badge</span>
										<div class="cell-box h-10">
											<WidgetBadge title={selected.name} body={selected.url} image={selected.url} />
										</div>
									</div>
									<div class="showcase-cell wide">
										<span class="cell-label">Card</span>
										<div class="cell-box h-28">
											<WidgetCard
												title={selected.name}
												body="Available in the {imageCategoryLabel(selected.category)} collection."
												action="Select"
												image={selected.url}
											/>
										</div>
									</div>
									<div class="showcase-cell wide">
										<span class="cell-label">Image widget</span>
										<div class="cell-box h-32">
											<WidgetImage
												title={selected.name}
												body={selected.name}
												action={selected.url}
												image={selected.url}
											/>
										</div>
									</div>
								</div>
							</ThemeScope>
						</div>

						<div class="gallery-section">
							<h3>
								{categoryFilter === 'all'
									? 'All available icons & images'
									: imageCategoryLabel(categoryFilter)}
								<small>({visibleImages.length})</small>
							</h3>
							<div class="gallery-grid">
								{#each visibleImages as img (img.id)}
									<button
										type="button"
										class="gallery-card"
										class:active={selected.id === img.id}
										onclick={() => (selectedId = img.id)}
									>
										<img src={img.url} alt="" loading="lazy" />
										<strong>{img.name}</strong>
										<small>{imageCategoryLabel(img.category)}</small>
									</button>
								{/each}
							</div>
						</div>
					</div>
				{:else}
					<div class="empty-state">
						<h3>No images available</h3>
						<p>Create or import an image to make it available in the editor.</p>
					</div>
				{/if}
			</div>
		</section>

		<aside class="inspector-panel" aria-label="Image properties">
			<div class="panel-heading">
				<h2>Image properties</h2>
			</div>
			{#if selected}
				<fieldset class="inspector-content" disabled={!canEdit}>
					<label class="field-label" for="image-name">Name</label>
					<input
						id="image-name"
						class="field-control"
						maxlength={imageLimits.nameLength}
						bind:value={draft.name}
					/>

					<label class="field-label" for="image-url">URL</label>
					<input
						id="image-url"
						class="field-control mono"
						maxlength={imageLimits.urlLength}
						bind:value={draft.url}
					/>
					<p class="panel-hint">
						Local server path (<code>/images/isometric/…</code>) or external <code>https://</code> URL.
					</p>

					<label class="field-label" for="image-category">Category</label>
					<select id="image-category" class="field-control" bind:value={draft.category}>
						{#each imageCategories as cat (cat.value)}
							<option value={cat.value}>{cat.label}</option>
						{/each}
					</select>
					<p class="panel-hint">
						{imageCategories.find((cat) => cat.value === draft.category)?.description}
					</p>

					<div class="actions settings-actions">
						<button type="button" class="primary" disabled={busy || !dirty} onclick={saveImage}>
							Save changes
						</button>
						<button
							type="button"
							disabled={!dirty}
							onclick={() =>
								selected &&
								(draft = {
									name: selected.name,
									url: selected.url,
									category: selected.category
								})}
						>
							Revert
						</button>
					</div>
				</fieldset>

				<div class="inspector-section">
					<span class="field-label">Details</span>
					<dl class="detail-list">
						<div>
							<dt>Source</dt>
							<dd>{selected.builtIn ? 'SVG Repo · Isometric 3D Icons' : 'Custom / Imported'}</dd>
						</div>
						<div>
							<dt>Category key</dt>
							<dd><code>{selected.category}</code></dd>
						</div>
					</dl>
				</div>

				{#if canEdit}
					<div class="inspector-section danger-zone">
						<span class="field-label">Remove from library</span>
						<p class="panel-hint">
							Deleting removes <strong>{selected.name}</strong> from widget pickers{selected.builtIn
								? ' (you can restore default icons at any time)'
								: ' and deletes its uploaded file from static/images/'}.
						</p>
						<button
							type="button"
							class="danger-button"
							disabled={busy}
							onclick={() => void deleteSelectedImage(selected)}
						>
							Delete “{selected.name}”
						</button>
					</div>
				{/if}
			{:else}
				<p class="panel-hint">Select an image from the list to inspect or edit its properties.</p>
			{/if}
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

	.workspace {
		display: grid;
		grid-template-columns: 350px minmax(0, 1fr) 310px;
		min-height: calc(100vh - 3.6rem);
	}

	.palette-panel,
	.inspector-panel {
		padding: 1.25rem;
		background: #fff;
	}

	.palette-panel {
		display: flex;
		flex-direction: column;
		border-right: 1px solid var(--line);
	}

	.inspector-panel {
		border-left: 1px solid var(--line);
	}

	.panel-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.panel-heading h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: -0.025em;
	}

	.count-pill {
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: #f0edff;
		color: var(--purple);
		font-size: 0.68rem;
		font-weight: 700;
	}

	.panel-hint {
		margin: 0.55rem 0 0.9rem;
		color: var(--muted);
		font-size: 0.72rem;
		line-height: 1.5;
	}

	.filters {
		display: grid;
		gap: 0.45rem;
		margin-bottom: 0.65rem;
	}

	.filter-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.4rem;
	}

	.path-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.path-chip {
		padding: 0.2rem 0.5rem;
		border: 1px solid #e3e1f0;
		border-radius: 999px;
		background: #faf9fe;
		color: #52546c;
		font: inherit;
		font-size: 0.65rem;
		font-weight: 600;
		cursor: pointer;
	}

	.path-chip.active {
		border-color: var(--purple);
		background: #efebff;
		color: var(--purple);
	}

	.crawler-preview-box {
		padding: 1.25rem;
		border: 1px solid #dcd8f6;
		border-radius: 12px;
		background: #fff;
	}

	.crawler-preview-header {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.85rem;
		margin-bottom: 1rem;
		padding-bottom: 0.85rem;
		border-bottom: 1px solid var(--line);
	}

	.crawler-preview-header h3 {
		margin: 0;
		font-size: 0.96rem;
		font-weight: 700;
	}

	.crawler-header-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.crawler-header-actions button {
		padding: 0.42rem 0.7rem;
		border: 1px solid #dfdee8;
		border-radius: 7px;
		background: #fff;
		color: #2f3247;
		font: inherit;
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
	}

	.crawler-header-actions button.primary {
		border-color: var(--purple);
		background: var(--purple);
		color: #fff;
	}

	.crawler-header-actions button.danger {
		border-color: #f1cfd2;
		background: #fff6f7;
		color: #b93842;
	}

	.crawler-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 0.65rem;
	}

	.crawler-card {
		display: grid;
		gap: 0.45rem;
		padding: 0.6rem;
		border: 1px solid #e7e5f3;
		border-radius: 9px;
		background: #fcfbff;
	}

	.crawler-card.excluded {
		opacity: 0.48;
		background: #f6f6f9;
	}

	.crawler-card-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.68rem;
	}

	.crawler-check {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-weight: 600;
		cursor: pointer;
	}

	.crawler-remove {
		width: 22px;
		height: 22px;
		display: grid;
		place-items: center;
		border: 1px solid transparent;
		border-radius: 5px;
		background: transparent;
		color: #8f91a6;
		font-size: 0.7rem;
		cursor: pointer;
	}

	.crawler-remove:hover {
		border-color: #f1cfd2;
		background: #fff5f6;
		color: #b93842;
	}

	.crawler-thumb {
		height: 76px;
		display: grid;
		place-items: center;
		border: 1px solid #ecebf4;
		border-radius: 7px;
		padding: 0.4rem;
		background: #fff;
	}

	.crawler-thumb img {
		max-width: 100%;
		max-height: 60px;
		object-fit: contain;
	}

	.crawler-name-input {
		min-height: 30px;
		padding: 0.3rem 0.45rem;
		font-size: 0.68rem;
	}

	.field-label {
		display: block;
		margin: 0.75rem 0 0.35rem;
		color: #686a80;
		font-size: 0.68rem;
		font-weight: 650;
	}

	.field-control {
		display: block;
		width: 100%;
		min-height: 36px;
		padding: 0.5rem 0.65rem;
		border: 1px solid #e7e7ee;
		border-radius: 7px;
		background: #fff;
		color: #33354a;
		font: inherit;
		font-size: 0.73rem;
		outline: none;
	}

	.field-control:focus {
		border-color: #978be9;
		box-shadow: 0 0 0 3px rgb(119 102 223 / 12%);
	}

	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.68rem;
	}

	.actions {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.65rem;
	}

	.top-actions {
		margin-top: 0;
		margin-bottom: 0.75rem;
	}

	.actions button,
	.copy-button {
		flex: 1;
		padding: 0.45rem 0.65rem;
		border: 1px solid #dfdee8;
		border-radius: 7px;
		background: #fff;
		color: #2f3247;
		font: inherit;
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
	}

	.actions button:hover:not(:disabled),
	.copy-button:hover {
		border-color: #b7b3d8;
		background: #faf9ff;
	}

	.actions button.primary {
		border-color: var(--purple);
		background: var(--purple);
		color: #fff;
	}

	.actions button.danger,
	.danger-button {
		border-color: #f1cfd2;
		background: #fff6f7;
		color: #b93842;
	}

	.actions button:disabled,
	.danger-button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.inline-card {
		margin-bottom: 0.85rem;
		padding: 0.8rem;
		border: 1px solid #dedaf5;
		border-radius: 10px;
		background: #faf9ff;
	}

	.inline-card h3 {
		margin: 0 0 0.3rem;
		font-size: 0.82rem;
		font-weight: 700;
	}

	.check-option {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-top: 0.5rem;
		font-size: 0.68rem;
		color: #4f5269;
	}

	.error-banner {
		margin: 0 0 0.65rem;
		padding: 0.5rem 0.65rem;
		border: 1px solid #f3c4c8;
		border-radius: 7px;
		background: #fff5f6;
		color: #b3261e;
		font-size: 0.72rem;
	}

	.image-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.35rem;
		max-height: calc(100vh - 20rem);
		overflow-y: auto;
	}

	.image-item {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.5rem 0.6rem;
		border: 1px solid #ececf3;
		border-radius: 9px;
		background: #fff;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.image-item:hover {
		border-color: #cbc6ef;
		background: #fcfbff;
	}

	.image-item.selected {
		border-color: var(--purple);
		background: #f4f1ff;
		box-shadow: 0 0 0 2px rgb(107 92 231 / 12%);
	}

	.thumb {
		width: 38px;
		height: 38px;
		flex-shrink: 0;
		display: grid;
		place-items: center;
		border: 1px solid #eeecf7;
		border-radius: 8px;
		background: #fff;
		padding: 3px;
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.meta {
		min-width: 0;
		flex: 1;
		display: grid;
		gap: 0.2rem;
	}

	.title-line {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
	}

	.title-line strong {
		overflow: hidden;
		font-size: 0.76rem;
		font-weight: 650;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.url-line {
		overflow: hidden;
		color: var(--muted);
		font-size: 0.63rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.badge-group {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	.badge.path-badge {
		flex-shrink: 0;
		padding: 0.1rem 0.42rem;
		border-radius: 999px;
		background: #eef6ff;
		color: #1d58b8;
		font-size: 0.58rem;
		font-weight: 650;
	}

	.badge.category {
		flex-shrink: 0;
		padding: 0.1rem 0.42rem;
		border-radius: 999px;
		background: #eeebff;
		color: #5445c5;
		font-size: 0.6rem;
		font-weight: 650;
	}

	.restore-bar {
		margin-top: 0.65rem;
		padding-top: 0.55rem;
		border-top: 1px solid var(--line);
		text-align: center;
	}

	.link-button {
		border: 0;
		background: transparent;
		color: var(--purple);
		font: inherit;
		font-size: 0.7rem;
		font-weight: 600;
		cursor: pointer;
	}

	.canvas-panel {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.canvas-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 1.4rem;
		border-bottom: 1px solid var(--line);
		background: #fff;
		font-size: 0.75rem;
	}

	.canvas-label {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		font-weight: 600;
	}

	.live-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #2bb673;
	}

	.canvas-path {
		color: var(--muted);
		font-weight: 500;
	}

	.surface-Quick {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.surface-switch {
		display: inline-flex;
		border: 1px solid #e2e1ec;
		border-radius: 7px;
		overflow: hidden;
	}

	.surface-switch button {
		padding: 0.3rem 0.6rem;
		border: 0;
		background: #fff;
		font: inherit;
		font-size: 0.68rem;
		cursor: pointer;
	}

	.surface-switch button.active {
		background: #efecff;
		color: var(--purple);
		font-weight: 650;
	}

	.canvas-stage {
		flex: 1;
		padding: 1.5rem;
		overflow-y: auto;
	}

	.preview-layout {
		display: grid;
		gap: 1.5rem;
		max-width: 960px;
		margin: 0 auto;
	}

	.hero-preview {
		display: grid;
		justify-items: center;
		gap: 1rem;
		padding: 2rem;
		border: 1px solid #e3e2ee;
		border-radius: 14px;
	}

	.hero-preview.surface-checker {
		background-color: #ffffff;
		background-image:
			linear-gradient(45deg, #f2f2f7 25%, transparent 25%),
			linear-gradient(-45deg, #f2f2f7 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, #f2f2f7 75%),
			linear-gradient(-45deg, transparent 75%, #f2f2f7 75%);
		background-size: 20px 20px;
		background-position:
			0 0,
			0 10px,
			10px -10px,
			-10px 0;
	}

	.hero-preview.surface-light {
		background: #ffffff;
	}

	.hero-preview.surface-dark {
		background: #181a29;
		color: #f4f4f8;
	}

	.hero-preview img {
		width: 148px;
		height: 148px;
		object-fit: contain;
	}

	.hero-caption {
		display: grid;
		justify-items: center;
		gap: 0.2rem;
		font-size: 0.82rem;
	}

	.hero-caption code {
		color: var(--muted);
		font-size: 0.72rem;
	}

	.widget-showcase,
	.gallery-section {
		padding: 1.2rem;
		border: 1px solid #e5e4f0;
		border-radius: 12px;
		background: #fff;
	}

	.widget-showcase h3,
	.gallery-section h3 {
		margin: 0;
		font-size: 0.92rem;
		font-weight: 700;
	}

	.showcase-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.85rem;
	}

	.showcase-cell {
		padding: 0.65rem 0.75rem;
		border: 1px solid #ededf5;
		border-radius: 9px;
		background: var(--site-bg, #fff);
		color: var(--site-fg, inherit);
	}

	.showcase-cell.wide {
		grid-column: span 1;
	}

	.cell-label {
		display: block;
		margin-bottom: 0.35rem;
		color: #81839a;
		font-size: 0.64rem;
		font-weight: 650;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.cell-box {
		display: flex;
		align-items: center;
	}

	.gallery-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
		gap: 0.6rem;
		margin-top: 0.85rem;
	}

	.gallery-card {
		display: grid;
		justify-items: center;
		gap: 0.3rem;
		padding: 0.65rem 0.45rem;
		border: 1px solid #ecebf5;
		border-radius: 9px;
		background: #fcfbfe;
		color: inherit;
		font: inherit;
		text-align: center;
		cursor: pointer;
	}

	.gallery-card:hover {
		border-color: #b9b1f0;
		background: #f6f4ff;
	}

	.gallery-card.active {
		border-color: var(--purple);
		background: #f1eeff;
		box-shadow: 0 0 0 2px rgb(107 92 231 / 16%);
	}

	.gallery-card img {
		width: 42px;
		height: 42px;
		object-fit: contain;
	}

	.gallery-card strong {
		width: 100%;
		overflow: hidden;
		font-size: 0.68rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.gallery-card small {
		color: var(--muted);
		font-size: 0.58rem;
	}

	.inspector-content {
		margin: 0;
		padding: 0;
		border: 0;
	}

	.inspector-section {
		margin-top: 1.25rem;
		padding-top: 1rem;
		border-top: 1px solid var(--line);
	}

	.detail-list {
		margin: 0.4rem 0 0;
		display: grid;
		gap: 0.35rem;
		font-size: 0.72rem;
	}

	.detail-list div {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.detail-list dt {
		color: var(--muted);
	}

	.detail-list dd {
		margin: 0;
		font-weight: 600;
	}

	.danger-button {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: 1px solid #f1cfd2;
		border-radius: 7px;
		font: inherit;
		font-size: 0.73rem;
		font-weight: 600;
		cursor: pointer;
	}

	.list-empty,
	.empty-state {
		padding: 1.5rem 0.75rem;
		color: var(--muted);
		font-size: 0.75rem;
		text-align: center;
	}

	@media (max-width: 1100px) {
		.workspace {
			grid-template-columns: 300px minmax(0, 1fr);
		}
		.inspector-panel {
			grid-column: 1 / -1;
			border-left: 0;
			border-top: 1px solid var(--line);
		}
	}

	@media (max-width: 760px) {
		.workspace {
			grid-template-columns: 1fr;
		}
		.palette-panel {
			border-right: 0;
			border-bottom: 1px solid var(--line);
		}
		.showcase-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
