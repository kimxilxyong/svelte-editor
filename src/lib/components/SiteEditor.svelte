<script lang="ts">
	/**
	 * @fileoverview Visual Drag-and-Drop canvas editor shared by `/editor` (pages) and
	 * `/composites` (Composite Components).
	 *
	 * The `mode` prop selects what is edited. In `pages` mode the documents are the site's pages;
	 * in `composites` mode they are the reusable Composite Components (named groups of widgets),
	 * mapped to the page-shaped `EditorPage` (slug = name) so the same canvas, history and
	 * inspector code serves both. The kind not being edited is stashed and merged back on save, so
	 * every save writes the whole `EditorSite`. Composites render through `provideComposites`
	 * (see `composite-context.ts`); placing a composite inside another is cycle-checked here and
	 * on the server.
	 *
	 * Architecture & Features:
	 * 1. Palette:
	 *    - Categorized tabs: "Composites" (reusable widget groups), "Widgets" (atomic GUI
	 *      widgets), and "Custom" (dynamically imported project components).
	 *    - Pure drag-and-drop placement with canvas-relative percentage coordinates.
	 * 2. Canvas Stage:
	 *    - Canvas size picker with common resolutions (default Full HD 1920×1080).
	 *    - Direct pointer interaction: a selected block shows a border frame with 8 handles
	 *      (corners + edges) to resize; dragging inside the block moves it. Both snap to an
	 *      8px grid (hold Alt to bypass). Keyboard: arrows move, Alt+arrows resize (Shift = 10px).
	 *    - Automatic vertical expansion accommodating block boundaries.
	 *    - Multi-page switching and route jump support in Preview mode.
	 * 3. History & State Management:
	 *    - Debounced snapshot-based Undo/Redo stack with keyboard shortcuts (Ctrl+Z, Ctrl+Shift+Z/Y).
	 *    - Duplicate (Ctrl+D) and Delete (Delete/Backspace) keyboard commands.
	 * 4. Inspector:
	 *    - Geometry controls (X, Y, Width, Height — all px).
	 *    - Layer ordering: To Front, Forward, Backward, To Back (z-order array management).
	 *    - Dynamic prop editor for custom imported components and specialized widget controls.
	 * 5. Database Integration:
	 *    - Seamless load and save of `EditorSite` models with `/editor/api`.
	 */

	/**
	 * @component SiteEditor
	 * @prop {'pages' | 'composites'} [mode='pages'] - Which documents the canvas edits. Fixed for
	 *   the lifetime of the component (the routes mount one editor per mode).
	 */
	import { onMount } from 'svelte';
	import { page as routePage } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import BlockContent from './BlockContent.svelte';
	import ThemeScope from './editor/ThemeScope.svelte';
	import BuilderHeader from './BuilderHeader.svelte';
	import { useNavContext } from '../navigation.svelte.js';
	import { provideComposites } from '../composite-context.js';
	import { seedComposites } from '../composite-seeds.js';
	import {
		blockLimits,
		compositeLimits,
		defaultCanvasSize,
		isValidLinkHref,
		type BuilderBlock,
		type BlockKind,
		type EditorPage,
		type EditorSite,
		type EditorComposite,
		compositeKind,
		isValidCompositeKind,
		findCompositeCycle,
		type WidgetKind
	} from '../editor.js';
	import {
		filterWidgets,
		widgetCatalog,
		widgetCategories,
		type WidgetCategory
	} from '../widget-catalog.js';

	/** Compass direction of the selection-frame handle being dragged (corners and edges). */
	type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
	type DragPayload = { source: 'palette'; kind: BlockKind };
	type EditorApiResponse = {
		created?: boolean;
		site?: EditorSite | null;
		success?: boolean;
		error?: string;
	};
	type PaletteTab = 'composites' | 'widgets' | 'custom';

	/** `pages`: edits site pages. `composites`: edits composite components on the same canvas. */
	let { mode = 'pages' }: { mode?: 'pages' | 'composites' } = $props();
	const composing = untrack(() => mode === 'composites');
	/** Route that hosts this editor and the query parameter selecting the open document. */
	const basePath = composing ? '/composites' : '/editor';
	const paramName = composing ? 'composite' : 'page';
	const docLabel = composing ? 'composite' : 'page';

	// Flowbite widget palette data (label, category, defaults) lives in the shared catalog.
	const widgetInfo: Record<WidgetKind, { label: string; detail: string; mark: string }> =
		widgetCatalog;
	const widgetKinds = Object.keys(widgetInfo) as WidgetKind[];
	/** Widgets whose action field is the label of a button. */
	const actionWidgetKinds: BlockKind[] = [];
	/** One-line format hint shown under the "Entries" editor of list-like widgets. */
	const itemsHelp: Record<string, string> = { 'widget-select': 'One option per line.' };
	let widgetQuery = $state('');
	let widgetCategory = $state<'All' | WidgetCategory>('All');
	/** Widgets matching the search box and category chip, grouped for display. */
	const widgetGroups = $derived(
		widgetCategories
			.filter((category) => widgetCategory === 'All' || widgetCategory === category)
			.map((category) => ({
				category,
				kinds: filterWidgets(
					widgetKinds.filter((kind) => widgetCatalog[kind].category === category),
					widgetQuery
				)
			}))
			.filter((group) => group.kinds.length > 0)
	);
	const visibleWidgetCount = $derived(widgetGroups.reduce((n, g) => n + g.kinds.length, 0));
	type ComponentInfo = { label: string; detail: string; mark: string };
	/** Label, hint and glyph of any block kind: widgets from the catalog, composites and imports by name. */
	const componentInfo = new Proxy(widgetInfo as Record<string, ComponentInfo>, {
		get(target, prop: string) {
			if (typeof prop === 'string' && prop in target) return target[prop];
			if (typeof prop === 'string' && prop.startsWith('composite:')) {
				return { label: prop.slice(10), detail: 'Composite component', mark: '◧' };
			}
			if (typeof prop === 'string' && prop.startsWith('custom:')) {
				return { label: prop.slice(7), detail: 'Imported component', mark: '✳' };
			}
			return { label: String(prop), detail: 'Component', mark: '✳' };
		}
	}) as Record<BlockKind, ComponentInfo>;

	type BlockDefaults = Omit<
		BuilderBlock,
		| 'id'
		| 'positioned'
		| 'x'
		| 'y'
		| 'width'
		| 'height'
		| 'value'
		| 'checked'
		| 'level'
		| 'href'
		| 'newTab'
	>;

	/** Block content for every widget kind, derived from the catalog. */
	const widgetDefaults = Object.fromEntries(
		widgetKinds.map((kind) => {
			const { theme, title, body, action, items } = widgetCatalog[kind].defaults;
			return [
				kind,
				{ kind, title, body, action, theme: theme ?? 'light', ...(items ? { items } : {}) }
			];
		})
	) as Record<WidgetKind, BlockDefaults>;

	/** The sample page shown before anything is saved: composite instances of the starters. */
	const initialPage: EditorPage = {
		id: 'home',
		name: 'Home',
		slug: 'home',
		width: defaultCanvasSize.width,
		height: defaultCanvasSize.height,
		blocks: (
			[
				['sample-hero', 'Hero', 24, 720, 220],
				['sample-features', 'FeatureCards', 264, 720, 260],
				['sample-quote', 'Testimonial', 544, 720, 200]
			] as const
		).map(([id, name, y, width, height]) => ({
			id,
			kind: compositeKind(name),
			title: '',
			body: '',
			action: '',
			theme: 'light' as const,
			positioned: true,
			x: 24,
			y,
			width,
			height,
			value: '',
			checked: false,
			level: 60,
			href: '',
			newTab: false
		}))
	};

	/** Composites are edited as page-shaped documents (the slug mirrors the name). */
	const toDoc = (composite: EditorComposite): EditorPage => ({
		...composite,
		slug: composite.name
	});
	const toComposite = (doc: EditorPage): EditorComposite => ({
		id: doc.id,
		name: doc.name,
		width: doc.width,
		height: doc.height,
		blocks: doc.blocks
	});

	/**
	 * The documents being edited: the site's pages, or (in composite mode) its composites. The
	 * other kind is kept untouched in `stashed*` and merged back when saving, so one save always
	 * writes the complete site.
	 */
	let pages = $state<EditorPage[]>(composing ? seedComposites().map(toDoc) : [initialPage]);
	let stashedPages = $state.raw<EditorPage[]>(composing ? [initialPage] : []);
	let stashedComposites = $state.raw<EditorComposite[]>(composing ? [] : seedComposites());
	/** Composites that `composite:<Name>` blocks render from (live while editing one). */
	const composites = $derived(composing ? pages.map(toComposite) : stashedComposites);
	provideComposites(() => composites);

	let currentPageId = $state(composing ? 'seed-hero' : 'home');
	let currentPage = $derived(pages.find((page) => page.id === currentPageId) ?? pages[0]);
	let blocks = $derived(currentPage.blocks);
	let selectedId = $state<string | null>(composing ? 'seed-hero-0' : 'sample-hero');
	let paletteTab = $state<PaletteTab>(composing ? 'widgets' : 'composites');
	let isPreview = $state(false);
	let databaseReady = $state(false);
	let databaseBusy = $state(true);
	let databaseStatus = $state('Checking database…');
	/**
	 * Set for `guest` users, who may view but not change the site (the server rejects their writes
	 * as well; this only explains and disables the Save button). Read from the root layout data.
	 */
	const readOnlyNotice = $derived(
		routePage.data.user?.role === 'guest' ? 'Read-only: your role cannot save' : undefined
	);

	let hasUnsavedChanges = $state(true);
	// Feeds the shared top navigation (page switcher, labels, unsaved-changes guard).
	useNavContext(() => ({
		pages: composing ? [] : pages,
		activePageId: composing ? null : currentPageId,
		unsavedChanges: hasUnsavedChanges
	}));
	let revision = $state(0);
	let routeError = $state<string | null>(null);
	let undoStack = $state.raw<string[]>([]);
	let redoStack = $state.raw<string[]>([]);
	let historyPending = $state(false);
	let historyTimer: ReturnType<typeof setTimeout> | undefined;
	let committedSnapshot = JSON.stringify([initialPage]);
	let canvasElement: HTMLDivElement | null = null;
	/** Grid size in canvas pixels that moves and resizes snap to (hold Alt while dragging to bypass). */
	const SNAP_GRID = 8;
	const resizeHandles: ResizeDir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
	const snap = (value: number, enabled: boolean) =>
		enabled ? Math.round(value / SNAP_GRID) * SNAP_GRID : Math.round(value);
	let pointerInteraction = $state<{
		id: string;
		pointerId: number;
		mode: 'move' | 'resize';
		/** Which edges a resize drags; ignored for `move`. */
		dir: ResizeDir;
		startX: number;
		startY: number;
		startWidth: number;
		startHeight: number;
		pointerX: number;
		pointerY: number;
		/** Rendered canvas width divided by its CSS pixel width (1 unless the canvas is scaled). */
		scale: number;
	} | null>(null);

	let customKinds = $derived([
		...new Set(
			pages.flatMap((page) => page.blocks.map((b) => b.kind).filter((k) => k.startsWith('custom:')))
		)
	]);
	let selectedBlock = $derived(blocks.find((block) => block.id === selectedId));
	let blockCount = $derived(blocks.length);
	let canvasHeight = $derived(
		Math.max(currentPage.height, ...blocks.map((block) => block.y + block.height + 40))
	);
	let selectedLabel = $derived(
		selectedBlock ? componentInfo[selectedBlock.kind].label : 'Nothing selected'
	);

	let canUndo = $derived(undoStack.length > 0 || historyPending);
	let canRedo = $derived(redoStack.length > 0);

	onMount(() => {
		void loadDatabaseState();
		return () => clearTimeout(historyTimer);
	});

	async function requestApi(
		method: 'GET' | 'POST',
		payload?: { action: 'create-tables' } | { action: 'save'; site: EditorSite }
	): Promise<EditorApiResponse> {
		const response = await fetch('/editor/api', {
			method,
			cache: 'no-store',
			...(payload
				? {
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(payload)
					}
				: {})
		});
		const result = (await response.json()) as EditorApiResponse;

		if (!response.ok) {
			throw new Error(result.error ?? `Database request failed (${response.status}).`);
		}

		return result;
	}

	function applyDatabaseState(result: EditorApiResponse) {
		databaseReady = result.created === true;
		if (!databaseReady) {
			databaseStatus = 'Not saved yet · Save creates the database';
			return;
		}

		if (result.site) {
			if (composing) {
				stashedPages = result.site.pages;
				// A site without composites yet: offer the starters so there is something to edit.
				const loaded = result.site.composites.length ? result.site.composites : seedComposites();
				pages = loaded.map(toDoc);
			} else {
				pages = result.site.pages;
				stashedComposites = result.site.composites;
			}
			currentPageId =
				pages.find((item) => item.id === routePage.url.searchParams.get(paramName))?.id ??
				pages[0].id;
			selectedId = currentPage.blocks[0]?.id ?? null;
			resetHistory();
			hasUnsavedChanges = false;
			databaseStatus = 'Saved site loaded from the database';
		} else {
			hasUnsavedChanges = true;
			databaseStatus = 'Database ready · page not saved';
		}
	}

	async function loadDatabaseState() {
		databaseBusy = true;
		try {
			applyDatabaseState(await requestApi('GET'));
		} catch (error) {
			databaseStatus =
				error instanceof Error ? error.message : 'Unable to load the page from the database.';
		} finally {
			databaseBusy = false;
		}
	}

	async function savePageToDatabase() {
		if (databaseBusy || readOnlyNotice) return;

		if (pages.some((page) => page.blocks.some((block) => !isValidLinkHref(block.href)))) {
			databaseStatus = 'A link address is invalid. Use /page or https://…';
			return;
		}

		const savedRevision = revision;
		const edited = $state.snapshot(pages);
		const siteSnapshot: EditorSite = composing
			? { pages: [...stashedPages], composites: edited.map(toComposite) }
			: { pages: edited, composites: [...stashedComposites] };
		const cycle = findCompositeCycle(siteSnapshot.composites);
		if (cycle) {
			databaseStatus = `Composite "${cycle}" contains itself. Remove the loop to save.`;
			return;
		}
		databaseBusy = true;
		databaseStatus = 'Saving site to the database…';

		try {
			// First save on a fresh database: create the schema transparently.
			if (!databaseReady) {
				await requestApi('POST', { action: 'create-tables' });
				databaseReady = true;
			}
			await requestApi('POST', { action: 'save', site: siteSnapshot });
			hasUnsavedChanges = revision !== savedRevision;
			databaseStatus = hasUnsavedChanges
				? 'More changes still need saving'
				: 'Saved to the database';
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
		historyPending = true;
		clearTimeout(historyTimer);
		historyTimer = setTimeout(commitHistory, 350);
	}

	function takeSnapshot() {
		return JSON.stringify($state.snapshot(pages));
	}

	function commitHistory() {
		clearTimeout(historyTimer);
		historyPending = false;
		const snapshot = takeSnapshot();
		if (snapshot === committedSnapshot) return;
		undoStack = [...undoStack.slice(-99), committedSnapshot];
		redoStack = [];
		committedSnapshot = snapshot;
	}

	function resetHistory() {
		clearTimeout(historyTimer);
		historyPending = false;
		undoStack = [];
		redoStack = [];
		committedSnapshot = takeSnapshot();
	}

	function restoreSnapshot(snapshot: string) {
		pages = JSON.parse(snapshot) as EditorPage[];
		if (!pages.some((page) => page.id === currentPageId)) currentPageId = pages[0].id;
		if (!currentPage.blocks.some((block) => block.id === selectedId)) selectedId = null;
		committedSnapshot = snapshot;
		revision += 1;
		hasUnsavedChanges = true;
		if (databaseReady) databaseStatus = 'Unsaved changes';
	}

	function undo() {
		commitHistory();
		const previous = undoStack.at(-1);
		if (previous === undefined) return;
		redoStack = [...redoStack, committedSnapshot];
		undoStack = undoStack.slice(0, -1);
		restoreSnapshot(previous);
	}

	function redo() {
		commitHistory();
		const next = redoStack.at(-1);
		if (next === undefined) return;
		undoStack = [...undoStack, committedSnapshot];
		redoStack = redoStack.slice(0, -1);
		restoreSnapshot(next);
	}

	/**
	 * Selects a page. The URL (`?page=<id>`) is the source of truth for history: the state is
	 * applied immediately for responsiveness and a history entry is pushed so browser/app Back
	 * returns to the previously edited page. The URL effect below handles the reverse direction.
	 */
	function selectPage(id: string) {
		applyPageSelection(id);
		if (routePage.url.searchParams.get(paramName) !== id) {
			void goto(resolve(`${basePath}?${paramName}=${encodeURIComponent(id)}`), { reset: false });
		}
	}

	function applyPageSelection(id: string) {
		currentPageId = id;
		selectedId = null;
		routeError = null;
	}

	// URL → state: browser Back/Forward (or a typed URL) changes `?page=`. Only the URL is
	// tracked so that adding pages or editing never resets the selection.
	$effect(() => {
		const urlPageId = routePage.url.searchParams.get(paramName);
		untrack(() => {
			const id = urlPageId ?? pages[0]?.id;
			if (id && id !== currentPageId && pages.some((item) => item.id === id)) {
				applyPageSelection(id);
			}
		});
	});

	/** Pages that links may point to (in composite mode these come from the stashed site pages). */
	const linkPages = $derived(composing ? stashedPages : pages);

	function resolveInternalPage(href: string) {
		const slug = href.slice(1).split(/[?#]/)[0];
		return slug === '' ? linkPages[0] : linkPages.find((page) => page.slug === slug);
	}

	function handleLinkClick(event: MouseEvent, block: BuilderBlock) {
		if (!isPreview || !block.href || !isValidLinkHref(block.href)) {
			event.preventDefault();
			return;
		}
		if (!block.href.startsWith('/')) return;

		event.preventDefault();
		const target = resolveInternalPage(block.href);
		if (target && !composing) selectPage(target.id);
		else routeError = `No page found at ${block.href}`;
	}

	/** Composites that may be placed on the open document (never itself or one that contains it). */
	const placeableComposites = $derived.by(() => {
		if (!composing) return composites;
		const open = currentPage.name;
		return composites.filter((item) => {
			if (item.name === open) return false;
			const trial = composites.map((c) =>
				c.name === open ? { ...c, blocks: [...c.blocks, { kind: compositeKind(item.name) }] } : c
			) as EditorComposite[];
			return !findCompositeCycle(trial);
		});
	});

	/** Creates a new empty composite (composite mode only) and opens it. */
	function addComposite() {
		const name = window.prompt('Name of the new composite component (e.g. PricingTable):')?.trim();
		if (!name) return;
		const problem = compositeNameProblem(name);
		if (problem) {
			routeError = problem;
			return;
		}
		const doc: EditorPage = {
			id: globalThis.crypto.randomUUID(),
			name,
			slug: name,
			width: 960,
			height: 360,
			blocks: []
		};
		pages.push(doc);
		markUnsaved();
		selectPage(doc.id);
	}

	/** Renames the open composite; instances elsewhere follow on the next save. */
	function renameComposite() {
		const name = window.prompt('New name:', currentPage.name)?.trim();
		if (!name || name === currentPage.name) return;
		const problem = compositeNameProblem(name, currentPage.id);
		if (problem) {
			routeError = problem;
			return;
		}
		const previous = compositeKind(currentPage.name);
		const next = compositeKind(name);
		for (const doc of pages)
			for (const block of doc.blocks) if (block.kind === previous) block.kind = next;
		for (const doc of stashedPages)
			for (const block of doc.blocks) if (block.kind === previous) block.kind = next;
		stashedPages = JSON.parse(JSON.stringify(stashedPages));
		currentPage.name = name;
		currentPage.slug = name;
		markUnsaved();
	}

	/** Deletes the open composite after confirmation; blocks that used it keep a placeholder. */
	function deleteComposite() {
		if (pages.length < 2) {
			routeError = 'Keep at least one composite, or create another first.';
			return;
		}
		if (
			!window.confirm(`Delete composite "${currentPage.name}"? Pages using it show a placeholder.`)
		)
			return;
		const index = pages.findIndex((doc) => doc.id === currentPageId);
		pages.splice(index, 1);
		selectPage(pages[Math.max(0, index - 1)].id);
		markUnsaved();
	}

	/** Why `name` cannot be used for a composite, or `null` when it is fine. */
	function compositeNameProblem(name: string, ignoreId?: string): string | null {
		if (!isValidCompositeKind(compositeKind(name))) {
			return 'Use a PascalCase name: letters and digits, starting with a capital letter.';
		}
		if (pages.some((doc) => doc.id !== ignoreId && doc.name === name)) {
			return `A composite named "${name}" already exists.`;
		}
		return null;
	}

	function duplicateSelected() {
		if (!selectedBlock) return;
		const source: BuilderBlock = $state.snapshot(selectedBlock);
		const copy: BuilderBlock = {
			...source,
			id: globalThis.crypto.randomUUID(),
			x: Math.min(blockLimits.maxX - source.width, source.x + 16),
			y: Math.min(blockLimits.maxY, source.y + 16)
		};
		blocks.push(copy);
		selectedId = copy.id;
		markUnsaved();
	}

	function reorderSelected(action: 'front' | 'back' | 'forward' | 'backward') {
		if (!selectedId) return;
		const index = blocks.findIndex((block) => block.id === selectedId);
		if (index < 0) return;
		const destination =
			action === 'front'
				? blocks.length - 1
				: action === 'back'
					? 0
					: Math.max(0, Math.min(blocks.length - 1, index + (action === 'forward' ? 1 : -1)));
		if (destination === index) return;
		const [block] = blocks.splice(index, 1);
		blocks.splice(destination, 0, block);
		markUnsaved();
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		const target = event.target;
		if (
			target instanceof HTMLElement &&
			(target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
		) {
			return;
		}

		const modifier = event.ctrlKey || event.metaKey;
		const key = event.key.toLowerCase();
		if (modifier && key === 'z') {
			event.preventDefault();
			if (event.shiftKey) redo();
			else undo();
		} else if (modifier && key === 'y') {
			event.preventDefault();
			redo();
		} else if (isPreview) {
			return;
		} else if (modifier && key === 'd') {
			event.preventDefault();
			duplicateSelected();
		} else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
			event.preventDefault();
			deleteSelected();
		}
	}

	function createBlock(kind: BlockKind): BuilderBlock {
		const base: BlockDefaults = (widgetDefaults as Record<string, BlockDefaults>)[kind] ?? {
			kind,
			title: kind.startsWith('custom:') ? kind.slice(7) : '',
			body: '',
			action: '',
			theme: 'light'
		};
		const catalogDefaults =
			kind in widgetCatalog ? widgetCatalog[kind as WidgetKind].defaults : undefined;
		// A composite instance starts at the composite's own size, scaled down to fit the canvas.
		const source = kind.startsWith('composite:')
			? composites.find((item) => compositeKind(item.name) === kind)
			: undefined;
		const fit = source ? Math.min(1, (currentPage.width - 48) / source.width) : 1;
		return {
			...base,
			id: globalThis.crypto.randomUUID(),
			positioned: true,
			x: 24,
			y: 24,
			width: source ? Math.round(source.width * fit) : (catalogDefaults?.width ?? 720),
			height: source ? Math.round(source.height * fit) : (catalogDefaults?.height ?? 240),
			value: kind === 'widget-select' ? widgetDefaults['widget-select'].action : '',
			checked: false,
			level: catalogDefaults?.level ?? 60,
			href: kind === 'widget-link' ? '/home' : '',
			newTab: false
		};
	}

	/**
	 * Begins a drag on a block: `move` (pointer down anywhere inside the selected block) or
	 * `resize` (pointer down on a frame handle; `dir` says which edges follow the pointer).
	 */
	function startPointerInteraction(
		event: PointerEvent,
		id: string,
		mode: 'move' | 'resize',
		dir: ResizeDir = 'se'
	) {
		if (isPreview || !canvasElement || event.button !== 0) return;
		const block = blocks.find((item) => item.id === id);
		if (!block || !(event.currentTarget instanceof HTMLElement)) return;

		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		selectedId = id;
		pointerInteraction = {
			id,
			pointerId: event.pointerId,
			mode,
			dir,
			startX: block.x,
			startY: block.y,
			startWidth: block.width,
			startHeight: block.height,
			pointerX: event.clientX,
			pointerY: event.clientY,
			scale: canvasElement.getBoundingClientRect().width / currentPage.width || 1
		};
	}

	function handlePointerMove(event: PointerEvent) {
		if (!pointerInteraction || event.pointerId !== pointerInteraction.pointerId) return;
		const block = blocks.find((item) => item.id === pointerInteraction?.id);
		if (!block) return;

		const deltaX = (event.clientX - pointerInteraction.pointerX) / pointerInteraction.scale;
		const deltaY = (event.clientY - pointerInteraction.pointerY) / pointerInteraction.scale;

		const snapOn = !event.altKey;

		if (pointerInteraction.mode === 'move') {
			block.x = Math.max(
				0,
				Math.min(blockLimits.maxX - block.width, snap(pointerInteraction.startX + deltaX, snapOn))
			);
			block.y = Math.max(
				0,
				Math.min(blockLimits.maxY, snap(pointerInteraction.startY + deltaY, snapOn))
			);
		} else {
			// Work with edges so the edge opposite the dragged handle stays fixed.
			const { dir, startX, startY, startWidth, startHeight } = pointerInteraction;
			let left = startX;
			let top = startY;
			let right = startX + startWidth;
			let bottom = startY + startHeight;

			if (dir.includes('w'))
				left = Math.max(
					Math.max(0, right - blockLimits.maxWidth),
					Math.min(right - blockLimits.minWidth, snap(startX + deltaX, snapOn))
				);
			if (dir.includes('e'))
				right = Math.max(
					left + blockLimits.minWidth,
					Math.min(
						Math.min(blockLimits.maxWidth, left + blockLimits.maxWidth),
						snap(startX + startWidth + deltaX, snapOn)
					)
				);
			if (dir.includes('n'))
				top = Math.max(
					Math.max(0, bottom - blockLimits.maxHeight),
					Math.min(bottom - blockLimits.minHeight, snap(startY + deltaY, snapOn))
				);
			if (dir.includes('s'))
				bottom = Math.max(
					top + blockLimits.minHeight,
					Math.min(top + blockLimits.maxHeight, snap(startY + startHeight + deltaY, snapOn))
				);

			block.x = left;
			block.y = top;
			block.width = right - left;
			block.height = bottom - top;
		}

		markUnsaved();
	}

	function updateSelectedPosition(field: 'x' | 'y' | 'width' | 'height') {
		if (!selectedBlock) return;

		if (field === 'x')
			selectedBlock.x = Math.round(
				Math.max(0, Math.min(blockLimits.maxX - selectedBlock.width, selectedBlock.x))
			);
		if (field === 'y')
			selectedBlock.y = Math.round(Math.max(0, Math.min(blockLimits.maxY, selectedBlock.y)));
		if (field === 'width')
			selectedBlock.width = Math.round(
				Math.max(
					blockLimits.minWidth,
					Math.min(blockLimits.maxWidth - selectedBlock.x, selectedBlock.width)
				)
			);
		if (field === 'height')
			selectedBlock.height = Math.round(
				Math.max(blockLimits.minHeight, Math.min(blockLimits.maxHeight, selectedBlock.height))
			);

		markUnsaved();
	}

	function attachCanvas(element: HTMLDivElement) {
		canvasElement = element;
		return () => {
			if (canvasElement === element) canvasElement = null;
		};
	}

	function stopPointerInteraction(event: PointerEvent) {
		if (pointerInteraction?.pointerId === event.pointerId) pointerInteraction = null;
	}

	function handlePositionKeydown(event: KeyboardEvent, mode: 'move' | 'resize') {
		if (!selectedBlock) return;
		const amount = event.shiftKey ? 10 : 1;
		let handled = true;

		if (mode === 'move') {
			if (event.key === 'ArrowLeft') selectedBlock.x = Math.max(0, selectedBlock.x - amount);
			else if (event.key === 'ArrowRight')
				selectedBlock.x = Math.min(
					blockLimits.maxX - selectedBlock.width,
					selectedBlock.x + amount
				);
			else if (event.key === 'ArrowUp') selectedBlock.y = Math.max(0, selectedBlock.y - amount);
			else if (event.key === 'ArrowDown')
				selectedBlock.y = Math.min(blockLimits.maxY, selectedBlock.y + amount);
			else handled = false;
		} else {
			if (event.key === 'ArrowLeft')
				selectedBlock.width = Math.max(blockLimits.minWidth, selectedBlock.width - amount);
			else if (event.key === 'ArrowRight')
				selectedBlock.width = Math.min(
					blockLimits.maxWidth - selectedBlock.x,
					selectedBlock.width + amount
				);
			else if (event.key === 'ArrowUp')
				selectedBlock.height = Math.max(blockLimits.minHeight, selectedBlock.height - amount);
			else if (event.key === 'ArrowDown')
				selectedBlock.height = Math.min(blockLimits.maxHeight, selectedBlock.height + amount);
			else handled = false;
		}

		if (handled) {
			event.preventDefault();
			markUnsaved();
		}
	}

	function addBlock(kind: BlockKind, clientX: number, clientY: number) {
		if (!canvasElement) return;
		const bounds = canvasElement.getBoundingClientRect();
		const block = createBlock(kind);
		// Pointer position → canvas pixels (the rendered canvas may be scaled).
		const scale = bounds.width / currentPage.width || 1;
		const pointerX = (clientX - bounds.left) / scale;
		const pointerY = (clientY - bounds.top) / scale;
		block.x = Math.round(
			Math.max(0, Math.min(blockLimits.maxX - block.width, pointerX - block.width / 2))
		);
		block.y = Math.round(Math.max(0, Math.min(blockLimits.maxY, pointerY - block.height / 2)));
		blocks.push(block);
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

	/**
	 * Whether a dragged kind may be placed. `componentInfo` is a Proxy that answers for any name, so
	 * `Object.hasOwn` on it only sees widgets; check each kind family explicitly instead.
	 */
	function isKnownKind(kind: string): kind is BlockKind {
		if (Object.hasOwn(widgetCatalog, kind)) return true;
		if (kind.startsWith('composite:')) {
			return composites.some((item) => compositeKind(item.name) === kind);
		}
		return kind.startsWith('custom:') && (customKinds as string[]).includes(kind);
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
				isKnownKind(payload.kind)
			) {
				return { source: 'palette', kind: payload.kind };
			}
		} catch {
			return null;
		}

		return null;
	}

	function handleCanvasDragOver(event: DragEvent) {
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		const payload = readPayload(event);
		if (payload?.source === 'palette') addBlock(payload.kind, event.clientX, event.clientY);
	}

	function deleteSelected() {
		if (!selectedId) return;
		const index = blocks.findIndex((block) => block.id === selectedId);
		currentPage.blocks = currentPage.blocks.filter((block) => block.id !== selectedId);
		selectedId = blocks[Math.min(index, blocks.length - 1)]?.id ?? null;
		markUnsaved();
	}

	function clearPage() {
		currentPage.blocks = [];
		selectedId = null;
		markUnsaved();
	}
</script>

<svelte:window
	onkeydown={handleWindowKeydown}
	onpointermove={handlePointerMove}
	onpointerup={stopPointerInteraction}
	onpointercancel={stopPointerInteraction}
/>

<svelte:head>
	<title>Page editor</title>
	<meta name="description" content="Design a page by arranging and customizing components." />
</svelte:head>

<div class="editor-shell">
	<BuilderHeader
		status={databaseStatus}
		busy={databaseBusy}
		unsaved={hasUnsavedChanges}
		canSave={hasUnsavedChanges || !databaseReady}
		{readOnlyNotice}
		previewing={isPreview}
		onsave={savePageToDatabase}
		{canUndo}
		{canRedo}
		onundo={undo}
		onredo={redo}
		onpreview={() => (isPreview = !isPreview)}
	/>

	<div class="workspace" class:preview-mode={isPreview}>
		{#if !isPreview}
			<aside class="palette-panel" aria-label="Component palette">
				<div class="panel-heading">
					<div>
						<p class="eyebrow">{composing ? 'BUILD A COMPOSITE' : 'BUILD YOUR PAGE'}</p>
						<h2>
							{paletteTab === 'composites'
								? 'Composite Components'
								: paletteTab === 'widgets'
									? 'Flowbite widgets'
									: 'Imported components'}
						</h2>
					</div>
					<span class="count-pill">
						{paletteTab === 'composites'
							? placeableComposites.length
							: paletteTab === 'widgets'
								? visibleWidgetCount
								: customKinds.length}
					</span>
				</div>
				<div class="palette-tabs" role="tablist" aria-label="Palette categories">
					<button
						type="button"
						id="composites-tab"
						role="tab"
						aria-selected={paletteTab === 'composites'}
						aria-controls="palette-items"
						class:tab-active={paletteTab === 'composites'}
						onclick={() => (paletteTab = 'composites')}
					>
						Composites
					</button>
					<button
						type="button"
						id="widgets-tab"
						role="tab"
						aria-selected={paletteTab === 'widgets'}
						aria-controls="palette-items"
						class:tab-active={paletteTab === 'widgets'}
						onclick={() => (paletteTab = 'widgets')}
					>
						Widgets
					</button>
					{#if customKinds.length > 0}
						<button
							type="button"
							id="custom-tab"
							role="tab"
							aria-selected={paletteTab === 'custom'}
							aria-controls="palette-items"
							class:tab-active={paletteTab === 'custom'}
							onclick={() => (paletteTab = 'custom')}
						>
							Custom
						</button>
					{/if}
				</div>
				<p class="panel-hint">
					{paletteTab === 'composites'
						? `Drag a composite component onto your ${docLabel} to place it.`
						: `Drag a component onto your ${docLabel} to place it.`}
				</p>

				{#if paletteTab === 'widgets'}
					<div class="widget-filter">
						<input
							class="field-control"
							type="search"
							placeholder="Search Flowbite widgets…"
							aria-label="Search widgets"
							bind:value={widgetQuery}
						/>
						<div class="widget-chips" role="group" aria-label="Widget categories">
							{#each ['All', ...widgetCategories] as category (category)}
								<button
									type="button"
									class:tab-active={widgetCategory === category}
									aria-pressed={widgetCategory === category}
									onclick={() => (widgetCategory = category as 'All' | WidgetCategory)}
								>
									{category}
								</button>
							{/each}
						</div>
					</div>
				{/if}

				<div id="palette-items" role="tabpanel" aria-labelledby="{paletteTab}-tab">
					{#if paletteTab === 'widgets'}
						{#each widgetGroups as group (group.category)}
							<h3 class="widget-group-title">{group.category}</h3>
							<div class="component-list" role="list" aria-label="{group.category} widgets">
								{#each group.kinds as kind (kind)}
									<div
										class="palette-item widget-item"
										draggable="true"
										role="listitem"
										aria-label="Drag {componentInfo[kind].label} onto the page"
										ondragstart={(event) => handlePaletteDragStart(event, kind)}
									>
										<span class="component-mark" aria-hidden="true">{componentInfo[kind].mark}</span
										>
										<span class="component-copy">
											<strong>{componentInfo[kind].label}</strong>
											<small>{componentInfo[kind].detail}</small>
										</span>
									</div>
								{/each}
							</div>
						{:else}
							<p class="panel-hint">No widget matches “{widgetQuery}”.</p>
						{/each}
					{:else}
						<div class="component-list" role="list" aria-label="Draggable components">
							{#each paletteTab === 'composites' ? placeableComposites.map( (item) => compositeKind(item.name) ) : customKinds as kind (kind)}
								<div
									class="palette-item"
									draggable="true"
									role="listitem"
									aria-label="Drag {componentInfo[kind].label} onto the page"
									ondragstart={(event) => handlePaletteDragStart(event, kind)}
								>
									<span class="component-mark" aria-hidden="true">{componentInfo[kind].mark}</span>
									<span class="component-copy">
										<strong>{componentInfo[kind].label}</strong>
										<small>{componentInfo[kind].detail}</small>
									</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				<div class="palette-tip">
					<span aria-hidden="true">✦</span>
					<p>
						<strong>Drag to place</strong> — select any block on the canvas to edit its content and style.
					</p>
				</div>
			</aside>
		{/if}

		<section class="canvas-panel" aria-label="{composing ? 'Composite' : 'Page'} canvas">
			<div class="canvas-toolbar">
				<div class="canvas-label">
					<span class="live-dot" aria-hidden="true"></span>
					<span>{isPreview ? 'Live preview' : composing ? 'Composite canvas' : 'Page canvas'}</span>
					<label class="page-switch">
						<span class="sr-only">{composing ? 'Composite' : 'Page'}</span>
						<select
							value={currentPage.id}
							onchange={(event) => selectPage(event.currentTarget.value)}
						>
							{#each pages as page (page.id)}
								<option value={page.id}
									>{composing ? page.name : `${page.name} · /${page.slug}`}</option
								>
							{/each}
						</select>
					</label>
					{#if routeError}<span class="route-error" role="alert">{routeError}</span>{/if}
				</div>
				{#if !isPreview}
					<div class="canvas-actions">
						<span>{blockCount} {blockCount === 1 ? 'item' : 'items'}</span>
						{#if composing}
							<label class="size-field">
								Width
								<input
									type="number"
									min={compositeLimits.minWidth}
									max={compositeLimits.maxWidth}
									bind:value={currentPage.width}
									oninput={markUnsaved}
								/>
							</label>
							<label class="size-field">
								Height
								<input
									type="number"
									min={compositeLimits.minHeight}
									max={compositeLimits.maxHeight}
									bind:value={currentPage.height}
									oninput={markUnsaved}
								/>
							</label>
							<button type="button" class="text-button" onclick={addComposite}>New</button>
							<button type="button" class="text-button" onclick={renameComposite}>Rename</button>
							<button type="button" class="text-button" onclick={deleteComposite}>Delete</button>
						{/if}
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
				<ThemeScope theme={routePage.data.siteTheme}>
					<div
						class="page-canvas"
						class:preview={isPreview}
						style:width="{currentPage.width}px"
						style:min-height="{canvasHeight}px"
						role="region"
						aria-label="Page canvas drop zone"
						{@attach attachCanvas}
						ondragover={handleCanvasDragOver}
						ondrop={handleDrop}
					>
						{#if blocks.length === 0}
							<div class="empty-canvas">
								<div class="empty-icon" aria-hidden="true">✳</div>
								<h2>{composing ? 'Your composite starts here' : 'Your page starts here'}</h2>
								<p>
									Drag widgets from the panel onto the canvas to start building something great.
								</p>
							</div>
						{:else}
							{#each blocks as block, index (block.id)}
								<article
									class="canvas-block positioned {block.kind} theme-{block.theme}"
									class:selected={!isPreview && selectedId === block.id}
									style:left="{block.x}px"
									style:top="{block.y}px"
									style:width="{block.width}px"
									style:height="{block.height}px"
								>
									<BlockContent
										bind:block={blocks[index]}
										onchange={markUnsaved}
										onlink={handleLinkClick}
									/>
									{#if !isPreview}
										<span class="block-type-tag">{componentInfo[block.kind].label}</span>
										<button
											type="button"
											class="selection-overlay"
											class:movable={selectedId === block.id}
											aria-label="Select {componentInfo[block.kind].label}: {block.title}"
											aria-pressed={selectedId === block.id}
											onclick={() => (selectedId = block.id)}
											onpointerdown={(event) => startPointerInteraction(event, block.id, 'move')}
											onkeydown={(event) => {
												if (event.key.startsWith('Arrow')) {
													selectedId = block.id;
													handlePositionKeydown(event, event.altKey ? 'resize' : 'move');
												}
											}}
										></button>
										{#if selectedId === block.id}
											<div class="selection-frame" aria-hidden="true">
												{#each resizeHandles as dir (dir)}
													<!-- Pointer-only affordance; keyboard resizing is Alt+arrows on the overlay button. -->
													<!-- svelte-ignore a11y_no_static_element_interactions -->
													<span
														class="frame-handle handle-{dir}"
														onpointerdown={(event) =>
															startPointerInteraction(event, block.id, 'resize', dir)}
													></span>
												{/each}
											</div>
										{/if}
									{/if}
								</article>
							{/each}
						{/if}
					</div>
				</ThemeScope>
			</div>
			{#if !isPreview}
				<p class="canvas-footnote">
					<span aria-hidden="true">⌘</span> Drag components from the palette to place them
					<span class="footnote-divider">·</span> Drag a selected component to move it · drag its
					corners to resize · hold Alt to bypass the {SNAP_GRID}px grid
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
								aria-label="Duplicate selected block"
								title="Duplicate (Ctrl+D)"
								onclick={duplicateSelected}
							>
								<svg viewBox="0 0 20 20" aria-hidden="true"
									><rect x="7" y="7" width="9" height="9" rx="1.5" /><path
										d="M13 7V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v6.5A1.5 1.5 0 0 0 5 13h2"
									/></svg
								>
							</button>
							<button
								class="icon-button delete-button"
								type="button"
								aria-label="Delete selected block"
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
							<div><strong>{selectedLabel}</strong><small>Selected block</small></div>
						</div>
						{#if selectedBlock.kind.startsWith('composite:')}
							{@const target = composites.find(
								(item) => compositeKind(item.name) === selectedBlock?.kind
							)}
							{#if target}
								<a
									class="text-button edit-composite"
									href={resolve(`/composites?composite=${encodeURIComponent(target.id)}`)}
									>Edit composite “{target.name}”</a
								>
							{/if}
						{/if}
						<span class="field-label">Layer</span>
						<div class="layer-buttons">
							<button type="button" onclick={() => reorderSelected('back')}>To back</button>
							<button type="button" onclick={() => reorderSelected('backward')}>Backward</button>
							<button type="button" onclick={() => reorderSelected('forward')}>Forward</button>
							<button type="button" onclick={() => reorderSelected('front')}>To front</button>
						</div>
						<span class="field-label">Fixed position</span>
						<p class="position-hint">Drag the move handle or adjust these values.</p>
						<div class="position-fields">
							<div>
								<label class="field-label" for="block-x">Left (px)</label>
								<input
									id="block-x"
									class="field-control"
									type="number"
									min="0"
									max={blockLimits.maxX - selectedBlock.width}
									step="1"
									bind:value={selectedBlock.x}
									oninput={() => updateSelectedPosition('x')}
								/>
							</div>
							<div>
								<label class="field-label" for="block-y">Top (px)</label>
								<input
									id="block-y"
									class="field-control"
									type="number"
									min="0"
									max={blockLimits.maxY}
									step="1"
									bind:value={selectedBlock.y}
									oninput={() => updateSelectedPosition('y')}
								/>
							</div>
							<div>
								<label class="field-label" for="block-width">Width (px)</label>
								<input
									id="block-width"
									class="field-control"
									type="number"
									min={blockLimits.minWidth}
									max={blockLimits.maxWidth - selectedBlock.x}
									step="1"
									bind:value={selectedBlock.width}
									oninput={() => updateSelectedPosition('width')}
								/>
							</div>
							<div>
								<label class="field-label" for="block-height">Height (px)</label>
								<input
									id="block-height"
									class="field-control"
									type="number"
									min={blockLimits.minHeight}
									max={blockLimits.maxHeight}
									step="1"
									bind:value={selectedBlock.height}
									oninput={() => updateSelectedPosition('height')}
								/>
							</div>
						</div>
						<label class="field-label" for="block-title">
							{selectedBlock.kind.startsWith('widget-') ? 'Label / text' : 'Heading'}
						</label>
						<input
							id="block-title"
							class="field-control"
							bind:value={selectedBlock.title}
							maxlength="100"
							oninput={markUnsaved}
						/>
						<label class="field-label" for="block-body">
							{selectedBlock.kind.startsWith('widget-') ? 'Helper text' : 'Description'}
						</label>
						<textarea
							id="block-body"
							class="field-control field-textarea"
							bind:value={selectedBlock.body}
							rows="4"
							maxlength="240"
							oninput={markUnsaved}></textarea>
						{#if selectedBlock.kind.startsWith('custom:')}
							<label class="field-label" for="custom-title">Title / Heading</label>
							<input
								id="custom-title"
								class="field-control"
								bind:value={selectedBlock.title}
								oninput={markUnsaved}
							/>
							<label class="field-label" for="custom-body">Description</label>
							<textarea
								id="custom-body"
								class="field-control field-textarea"
								bind:value={selectedBlock.body}
								oninput={markUnsaved}></textarea>
							{#if selectedBlock.customProps && Object.keys(selectedBlock.customProps).length > 0}
								<span class="field-label">Component Props</span>
								{#each Object.entries(selectedBlock.customProps) as [propKey, propVal] (propKey)}
									{#if typeof propVal === 'boolean'}
										<label class="widget-state-control">
											<input
												type="checkbox"
												checked={Boolean(selectedBlock.customProps[propKey])}
												onchange={(e) => {
													selectedBlock.customProps![propKey] = e.currentTarget.checked;
													markUnsaved();
												}}
											/>
											<span>{propKey}</span>
										</label>
									{:else if typeof propVal === 'number'}
										<label class="field-label" for="prop-{propKey}">{propKey}</label>
										<input
											id="prop-{propKey}"
											class="field-control"
											type="number"
											value={Number(selectedBlock.customProps[propKey])}
											oninput={(e) => {
												selectedBlock.customProps![propKey] = Number(e.currentTarget.value);
												markUnsaved();
											}}
										/>
									{:else}
										<label class="field-label" for="prop-{propKey}">{propKey}</label>
										<input
											id="prop-{propKey}"
											class="field-control"
											value={String(selectedBlock.customProps[propKey])}
											oninput={(e) => {
												selectedBlock.customProps![propKey] = e.currentTarget.value;
												markUnsaved();
											}}
										/>
									{/if}
								{/each}
							{/if}
						{/if}

						{#if selectedBlock.kind === 'widget-link'}
							<label class="field-label" for="link-href">Link address</label>
							<input
								id="link-href"
								class="field-control"
								list="page-routes"
								maxlength="200"
								placeholder="/page or https://…"
								bind:value={selectedBlock.href}
								oninput={markUnsaved}
							/>
							<datalist id="page-routes">
								{#each linkPages as page (page.id)}<option value="/{page.slug}">{page.name}</option
									>{/each}
							</datalist>
							{#if !isValidLinkHref(selectedBlock.href)}
								<p class="route-error" role="alert">Use /page-route or an http(s) address.</p>
							{/if}
							<label class="check-row">
								<input type="checkbox" bind:checked={selectedBlock.newTab} onchange={markUnsaved} />
								Open external links in a new tab
							</label>
						{/if}
						{#if ['widget-button', 'widget-text-field', 'widget-textarea', 'widget-card', ...actionWidgetKinds].includes(selectedBlock.kind)}
							<label class="field-label" for="block-action">
								{['widget-text-field', 'widget-textarea'].includes(selectedBlock.kind)
									? 'Placeholder'
									: 'Button label'}
							</label>
							<input
								id="block-action"
								class="field-control"
								bind:value={selectedBlock.action}
								maxlength="48"
								oninput={markUnsaved}
							/>
						{/if}
						{#if selectedBlock.kind === 'widget-select'}
							<label class="field-label" for="block-select-value">Selected option</label>
							<select
								id="block-select-value"
								class="field-control"
								bind:value={selectedBlock.value}
								onchange={markUnsaved}
							>
								<option value="">Choose an option</option>
								{#each (selectedBlock.items || widgetCatalog['widget-select'].defaults.items || '')
									.split('\n')
									.map((line) => line.trim())
									.filter(Boolean) as option (option)}
									<option value={option}>{option}</option>
								{/each}
							</select>
						{/if}
						{#if ['widget-checkbox', 'widget-radio', 'widget-switch'].includes(selectedBlock.kind)}
							<label class="widget-state-control">
								<input
									type="checkbox"
									bind:checked={selectedBlock.checked}
									onchange={markUnsaved}
								/>
								<span>Initially selected</span>
							</label>
						{/if}
						{#if selectedBlock.kind in itemsHelp}
							<label class="field-label" for="block-items">Entries</label>
							<textarea
								id="block-items"
								class="field-control field-textarea"
								bind:value={selectedBlock.items}
								rows="6"
								maxlength="600"
								oninput={markUnsaved}></textarea>
							<p class="panel-hint">{itemsHelp[selectedBlock.kind]}</p>
						{/if}
						{#if ['widget-slider', 'widget-progress'].includes(selectedBlock.kind)}
							<label class="field-label" for="block-level">Value ({selectedBlock.level}%)</label>
							<input
								id="block-level"
								class="field-control"
								type="range"
								min="0"
								max="100"
								bind:value={selectedBlock.level}
								oninput={markUnsaved}
							/>
						{/if}

						<div class="field-divider"></div>
						<span class="field-label">Theme</span>
						<div class="theme-options" role="group" aria-label="Theme">
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
						<p>Select a block on your canvas to edit its content and style.</p>
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

	.canvas-label,
	.canvas-actions {
		display: flex;
		align-items: center;
	}

	h2,
	h3,
	p {
		margin-top: 0;
	}

	.live-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #69c89d;
	}

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

	.icon-button svg {
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.5;
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
		display: flex;
		height: 100%;
		min-height: 0;
		flex-direction: column;
		overflow-y: auto;
		padding: 1.5rem 1.1rem;
		border-right: 1px solid var(--line);
	}

	.widget-filter {
		display: grid;
		gap: 0.5rem;
		margin-bottom: 0.6rem;
	}

	.widget-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.widget-chips button {
		padding: 0.2rem 0.55rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: #fff;
		color: #5d5f78;
		font-size: 0.68rem;
		cursor: pointer;
	}

	.widget-chips button.tab-active {
		border-color: #6554d8;
		background: #eeeaff;
		color: #4b3fc0;
	}

	.widget-group-title {
		margin: 0.8rem 0 0.4rem;
		color: #85869a;
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
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

	#palette-items {
		display: flex;
		min-height: 0;
		flex: 1 1 0;
		flex-direction: column;
	}

	.palette-tabs {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.2rem;
		padding: 0.22rem;
		border: 1px solid #e8e7ef;
		border-radius: 9px;
		background: #f8f8fb;
	}

	.palette-tabs button {
		min-height: 32px;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: #77798c;
		font-size: 0.69rem;
		font-weight: 600;
		cursor: pointer;
	}

	.palette-tabs button.tab-active {
		background: #fff;
		color: #6253ca;
		box-shadow: 0 1px 4px rgb(34 34 56 / 0.12);
	}

	.palette-tabs button:focus-visible,
	.inspector-actions button:focus-visible {
		outline: 2px solid #8d7cff;
		outline-offset: 2px;
	}

	.component-list {
		display: grid;
		min-height: 0;
		flex: 1 1 0;
		align-content: start;
		gap: 0.5rem;
		overflow-y: auto;
		padding-right: 0.15rem;
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

	.palette-item.widget-item:nth-child(3n + 1) .component-mark {
		background: #eaf5f3;
		color: #419a87;
	}

	.palette-item.widget-item:nth-child(3n + 2) .component-mark {
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

	.palette-tip {
		display: flex;
		gap: 0.55rem;
		margin-top: auto;
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
		background: var(--site-bg, #fff);
		color: var(--site-fg, inherit);
		box-shadow: 0 8px 26px rgb(34 34 56 / 0.09);
		transition: max-width 200ms ease;
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

	.canvas-block.positioned {
		position: absolute;
		z-index: 1;
		min-height: 0;
		box-sizing: border-box;
		border-radius: 8px;
		box-shadow: 0 5px 18px rgb(34 34 56 / 0.12);
	}

	/* Widgets sit directly on the themed page; only composites and imported components get a card look. */
	.canvas-block.positioned[class*='widget-'] {
		border-radius: 0;
		background: transparent;
		box-shadow: none;
	}

	.canvas-block + .canvas-block {
		border-top: 1px solid #f0eff3;
	}

	.canvas-block.positioned + .canvas-block.positioned {
		border-top: 0;
	}

	.canvas-block:hover,
	.canvas-block.selected {
		z-index: 1;
		box-shadow: inset 0 0 0 2px #8d7cff;
	}

	.canvas-block.positioned.selected {
		z-index: 2;
		box-shadow:
			inset 0 0 0 2px #8d7cff,
			0 5px 18px rgb(34 34 56 / 0.12);
	}

	.selection-overlay:focus-visible {
		z-index: 2;
		outline: 3px solid #8d7cff;
		outline-offset: -3px;
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

	.selection-overlay.movable {
		cursor: move;
		touch-action: none;
	}

	.selection-frame {
		position: absolute;
		inset: 0;
		z-index: 4;
		border: 2px solid #6558cb;
		pointer-events: none;
	}

	.frame-handle {
		position: absolute;
		width: 12px;
		height: 12px;
		box-sizing: border-box;
		border: 2px solid #6558cb;
		border-radius: 3px;
		background: #fff;
		pointer-events: auto;
		touch-action: none;
	}

	.handle-nw {
		top: 0;
		left: 0;
		cursor: nwse-resize;
	}
	.handle-n {
		top: 0;
		left: 50%;
		margin-left: -6px;
		cursor: ns-resize;
	}
	.handle-ne {
		top: 0;
		right: 0;
		cursor: nesw-resize;
	}
	.handle-e {
		top: 50%;
		right: 0;
		margin-top: -6px;
		cursor: ew-resize;
	}
	.handle-se {
		right: 0;
		bottom: 0;
		cursor: nwse-resize;
	}
	.handle-s {
		bottom: 0;
		left: 50%;
		margin-left: -6px;
		cursor: ns-resize;
	}
	.handle-sw {
		bottom: 0;
		left: 0;
		cursor: nesw-resize;
	}
	.handle-w {
		top: 50%;
		left: 0;
		margin-top: -6px;
		cursor: ew-resize;
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

	.position-hint {
		margin: 0.55rem 0 0.2rem;
		color: var(--muted);
		font-size: 0.62rem;
		line-height: 1.5;
	}

	.position-fields {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.15rem 0.6rem;
	}

	.widget-state-control {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.85rem;
		color: #686a80;
		font-size: 0.67rem;
		font-weight: 650;
	}

	.widget-state-control input {
		accent-color: #6b5ce7;
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

		.workspace {
			grid-template-columns: minmax(0, 1fr);
		}

		.palette-panel {
			display: block;
			padding: 1rem;
			border-right: 0;
			border-bottom: 1px solid var(--line);
		}

		.component-list {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			max-height: min(58vh, 620px);
			overflow-y: auto;
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

	.route-error {
		color: #b3261e;
		font-size: 0.75rem;
	}

	.page-switch select {
		max-width: 16rem;
		padding: 0.2rem 0.4rem;
		border: 1px solid #d8d4cc;
		border-radius: 6px;
		background: #fff;
		font: inherit;
		font-size: 0.8rem;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.layer-buttons {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
	}

	.layer-buttons button {
		flex: 1;
		padding: 0.35rem 0.5rem;
		border: 1px solid #d8d4cc;
		border-radius: 6px;
		background: #fff;
		font: inherit;
		font-size: 0.75rem;
		cursor: pointer;
	}

	.check-row {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		font-size: 0.8rem;
		margin-top: 0.5rem;
	}

	.page-canvas {
		flex: 0 0 auto;
		margin-inline: auto;
		max-width: none;
	}

	.canvas-stage {
		justify-content: flex-start;
	}

	.size-field {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.78rem;
	}

	.size-field input {
		width: 4.5rem;
		padding: 0.2rem 0.35rem;
		border: 1px solid #d9d4ec;
		border-radius: 6px;
	}

	.edit-composite {
		display: inline-block;
		margin-bottom: 0.75rem;
	}
</style>
