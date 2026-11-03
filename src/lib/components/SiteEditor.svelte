<script lang="ts">
	/**
	 * @fileoverview Visual Drag-and-Drop canvas editor shared by `/editor` (pages) and
	 * `/composites` (Composite Components).
	 *
	 * The `mode` prop selects the domain documents edited by the shared canvas: site pages or
	 * reusable Composite Components. Their persisted shapes remain distinct; `editor-mode.ts`
	 * selects the active collection and merges it back with the untouched collection on save.
	 * Canvas interaction, history and inspector behavior are shared. Composites render through
	 * `provideComposites` (see `composite-context.ts`); placing a composite inside another is
	 * cycle-checked here and on the server.
	 *
	 * The editor always works on the **active project** (`/editor/api`, see `server/project-store.ts`).
	 * A fresh project has neither pages nor composites: `hasDocuments` is then `false` and an empty
	 * state ("Add first page", "New composite…", "Add starter composites") replaces the workspace.
	 * Switching the project (navigation chip) reloads the site. Only the widgets are always available.
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
	 *    - Right-click menus (`editor-menus.ts`): block (edit composite, duplicate, order, delete),
	 *      canvas / toolbar (undo, save, preview, composite New / Rename / Delete, clear) and
	 *      palette item (add without dragging, edit composite).
	 *    - Mode-specific document switching and route jump support in Preview mode.
	 * 3. History & State Management:
	 *    - Debounced snapshot-based Undo/Redo stack with keyboard shortcuts (Ctrl+Z, Ctrl+Shift+Z/Y).
	 *    - Duplicate (Ctrl+D) and Delete (Delete/Backspace) keyboard commands.
	 * 4. Inspector (UI extracted to `BlockInspector.svelte`; this component only supplies the
	 *    selected block and callbacks for dirty marking, geometry clamping, layer order,
	 *    duplicate and delete, and keeps history/navigation/persistence):
	 *    - Geometry controls (X, Y, Width, Height — all px), edge/fill docking, and layer ordering.
	 *    - Content controls limited to the fields each kind supports (`inspector-fields.ts`),
	 *      including the Link Navigation group of link, button and card widgets.
	 *    - Preview-mode link clicks (`handleLinkClick`) are routed here for in-app navigation.
	 * 5. Database Integration:
	 *    - Seamless load and save of `EditorSite` models with `/editor/api`.
	 */

	/**
	 * @component SiteEditor
	 * @prop {'pages' | 'composites'} [mode='pages'] - Which domain collection the shared canvas
	 *   edits. Fixed for the component lifetime; routes mount one editor per mode.
	 */
	import { onMount } from 'svelte';
	import { page as routePage } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import BlockInspector from './BlockInspector.svelte';
	import { untrack } from 'svelte';
	import BlockContent from './BlockContent.svelte';
	import ThemeScope from './editor/ThemeScope.svelte';
	import BuilderHeader from './BuilderHeader.svelte';
	import { useNavContext } from '../navigation.svelte.js';
	import { useContextMenu } from '../context-menu.svelte.js';
	import { blockMenu, canvasMenu, paletteItemMenu } from '../editor-menus.js';
	import { provideComposites } from '../composite-context.js';
	import { seedComposites } from '../composite-seeds.js';
	import {
		blockLimits,
		compositeLimits,
		defaultCanvasSize,
		isValidLinkHref,
		type BuilderBlock,
		type AlignTo,
		type BlockKind,
		type EditorPage,
		type EditorSite,
		type EditorComposite,
		compositeKind,
		isValidCompositeKind,
		findCompositeCycle,
		type WidgetKind
	} from '../editor.js';
	import { resolveBlockLayout } from '../block-layout.js';
	import {
		filterWidgets,
		widgetCatalog,
		widgetCategories,
		type WidgetCategory
	} from '../widget-catalog.js';
	import {
		editorDocumentLabel,
		editorDocumentsForMode,
		isEditorPage,
		linkPagesForMode,
		mergeEditorDocuments,
		type EditorDocument,
		type EditorMode
	} from '../editor-mode.js';

	/** Compass direction of the selection-frame handle being dragged (corners and edges). */
	type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
	type DragPayload = { source: 'palette'; kind: BlockKind };
	type EditorApiResponse = {
		project?: { id: string; name: string } | null;
		site?: EditorSite;
		success?: boolean;
		error?: string;
	};
	type PaletteTab = 'composites' | 'widgets' | 'custom';

	/** `pages`: edits site pages. `composites`: edits composite components on the same canvas. */
	let { mode = 'pages' }: { mode?: EditorMode } = $props();
	const editorMode = untrack(() => mode);
	const composing = editorMode === 'composites';
	/** Route that hosts this editor and the query parameter selecting the open document. */
	const basePath = composing ? '/composites' : '/editor';
	const paramName = composing ? 'composite' : 'page';
	const docLabel = composing ? 'composite' : 'page';

	// Flowbite widget palette data (label, category, defaults) lives in the shared catalog.
	const widgetInfo: Record<WidgetKind, { label: string; detail: string; mark: string }> =
		widgetCatalog;
	const widgetKinds = Object.keys(widgetInfo) as WidgetKind[];
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

	/**
	 * The active documents keep their domain shapes: pages retain their slug and composites have
	 * none. The untouched collection is stashed and merged back on save.
	 */
	const initialDocuments: EditorDocument[] = [];
	let documents = $state<EditorDocument[]>(initialDocuments);
	let stashedPages = $state.raw<EditorPage[]>([]);
	let stashedComposites = $state.raw<EditorComposite[]>([]);
	/** Composites that `composite:<Name>` blocks render from (live while editing one). */
	const composites = $derived(
		composing
			? documents.filter((document): document is EditorComposite => !isEditorPage(document))
			: stashedComposites
	);
	provideComposites(() => composites);

	let currentDocumentId = $state('');
	/**
	 * Stand-in while the active project has no page/composite yet. The workspace is not rendered in
	 * that state (see `hasDocuments`), so this object is only there to keep the derived values total.
	 */
	const emptyDocument: EditorPage = {
		id: '',
		name: '',
		slug: '',
		width: defaultCanvasSize.width,
		height: defaultCanvasSize.height,
		blocks: []
	};
	let currentDocument = $derived<EditorDocument>(
		documents.find((document) => document.id === currentDocumentId) ?? documents[0] ?? emptyDocument
	);
	/** `false` for a fresh project: the editor then shows its empty state instead of the canvas. */
	const hasDocuments = $derived(documents.length > 0);
	let blocks = $derived(currentDocument.blocks);
	/** Computed CSS-pixel positions, using the declared size of the active page or composite. */
	const blockLayout = $derived(
		resolveBlockLayout(blocks, currentDocument.width, currentDocument.height)
	);
	let selectedId = $state<string | null>(null);
	let paletteTab = $state<PaletteTab>('widgets');
	let isPreview = $state(false);
	/** The active project (`null` while the user has none); saving needs one. */
	let project = $state<{ id: string; name: string } | null>(null);
	let databaseBusy = $state(true);
	let databaseStatus = $state('Loading project…');
	/**
	 * Set for `guest` users, who may view but not change the site (the server rejects their writes
	 * as well; this only explains and disables the Save button). Read from the root layout data.
	 */
	const readOnlyNotice = $derived(
		routePage.data.user?.role === 'guest' ? 'Read-only: your role cannot save' : undefined
	);

	let hasUnsavedChanges = $state(false);
	const linkPages = $derived(linkPagesForMode(editorMode, documents, stashedPages));
	// Feeds the shared top navigation (page switcher, labels, unsaved-changes guard).
	useNavContext(() => ({
		pages: composing ? [] : linkPages,
		activePageId: composing ? null : currentDocumentId,
		unsavedChanges: hasUnsavedChanges
	}));
	let revision = $state(0);
	let routeError = $state<string | null>(null);
	let undoStack = $state.raw<string[]>([]);
	let redoStack = $state.raw<string[]>([]);
	let historyPending = $state(false);
	let historyTimer: ReturnType<typeof setTimeout> | undefined;
	let committedSnapshot = JSON.stringify(initialDocuments);
	let canvasElement: HTMLDivElement | null = null;
	/** Grid size in canvas pixels that moves and resizes snap to (hold Alt while dragging to bypass). */
	const SNAP_GRID = 8;
	const resizeHandles: ResizeDir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
	function resizeHandlesFor(block: BuilderBlock): ResizeDir[] {
		if (block.alignTo === 'left' || block.alignTo === 'right') return ['e', 'w'];
		if (block.alignTo === 'top' || block.alignTo === 'bottom') return ['n', 's'];
		if (block.alignTo === 'fill') return [];
		return resizeHandles;
	}
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
			documents.flatMap((document) =>
				document.blocks.map((block) => block.kind).filter((kind) => kind.startsWith('custom:'))
			)
		)
	]);
	let selectedBlock = $derived(blocks.find((block) => block.id === selectedId));
	const anotherBlockUsesFill = $derived(
		blocks.some((block) => block.id !== selectedId && block.alignTo === 'fill')
	);
	let blockCount = $derived(blocks.length);
	let canvasHeight = $derived(
		Math.max(
			currentDocument.height,
			...blocks.map((block) => {
				const geometry = blockLayout.get(block.id)!;
				return geometry.y + geometry.height + 40;
			})
		)
	);
	/** Width of the stage's content box; the preview scales the canvas down to fit it. */
	let stageWidth = $state(0);
	/** Preview-only fit factor (never above 1), matching `PageView`; editing stays 1:1. */
	const previewScale = $derived(
		isPreview && stageWidth > 0 ? Math.min(1, stageWidth / currentDocument.width) : 1
	);
	let selectedLabel = $derived(
		selectedBlock ? componentInfo[selectedBlock.kind].label : 'Nothing selected'
	);
	/** "Edit composite" shortcut for a selected composite instance (shown by the inspector). */
	const selectedComposite = $derived.by(() => {
		if (!selectedBlock?.kind.startsWith('composite:')) return undefined;
		const kind = selectedBlock.kind;
		const target = composites.find((item) => compositeKind(item.name) === kind);
		return target
			? {
					name: target.name,
					id: target.id
				}
			: undefined;
	});

	let canUndo = $derived(undoStack.length > 0 || historyPending);
	let canRedo = $derived(redoStack.length > 0);

	onMount(() => {
		void loadDatabaseState();
		return () => clearTimeout(historyTimer);
	});

	// Another project became active (project chip): load its site instead.
	let loadedProjectId = routePage.data.project?.id;
	$effect(() => {
		const id = routePage.data.project?.id;
		if (id === loadedProjectId) return;
		loadedProjectId = id;
		void loadDatabaseState();
	});

	async function requestApi(
		method: 'GET' | 'POST',
		payload?: { action: 'save'; site: EditorSite }
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
		project = result.project ?? null;
		const site = result.site ?? { pages: [], composites: [] };
		if (composing) {
			stashedPages = site.pages;
		} else {
			stashedComposites = site.composites;
		}
		documents = editorDocumentsForMode(editorMode, site);
		currentDocumentId =
			documents.find((item) => item.id === routePage.url.searchParams.get(paramName))?.id ??
			documents[0]?.id ??
			'';
		selectedId = currentDocument.blocks[0]?.id ?? null;
		resetHistory();
		hasUnsavedChanges = false;
		databaseStatus = !project
			? 'No project yet · create one on the Projects page'
			: documents.length === 0
				? `${project.name} · no ${docLabel}s yet`
				: `${project.name} · loaded from the database`;
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
		if (databaseBusy || readOnlyNotice || !project) return;

		if (
			documents.some((document) => document.blocks.some((block) => !isValidLinkHref(block.href)))
		) {
			databaseStatus = 'A link address is invalid. Use /page or https://…';
			return;
		}

		const savedRevision = revision;
		const edited = $state.snapshot(documents);
		const siteSnapshot = mergeEditorDocuments(editorMode, edited, stashedPages, stashedComposites);
		const cycle = findCompositeCycle(siteSnapshot.composites);
		if (cycle) {
			databaseStatus = `Composite "${cycle}" contains itself. Remove the loop to save.`;
			return;
		}
		databaseBusy = true;
		databaseStatus = 'Saving site to the database…';

		try {
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
		databaseStatus = 'Unsaved changes';
		historyPending = true;
		clearTimeout(historyTimer);
		historyTimer = setTimeout(commitHistory, 350);
	}

	function takeSnapshot() {
		return JSON.stringify($state.snapshot(documents));
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
		documents = JSON.parse(snapshot) as EditorDocument[];
		if (!documents.some((document) => document.id === currentDocumentId)) {
			currentDocumentId = documents[0]?.id ?? '';
		}
		if (!currentDocument.blocks.some((block) => block.id === selectedId)) selectedId = null;
		committedSnapshot = snapshot;
		revision += 1;
		hasUnsavedChanges = true;
		databaseStatus = 'Unsaved changes';
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
	 * Selects a document. Its mode-specific URL parameter is the source of truth for browser
	 * history; selection updates immediately while the URL effect handles Back/Forward changes.
	 */
	function selectDocument(id: string) {
		applyDocumentSelection(id);
		if (routePage.url.searchParams.get(paramName) !== id) {
			void goto(resolve(`${basePath}?${paramName}=${encodeURIComponent(id)}`), { reset: false });
		}
	}

	function applyDocumentSelection(id: string) {
		currentDocumentId = id;
		selectedId = null;
		routeError = null;
	}

	// URL → state: browser Back/Forward (or a typed URL) changes the selected document.
	$effect(() => {
		const urlPageId = routePage.url.searchParams.get(paramName);
		untrack(() => {
			const id = urlPageId ?? documents[0]?.id;
			if (id && id !== currentDocumentId && documents.some((item) => item.id === id)) {
				applyDocumentSelection(id);
			}
		});
	});

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
		if (target && !composing) selectDocument(target.id);
		else routeError = `No page found at ${block.href}`;
	}

	/** Composites that may be placed on the open document (never itself or one that contains it). */
	const placeableComposites = $derived.by(() => {
		if (!composing) return composites;
		const open = currentDocument.name;
		return composites.filter((item) => {
			if (item.name === open) return false;
			const trial = composites.map((c) =>
				c.name === open ? { ...c, blocks: [...c.blocks, { kind: compositeKind(item.name) }] } : c
			) as EditorComposite[];
			return !findCompositeCycle(trial);
		});
	});

	// ---- Right-click menus (entries are built by the pure functions in `editor-menus.ts`) ----
	const contextMenu = useContextMenu();

	/** Opens the composite with this name in the composite editor. */
	function editCompositeNamed(name: string) {
		const target = composites.find((item) => item.name === name);
		if (target) void goto(resolve(`/composites?composite=${encodeURIComponent(target.id)}`));
	}

	/** Name of the composite a block instantiates, or `undefined` for ordinary widgets. */
	function compositeNameOf(kind: BlockKind): string | undefined {
		return kind.startsWith('composite:')
			? composites.find((item) => compositeKind(item.name) === kind)?.name
			: undefined;
	}

	/**
	 * Places a palette component without dragging: below the lowest existing block so it never
	 * lands on top of another one. Mirrors {@link addBlock} for the pointer-driven path.
	 */
	function addBlockBelowContent(kind: BlockKind) {
		const block = createBlock(kind);
		const bottom = blocks.reduce((max, item) => Math.max(max, item.y + item.height), 0);
		block.y = Math.round(Math.min(blockLimits.maxY, blocks.length > 0 ? bottom + 16 : 24));
		blocks.push(block);
		selectedId = block.id;
		isPreview = false;
		markUnsaved();
	}

	/** Menu of a block; right-clicking also selects it so the actions (and inspector) match. */
	function blockEntries(block: BuilderBlock) {
		if (isPreview) return []; // nothing is editable in preview: fall through to the canvas menu
		selectedId = block.id;
		const index = blocks.findIndex((item) => item.id === block.id);
		const compositeName = compositeNameOf(block.kind);
		return blockMenu({
			compositeName,
			isTop: index === blocks.length - 1,
			isBottom: index === 0,
			editComposite: () => compositeName && editCompositeNamed(compositeName),
			duplicate: duplicateSelected,
			reorder: reorderSelected,
			remove: deleteSelected
		});
	}

	function canvasEntries() {
		return canvasMenu({
			composing,
			previewing: isPreview,
			canUndo,
			canRedo,
			canSave: !databaseBusy && !readOnlyNotice && !!project && hasUnsavedChanges,
			isEmpty: blockCount === 0,
			canDeleteComposite: documents.length > 0,
			undo,
			redo,
			save: () => void savePageToDatabase(),
			togglePreview: () => (isPreview = !isPreview),
			clear: clearPage,
			newComposite: addComposite,
			renameComposite,
			deleteComposite,
			openOther: () => void goto(resolve(composing ? '/editor' : '/composites'))
		});
	}

	function paletteEntries(kind: BlockKind) {
		const compositeName = compositeNameOf(kind);
		return paletteItemMenu({
			label: componentInfo[kind].label,
			compositeName,
			addToCanvas: () => addBlockBelowContent(kind),
			editComposite: () => compositeName && editCompositeNamed(compositeName)
		});
	}

	/** Creates a new empty composite (composite mode only) and opens it. */
	function addComposite() {
		const name = window.prompt('Name of the new composite component (e.g. PricingTable):')?.trim();
		if (!name) return;
		const problem = compositeNameProblem(name);
		if (problem) {
			routeError = problem;
			return;
		}
		const doc: EditorComposite = {
			id: globalThis.crypto.randomUUID(),
			name,
			width: 960,
			height: 360,
			blocks: []
		};
		documents.push(doc);
		markUnsaved();
		selectDocument(doc.id);
	}

	/** Creates the first (blank) page of a fresh project and opens it. */
	function addFirstPage() {
		if (!project || readOnlyNotice) return;
		const page: EditorPage = {
			id: globalThis.crypto.randomUUID(),
			name: 'Home',
			slug: 'home',
			width: defaultCanvasSize.width,
			height: defaultCanvasSize.height,
			blocks: []
		};
		documents.push(page);
		markUnsaved();
		selectDocument(page.id);
	}

	/** Adds the ready-made starter composites (Hero, FeatureCards, Testimonial …) to an empty project. */
	function addStarterComposites() {
		if (!project || readOnlyNotice) return;
		const starters = seedComposites();
		documents.push(...starters);
		markUnsaved();
		selectDocument(starters[0].id);
	}

	/** Renames the open composite; instances elsewhere follow on the next save. */
	function renameComposite() {
		const name = window.prompt('New name:', currentDocument.name)?.trim();
		if (!name || name === currentDocument.name) return;
		const problem = compositeNameProblem(name, currentDocument.id);
		if (problem) {
			routeError = problem;
			return;
		}
		const previous = compositeKind(currentDocument.name);
		const next = compositeKind(name);
		for (const doc of documents)
			for (const block of doc.blocks) if (block.kind === previous) block.kind = next;
		for (const doc of stashedPages)
			for (const block of doc.blocks) if (block.kind === previous) block.kind = next;
		stashedPages = JSON.parse(JSON.stringify(stashedPages));
		currentDocument.name = name;
		markUnsaved();
	}

	/** Deletes the open composite after confirmation; blocks that used it keep a placeholder. */
	function deleteComposite() {
		if (
			!window.confirm(
				`Delete composite "${currentDocument.name}"? Pages using it show a placeholder.`
			)
		)
			return;
		const index = documents.findIndex((doc) => doc.id === currentDocumentId);
		documents.splice(index, 1);
		const next = documents[Math.max(0, index - 1)];
		if (next) selectDocument(next.id);
		else currentDocumentId = '';
		markUnsaved();
	}

	/** Why `name` cannot be used for a composite, or `null` when it is fine. */
	function compositeNameProblem(name: string, ignoreId?: string): string | null {
		if (!isValidCompositeKind(compositeKind(name))) {
			return 'Use a PascalCase name: letters and digits, starting with a capital letter.';
		}
		if (documents.some((doc) => doc.id !== ignoreId && doc.name === name)) {
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
			alignTo: source.alignTo === 'fill' ? 'none' : (source.alignTo ?? 'none'),
			x: Math.min(blockLimits.maxX - source.width, source.x + 16),
			y: Math.min(blockLimits.maxY, source.y + 16)
		};
		blocks.push(copy);
		selectedId = copy.id;
		markUnsaved();
	}

	function updateSelectedAlignment(alignment: AlignTo) {
		if (!selectedBlock) return;
		if (
			alignment === 'fill' &&
			blocks.some((block) => block.id !== selectedBlock.id && block.alignTo === 'fill')
		) {
			return;
		}
		selectedBlock.alignTo = alignment;
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
		const fit = source ? Math.min(1, (currentDocument.width - 48) / source.width) : 1;
		return {
			...base,
			id: globalThis.crypto.randomUUID(),
			positioned: true,
			alignTo: 'none',
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
			scale: canvasElement.getBoundingClientRect().width / currentDocument.width || 1
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
			if ((block.alignTo ?? 'none') !== 'none') return;
			block.x = Math.max(
				0,
				Math.min(blockLimits.maxX - block.width, snap(pointerInteraction.startX + deltaX, snapOn))
			);
			block.y = Math.max(
				0,
				Math.min(blockLimits.maxY, snap(pointerInteraction.startY + deltaY, snapOn))
			);
		} else {
			if (block.alignTo === 'fill') return;
			if (block.alignTo === 'left' || block.alignTo === 'right') {
				if (pointerInteraction.dir.includes('e') || pointerInteraction.dir.includes('w')) {
					const direction = pointerInteraction.dir.includes('e') ? 1 : -1;
					block.width = Math.max(
						blockLimits.minWidth,
						Math.min(
							blockLimits.maxWidth,
							snap(pointerInteraction.startWidth + direction * deltaX, snapOn)
						)
					);
				}
				markUnsaved();
				return;
			}
			if (block.alignTo === 'top' || block.alignTo === 'bottom') {
				if (pointerInteraction.dir.includes('n') || pointerInteraction.dir.includes('s')) {
					const direction = pointerInteraction.dir.includes('s') ? 1 : -1;
					block.height = Math.max(
						blockLimits.minHeight,
						Math.min(
							blockLimits.maxHeight,
							snap(pointerInteraction.startHeight + direction * deltaY, snapOn)
						)
					);
				}
				markUnsaved();
				return;
			}
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
			if ((selectedBlock.alignTo ?? 'none') !== 'none') {
				event.preventDefault();
				return;
			}
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
			if (selectedBlock.alignTo === 'fill') {
				event.preventDefault();
				return;
			}
			if (
				(selectedBlock.alignTo === 'left' || selectedBlock.alignTo === 'right') &&
				(event.key === 'ArrowLeft' || event.key === 'ArrowRight')
			) {
				const delta = event.key === 'ArrowRight' ? amount : -amount;
				selectedBlock.width = Math.max(
					blockLimits.minWidth,
					Math.min(blockLimits.maxWidth, selectedBlock.width + delta)
				);
			} else if (
				(selectedBlock.alignTo === 'top' || selectedBlock.alignTo === 'bottom') &&
				(event.key === 'ArrowUp' || event.key === 'ArrowDown')
			) {
				const delta = event.key === 'ArrowDown' ? amount : -amount;
				selectedBlock.height = Math.max(
					blockLimits.minHeight,
					Math.min(blockLimits.maxHeight, selectedBlock.height + delta)
				);
			} else if (selectedBlock.alignTo !== undefined && selectedBlock.alignTo !== 'none') {
				handled = false;
			} else if (event.key === 'ArrowLeft')
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
		const scale = bounds.width / currentDocument.width || 1;
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
		currentDocument.blocks = currentDocument.blocks.filter((block) => block.id !== selectedId);
		selectedId = blocks[Math.min(index, blocks.length - 1)]?.id ?? null;
		markUnsaved();
	}

	function clearPage() {
		currentDocument.blocks = [];
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
		canSave={!!project && hasUnsavedChanges}
		{readOnlyNotice}
		title={project?.name ?? 'No project'}
		previewing={isPreview}
		onsave={savePageToDatabase}
		{canUndo}
		{canRedo}
		onundo={undo}
		onredo={redo}
		onpreview={() => (isPreview = !isPreview)}
	/>

	{#if !hasDocuments}
		<div class="editor-empty" data-testid="editor-empty">
			{#if databaseBusy}
				<p>Loading project…</p>
			{:else if !project}
				<h2>No project yet</h2>
				<p>The editor works on a project. Create one on the Projects page first.</p>
				<a class="empty-action" href={resolve('/')}>Go to Projects</a>
			{:else if composing}
				<h2>No composites in {project.name}</h2>
				<p>
					Composites are reusable groups of widgets. Create your own, or start from the ready-made
					Hero, FeatureCards and Testimonial.
				</p>
				<div class="empty-actions">
					<button
						type="button"
						class="empty-action"
						disabled={!!readOnlyNotice}
						onclick={addComposite}
					>
						New composite…
					</button>
					<button
						type="button"
						class="empty-action secondary"
						disabled={!!readOnlyNotice}
						onclick={addStarterComposites}
					>
						Add starter composites
					</button>
				</div>
			{:else}
				<h2>No pages in {project.name}</h2>
				<p>This project starts empty. Add the first page, then drag widgets onto it.</p>
				<button
					type="button"
					class="empty-action"
					disabled={!!readOnlyNotice}
					onclick={addFirstPage}
				>
					Add first page
				</button>
			{/if}
		</div>
	{:else}
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
											{@attach contextMenu.attach(() => paletteEntries(kind))}
										>
											<span class="component-mark" aria-hidden="true"
												>{componentInfo[kind].mark}</span
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
										{@attach contextMenu.attach(() => paletteEntries(kind))}
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
						{/if}
					</div>

					<div class="palette-tip">
						<span aria-hidden="true">✦</span>
						<p>
							<strong>Drag to place</strong> — select any block on the canvas to edit its content and
							style.
						</p>
					</div>
				</aside>
			{/if}

			<section
				class="canvas-panel"
				aria-label="{composing ? 'Composite' : 'Page'} canvas"
				{@attach contextMenu.attach(canvasEntries)}
			>
				<div class="canvas-toolbar">
					<div class="canvas-label">
						<span class="live-dot" aria-hidden="true"></span>
						<span
							>{isPreview ? 'Live preview' : composing ? 'Composite canvas' : 'Page canvas'}</span
						>
						<label class="page-switch">
							<span class="sr-only">{composing ? 'Composite' : 'Page'}</span>
							<select
								value={currentDocument.id}
								onchange={(event) => selectDocument(event.currentTarget.value)}
							>
								{#each documents as document (document.id)}
									<option value={document.id}>{editorDocumentLabel(document)}</option>
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
										bind:value={currentDocument.width}
										oninput={markUnsaved}
									/>
								</label>
								<label class="size-field">
									Height
									<input
										type="number"
										min={compositeLimits.minHeight}
										max={compositeLimits.maxHeight}
										bind:value={currentDocument.height}
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
					<div class="canvas-fit" bind:clientWidth={stageWidth}>
						<ThemeScope theme={routePage.data.siteTheme}>
							<div
								class="canvas-frame"
								style:width={previewScale === 1
									? undefined
									: `${currentDocument.width * previewScale}px`}
								style:height={previewScale === 1 ? undefined : `${canvasHeight * previewScale}px`}
							>
								<div
									class="page-canvas"
									class:preview={isPreview}
									style:width="{currentDocument.width}px"
									style:min-height="{canvasHeight}px"
									style:transform={previewScale === 1 ? undefined : `scale(${previewScale})`}
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
												Drag widgets from the panel onto the canvas to start building something
												great.
											</p>
										</div>
									{:else}
										{#each blocks as block, index (block.id)}
											<article
												class="canvas-block positioned {block.kind} theme-{block.theme}"
												class:selected={!isPreview && selectedId === block.id}
												class:custom-fg={!!block.foreground}
												style:color={block.foreground || undefined}
												style:background-color={block.background || undefined}
												style:left="{blockLayout.get(block.id)?.x ?? block.x}px"
												style:top="{blockLayout.get(block.id)?.y ?? block.y}px"
												style:width="{blockLayout.get(block.id)?.width ?? block.width}px"
												style:height="{blockLayout.get(block.id)?.height ?? block.height}px"
												{@attach contextMenu.attach(() => blockEntries(block))}
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
														class:movable={selectedId === block.id &&
															(block.alignTo ?? 'none') === 'none'}
														aria-label="Select {componentInfo[block.kind].label}: {block.title}"
														aria-pressed={selectedId === block.id}
														onclick={() => (selectedId = block.id)}
														onpointerdown={(event) =>
															startPointerInteraction(event, block.id, 'move')}
														onkeydown={(event) => {
															if (event.key.startsWith('Arrow')) {
																selectedId = block.id;
																handlePositionKeydown(event, event.altKey ? 'resize' : 'move');
															}
														}}
													></button>
													{#if selectedId === block.id}
														<div class="selection-frame" aria-hidden="true">
															{#each resizeHandlesFor(block) as dir (dir)}
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
							</div>
						</ThemeScope>
					</div>
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
					<BlockInspector
						bind:block={() => selectedBlock, () => {}}
						label={selectedLabel}
						mark={selectedBlock ? componentInfo[selectedBlock.kind].mark : ''}
						{linkPages}
						compositeEdit={selectedComposite}
						hasFillBlock={anotherBlockUsesFill}
						siteTheme={routePage.data.siteTheme}
						onchange={markUnsaved}
						onalign={updateSelectedAlignment}
						onposition={updateSelectedPosition}
						onreorder={reorderSelected}
						onduplicate={duplicateSelected}
						ondelete={deleteSelected}
					/>
				</aside>
			{/if}
		</div>
	{/if}
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

	.editor-empty {
		display: flex;
		min-height: calc(100vh - 12rem);
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 2rem;
		color: #65677e;
		text-align: center;
	}

	.editor-empty h2 {
		margin: 0;
		color: var(--ink);
		font-size: 1.1rem;
	}

	.editor-empty p {
		max-width: 30rem;
		margin: 0 0 0.8rem;
		font-size: 0.8rem;
		line-height: 1.55;
	}

	.empty-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem;
	}

	.empty-action {
		display: inline-flex;
		min-height: 36px;
		align-items: center;
		padding: 0 1.1rem;
		border: 1px solid var(--purple);
		border-radius: 9px;
		background: var(--purple);
		color: #fff;
		font: inherit;
		font-size: 0.78rem;
		font-weight: 700;
		text-decoration: none;
		cursor: pointer;
	}

	.empty-action.secondary {
		background: #fff;
		color: var(--purple);
	}

	.empty-action:disabled {
		cursor: not-allowed;
		opacity: 0.5;
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

	.palette-tabs button:focus-visible {
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

	.component-copy {
		display: grid;
		min-width: 0;
		gap: 0.2rem;
	}

	.component-copy strong {
		overflow: hidden;
		font-size: 0.73rem;
		font-weight: 680;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.component-copy small {
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

	.canvas-fit {
		min-width: 0;
		flex: 1;
	}

	.canvas-frame {
		display: flex;
		max-width: none;
		margin-inline: auto;
	}

	.canvas-frame > .page-canvas {
		transform-origin: top left;
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

	/* A custom foreground must also reach widgets that hard-code a text colour (headings, labels…). */
	.canvas-block.custom-fg
		:global(:where(h1, h2, h3, h4, h5, h6, p, label, li, span, legend, blockquote)) {
		color: inherit;
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

	/* Edge handles also own the whole edge (invisible strip), so the resize cursor shows along it. */
	.handle-n::after,
	.handle-s::after,
	.handle-e::after,
	.handle-w::after {
		content: '';
		position: absolute;
	}
	.handle-n::after,
	.handle-s::after {
		left: -100vw;
		right: -100vw;
		top: -4px;
		bottom: -4px;
	}
	.handle-e::after,
	.handle-w::after {
		top: -100vh;
		bottom: -100vh;
		left: -4px;
		right: -4px;
	}
	.handle-nw,
	.handle-ne,
	.handle-se,
	.handle-sw {
		z-index: 1;
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

	.empty-icon {
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

	.empty-canvas p {
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

	.field-control:focus {
		border-color: #978be9;
		box-shadow: 0 0 0 3px rgb(119 102 223 / 12%);
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
</style>
