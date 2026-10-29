<script lang="ts">
	import { onMount } from 'svelte';
	import Hero from '../../lib/components/editor/Hero.svelte';
	import TextSection from '../../lib/components/editor/TextSection.svelte';
	import ButtonSection from '../../lib/components/editor/ButtonSection.svelte';
	import Features from '../../lib/components/editor/Features.svelte';
	import ImageSection from '../../lib/components/editor/ImageSection.svelte';
	import Quote from '../../lib/components/editor/Quote.svelte';
	import WidgetButton from '../../lib/components/editor/WidgetButton.svelte';
	import WidgetTextField from '../../lib/components/editor/WidgetTextField.svelte';
	import WidgetTextarea from '../../lib/components/editor/WidgetTextarea.svelte';
	import WidgetCheckbox from '../../lib/components/editor/WidgetCheckbox.svelte';
	import WidgetRadio from '../../lib/components/editor/WidgetRadio.svelte';
	import WidgetSwitch from '../../lib/components/editor/WidgetSwitch.svelte';
	import WidgetSelect from '../../lib/components/editor/WidgetSelect.svelte';
	import WidgetSlider from '../../lib/components/editor/WidgetSlider.svelte';
	import WidgetBadge from '../../lib/components/editor/WidgetBadge.svelte';
	import WidgetAlert from '../../lib/components/editor/WidgetAlert.svelte';
	import WidgetProgress from '../../lib/components/editor/WidgetProgress.svelte';
	import WidgetAvatar from '../../lib/components/editor/WidgetAvatar.svelte';
	import WidgetCard from '../../lib/components/editor/WidgetCard.svelte';
	import WidgetLink from '../../lib/components/editor/WidgetLink.svelte';
	import { page as routePage } from '$app/state';
	import {
		isValidLinkHref,
		type BuilderBlock,
		type BlockKind,
		type EditorPage,
		type EditorSite,
		type SectionKind,
		type WidgetKind
	} from '../../lib/editor.js';

	type DragPayload = { source: 'palette'; kind: BlockKind };
	type EditorApiResponse = {
		created?: boolean;
		site?: EditorSite | null;
		success?: boolean;
		error?: string;
	};
	type PaletteTab = 'sections' | 'widgets' | 'custom';

	const sectionInfo: Record<SectionKind, { label: string; detail: string; mark: string }> = {
		hero: { label: 'Hero section', detail: 'A bold opening for your page', mark: '✳' },
		text: { label: 'Text block', detail: 'Share a little more detail', mark: 'T' },
		button: { label: 'Call to action', detail: 'Give visitors a next step', mark: '↗' },
		features: { label: 'Feature cards', detail: 'Showcase what makes you great', mark: '▦' },
		image: { label: 'Image section', detail: 'A visual moment for your story', mark: '▧' },
		quote: { label: 'Testimonial', detail: 'Let a happy customer speak', mark: '“' }
	};
	const widgetInfo: Record<WidgetKind, { label: string; detail: string; mark: string }> = {
		'widget-button': { label: 'Button', detail: 'A clear action for visitors', mark: '↗' },
		'widget-text-field': { label: 'Text field', detail: 'A single-line text input', mark: 'T' },
		'widget-textarea': { label: 'Textarea', detail: 'A multi-line text input', mark: '≡' },
		'widget-checkbox': { label: 'Checkbox', detail: 'Choose an independent option', mark: '☑' },
		'widget-radio': { label: 'Radio button', detail: 'Choose one option in a group', mark: '◉' },
		'widget-switch': { label: 'Switch', detail: 'Turn a setting on or off', mark: '◉' },
		'widget-select': { label: 'Select menu', detail: 'Pick from a list of options', mark: '▾' },
		'widget-slider': { label: 'Slider', detail: 'Choose a value in a range', mark: '━' },
		'widget-badge': { label: 'Badge', detail: 'A compact status or category', mark: '●' },
		'widget-alert': { label: 'Alert', detail: 'A short message with context', mark: '!' },
		'widget-progress': { label: 'Progress bar', detail: 'Show completion at a glance', mark: '▰' },
		'widget-avatar': { label: 'Avatar', detail: 'Represent a person or account', mark: '◉' },
		'widget-card': { label: 'Card', detail: 'Group related content together', mark: '▣' },
		'widget-link': { label: 'Link', detail: 'Go to a page or website', mark: '↪' }
	};
	const sectionKinds = Object.keys(sectionInfo) as SectionKind[];
	const widgetKinds = Object.keys(widgetInfo) as WidgetKind[];
	const rawComponentInfo: Record<string, { label: string; detail: string; mark: string }> = {
		...sectionInfo,
		...widgetInfo
	};
	const componentInfo = new Proxy(rawComponentInfo, {
		get(target, prop: string) {
			if (typeof prop === 'string' && prop in target) return target[prop];
			if (typeof prop === 'string' && prop.startsWith('custom:')) {
				return { label: prop.slice(7), detail: 'Custom component', mark: '✳' };
			}
			return { label: String(prop), detail: 'Component', mark: '✳' };
		}
	}) as Record<BlockKind, { label: string; detail: string; mark: string }>;

	const defaults: Record<
		BlockKind,
		Omit<
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
		>
	> = {
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
		},
		'widget-button': {
			kind: 'widget-button',
			title: 'Button',
			body: 'A useful action for your visitors.',
			action: 'Get started',
			theme: 'lavender'
		},
		'widget-text-field': {
			kind: 'widget-text-field',
			title: 'Email address',
			body: 'We’ll only use this to contact you.',
			action: 'name@example.com',
			theme: 'light'
		},
		'widget-textarea': {
			kind: 'widget-textarea',
			title: 'Your message',
			body: 'Tell us a little more.',
			action: 'Write your message…',
			theme: 'light'
		},
		'widget-checkbox': {
			kind: 'widget-checkbox',
			title: 'Keep me updated',
			body: 'Receive occasional product news.',
			action: '',
			theme: 'light'
		},
		'widget-radio': {
			kind: 'widget-radio',
			title: 'Standard delivery',
			body: 'Arrives in 3–5 business days.',
			action: '',
			theme: 'light'
		},
		'widget-switch': {
			kind: 'widget-switch',
			title: 'Enable notifications',
			body: 'Get notified about important updates.',
			action: '',
			theme: 'light'
		},
		'widget-select': {
			kind: 'widget-select',
			title: 'Choose a country',
			body: 'Select an option from the menu.',
			action: 'Canada',
			theme: 'light'
		},
		'widget-slider': {
			kind: 'widget-slider',
			title: 'Volume',
			body: 'Adjust the level to your preference.',
			action: '',
			theme: 'light'
		},
		'widget-badge': {
			kind: 'widget-badge',
			title: 'New',
			body: 'A small label for status or category.',
			action: '',
			theme: 'lavender'
		},
		'widget-alert': {
			kind: 'widget-alert',
			title: 'Changes saved',
			body: 'Your settings have been updated successfully.',
			action: '',
			theme: 'light'
		},
		'widget-progress': {
			kind: 'widget-progress',
			title: 'Profile completion',
			body: 'You’re making great progress.',
			action: '',
			theme: 'light'
		},
		'widget-avatar': {
			kind: 'widget-avatar',
			title: 'Alex Morgan',
			body: 'Product designer',
			action: '',
			theme: 'light'
		},
		'widget-card': {
			kind: 'widget-card',
			title: 'A thoughtful detail',
			body: 'Cards group related information into a clear, scannable surface.',
			action: 'Learn more',
			theme: 'light'
		},
		'widget-link': {
			kind: 'widget-link',
			title: 'Read more',
			body: 'Opens another page.',
			action: '',
			theme: 'lavender'
		}
	};

	const initialPage: EditorPage = {
		id: 'home',
		name: 'Home',
		slug: 'home',
		width: 800,
		height: 600,
		blocks: [
			{
				id: 'sample-hero',
				kind: 'hero',
				title: 'Make room for your next big idea.',
				body: 'A thoughtful space to share what you do and why it matters.',
				action: 'Explore what we do',
				theme: 'lavender',
				positioned: true,
				x: 6,
				y: 40,
				width: 88,
				height: 260,
				value: '',
				checked: false,
				level: 60,
				href: '',
				newTab: false
			},
			{
				id: 'sample-features',
				kind: 'features',
				title: 'The details make the difference',
				body: 'Simple tools, considered design, and a team that cares.',
				action: '',
				theme: 'light',
				positioned: true,
				x: 6,
				y: 340,
				width: 88,
				height: 260,
				value: '',
				checked: false,
				level: 60,
				href: '',
				newTab: false
			},
			{
				id: 'sample-quote',
				kind: 'quote',
				title: '“It just feels like us.”',
				body: 'The whole process felt easy, and the result is something we’re genuinely proud to share.',
				action: 'Maya Chen · Studio founder',
				theme: 'light',
				positioned: true,
				x: 6,
				y: 640,
				width: 88,
				height: 260,
				value: '',
				checked: false,
				level: 60,
				href: '',
				newTab: false
			}
		]
	};

	let pages = $state<EditorPage[]>([initialPage]);
	let currentPageId = $state('home');
	let currentPage = $derived(pages.find((page) => page.id === currentPageId) ?? pages[0]);
	let blocks = $derived(currentPage.blocks);
	let selectedId = $state<string | null>('sample-hero');
	let paletteTab = $state<PaletteTab>('sections');
	let isPreview = $state(false);
	let databaseReady = $state(false);
	let databaseBusy = $state(true);
	let databaseStatus = $state('Checking SQLite…');
	let hasUnsavedChanges = $state(true);
	let revision = $state(0);
	let routeError = $state<string | null>(null);
	let undoStack = $state.raw<string[]>([]);
	let redoStack = $state.raw<string[]>([]);
	let historyPending = $state(false);
	let historyTimer: ReturnType<typeof setTimeout> | undefined;
	let committedSnapshot = JSON.stringify([initialPage]);
	let canvasElement: HTMLDivElement | null = null;
	let pointerInteraction = $state<{
		id: string;
		pointerId: number;
		mode: 'move' | 'resize';
		startX: number;
		startY: number;
		startWidth: number;
		startHeight: number;
		pointerX: number;
		pointerY: number;
		canvasWidth: number;
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

		if (result.site) {
			pages = result.site.pages;
			currentPageId =
				pages.find((item) => item.id === routePage.url.searchParams.get('page'))?.id ?? pages[0].id;
			selectedId = currentPage.blocks[0]?.id ?? null;
			resetHistory();
			hasUnsavedChanges = false;
			databaseStatus = 'Saved site loaded from SQLite';
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

		if (pages.some((page) => page.blocks.some((block) => !isValidLinkHref(block.href)))) {
			databaseStatus = 'A link address is invalid. Use /page or https://…';
			return;
		}

		const savedRevision = revision;
		const siteSnapshot: EditorSite = { pages: $state.snapshot(pages) };
		databaseBusy = true;
		databaseStatus = 'Saving site to SQLite…';

		try {
			await requestApi('POST', { action: 'save', site: siteSnapshot });
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

	function selectPage(id: string) {
		currentPageId = id;
		selectedId = null;
		routeError = null;
	}

	function setCanvasWidth(width: number) {
		currentPage.width = width;
		markUnsaved();
	}

	function resolveInternalPage(href: string) {
		const slug = href.slice(1).split(/[?#]/)[0];
		return slug === '' ? pages[0] : pages.find((page) => page.slug === slug);
	}

	function handleLinkClick(event: MouseEvent, block: BuilderBlock) {
		if (!isPreview || !block.href || !isValidLinkHref(block.href)) {
			event.preventDefault();
			return;
		}
		if (!block.href.startsWith('/')) return;

		event.preventDefault();
		const target = resolveInternalPage(block.href);
		if (target) selectPage(target.id);
		else routeError = `No page found at ${block.href}`;
	}

	function duplicateSelected() {
		if (!selectedBlock) return;
		const source: BuilderBlock = $state.snapshot(selectedBlock);
		const copy: BuilderBlock = {
			...source,
			id: globalThis.crypto.randomUUID(),
			x: Math.min(100 - source.width, source.x + 3),
			y: Math.min(5000, source.y + 24)
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
		const base = (defaults as Record<string, any>)[kind] || {
			kind,
			title: kind.startsWith('custom:') ? kind.slice(7) : 'Custom Component',
			body: '',
			action: '',
			theme: 'light'
		};
		return {
			...base,
			id: globalThis.crypto.randomUUID(),
			positioned: true,
			x: 6,
			y: 40,
			width: 88,
			height: 260,
			value: kind === 'widget-select' ? defaults[kind].action : '',
			checked: false,
			level: 60,
			href: kind === 'widget-link' ? '/home' : '',
			newTab: false
		};
	}

	function startPointerInteraction(event: PointerEvent, id: string, mode: 'move' | 'resize') {
		if (isPreview || !canvasElement) return;
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
			startX: block.x,
			startY: block.y,
			startWidth: block.width,
			startHeight: block.height,
			pointerX: event.clientX,
			pointerY: event.clientY,
			canvasWidth: canvasElement.clientWidth
		};
	}

	function handlePointerMove(event: PointerEvent) {
		if (!pointerInteraction || event.pointerId !== pointerInteraction.pointerId) return;
		const block = blocks.find((item) => item.id === pointerInteraction?.id);
		if (!block || pointerInteraction.canvasWidth <= 0) return;

		const deltaX =
			((event.clientX - pointerInteraction.pointerX) / pointerInteraction.canvasWidth) * 100;
		const deltaY = event.clientY - pointerInteraction.pointerY;

		if (pointerInteraction.mode === 'move') {
			block.x = Math.round(
				Math.max(0, Math.min(100 - block.width, pointerInteraction.startX + deltaX))
			);
			block.y = Math.round(Math.max(0, Math.min(5000, pointerInteraction.startY + deltaY)));
		} else {
			block.width = Math.round(
				Math.max(20, Math.min(100 - block.x, pointerInteraction.startWidth + deltaX))
			);
			block.height = Math.round(
				Math.max(100, Math.min(1600, pointerInteraction.startHeight + deltaY))
			);
		}

		markUnsaved();
	}

	function updateSelectedPosition(field: 'x' | 'y' | 'width' | 'height') {
		if (!selectedBlock) return;

		if (field === 'x')
			selectedBlock.x = Math.round(
				Math.max(0, Math.min(100 - selectedBlock.width, selectedBlock.x))
			);
		if (field === 'y') selectedBlock.y = Math.round(Math.max(0, Math.min(5000, selectedBlock.y)));
		if (field === 'width')
			selectedBlock.width = Math.round(
				Math.max(20, Math.min(100 - selectedBlock.x, selectedBlock.width))
			);
		if (field === 'height')
			selectedBlock.height = Math.round(Math.max(100, Math.min(1600, selectedBlock.height)));

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
				selectedBlock.x = Math.min(100 - selectedBlock.width, selectedBlock.x + amount);
			else if (event.key === 'ArrowUp') selectedBlock.y = Math.max(0, selectedBlock.y - amount);
			else if (event.key === 'ArrowDown')
				selectedBlock.y = Math.min(5000, selectedBlock.y + amount);
			else handled = false;
		} else {
			if (event.key === 'ArrowLeft')
				selectedBlock.width = Math.max(20, selectedBlock.width - amount);
			else if (event.key === 'ArrowRight')
				selectedBlock.width = Math.min(100 - selectedBlock.x, selectedBlock.width + amount);
			else if (event.key === 'ArrowUp')
				selectedBlock.height = Math.max(100, selectedBlock.height - amount);
			else if (event.key === 'ArrowDown')
				selectedBlock.height = Math.min(1600, selectedBlock.height + amount);
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
		block.x = Math.round(
			Math.max(
				0,
				Math.min(
					100 - block.width,
					((clientX - bounds.left) / bounds.width) * 100 - block.width / 2
				)
			)
		);
		block.y = Math.round(Math.max(0, Math.min(5000, clientY - bounds.top - block.height / 2)));
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
				Object.hasOwn(componentInfo, payload.kind)
			) {
				return { source: 'palette', kind: payload.kind as BlockKind };
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
			<div class="viewport-switch" role="group" aria-label="History">
				<button
					type="button"
					aria-label="Undo"
					title="Undo (Ctrl+Z)"
					disabled={!canUndo}
					onclick={undo}
				>
					<svg viewBox="0 0 20 20" aria-hidden="true"
						><path d="M7 5 3.5 8.5 7 12M4 8.5h8a4 4 0 0 1 0 8H9" /></svg
					>
				</button>
				<button
					type="button"
					aria-label="Redo"
					title="Redo (Ctrl+Shift+Z)"
					disabled={!canRedo}
					onclick={redo}
				>
					<svg viewBox="0 0 20 20" aria-hidden="true"
						><path d="m13 5 3.5 3.5L13 12m3.5-3.5h-8a4 4 0 0 0 0 8H11" /></svg
					>
				</button>
			</div>
			<div class="viewport-switch" role="group" aria-label="Canvas size presets">
				{#each [{ label: 'Mobile', width: 390, key: 'M' }, { label: 'Tablet', width: 768, key: 'T' }, { label: 'Desktop', width: 1200, key: 'D' }] as preset (preset.width)}
					<button
						type="button"
						class:active={currentPage.width === preset.width}
						aria-label="{preset.label} canvas, {preset.width} pixels wide"
						title="{preset.label} · {preset.width}px"
						aria-pressed={currentPage.width === preset.width}
						onclick={() => setCanvasWidth(preset.width)}
					>
						{preset.key}
					</button>
				{/each}
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
						<h2>
							{paletteTab === 'sections' ? 'Components' : 'GUI widgets'}
						</h2>
					</div>
					<span class="count-pill">
						{paletteTab === 'sections' ? sectionKinds.length : widgetKinds.length}
					</span>
				</div>
				<div class="palette-tabs" role="tablist" aria-label="Palette categories">
					<button
						type="button"
						id="sections-tab"
						role="tab"
						aria-selected={paletteTab === 'sections'}
						aria-controls="palette-items"
						class:tab-active={paletteTab === 'sections'}
						onclick={() => (paletteTab = 'sections')}
					>
						Sections
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
					{paletteTab === 'sections'
						? 'Drag a section onto your page to place it.'
						: 'Drag a widget onto your page to place it.'}
				</p>

				<div id="palette-items" role="tabpanel" aria-labelledby="{paletteTab}-tab">
					<div class="component-list" role="list" aria-label="Draggable components">
						{#each paletteTab === 'sections' ? sectionKinds : paletteTab === 'widgets' ? widgetKinds : customKinds as kind (kind)}
							<div
								class="palette-item"
								class:widget-item={paletteTab === 'widgets'}
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
				</div>

				<div class="palette-tip">
					<span aria-hidden="true">✦</span>
					<p>
						<strong>Drag to place</strong> — select any block on the canvas to edit its content and style.
					</p>
				</div>
			</aside>
		{/if}

		<section class="canvas-panel" aria-label="Page canvas">
			<div class="canvas-toolbar">
				<div class="canvas-label">
					<span class="live-dot" aria-hidden="true"></span>
					<span>{isPreview ? 'Live preview' : 'Page canvas'}</span>
					<label class="page-switch">
						<span class="sr-only">Page</span>
						<select
							value={currentPage.id}
							onchange={(event) => selectPage(event.currentTarget.value)}
						>
							{#each pages as page (page.id)}
								<option value={page.id}>{page.name} · /{page.slug}</option>
							{/each}
						</select>
					</label>
					{#if routeError}<span class="route-error" role="alert">{routeError}</span>{/if}
				</div>
				{#if !isPreview}
					<div class="canvas-actions">
						<span>{blockCount} {blockCount === 1 ? 'item' : 'items'}</span>
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
							<h2>Your page starts here</h2>
							<p>
								Drag a component from the panel onto the canvas to start building something great.
							</p>
						</div>
					{:else}
						{#each blocks as block (block.id)}
							<article
								class="canvas-block positioned {block.kind} theme-{block.theme}"
								class:selected={!isPreview && selectedId === block.id}
								style:left="{block.x}%"
								style:top="{block.y}px"
								style:width="{block.width}%"
								style:height="{block.height}px"
							>
								{#if block.kind === 'hero'}
									<Hero
										title={block.title}
										body={block.body}
										action={block.action}
										theme={block.theme}
									/>
								{:else if block.kind === 'text'}
									<TextSection title={block.title} body={block.body} theme={block.theme} />
								{:else if block.kind === 'button'}
									<ButtonSection
										title={block.title}
										body={block.body}
										action={block.action}
										theme={block.theme}
									/>
								{:else if block.kind === 'features'}
									<Features title={block.title} body={block.body} theme={block.theme} />
								{:else if block.kind === 'image'}
									<ImageSection title={block.title} body={block.body} theme={block.theme} />
								{:else if block.kind === 'quote'}
									<Quote
										title={block.title}
										body={block.body}
										action={block.action}
										theme={block.theme}
									/>
								{:else if block.kind === 'widget-button'}
									<WidgetButton action={block.action} body={block.body} onchange={markUnsaved} />
								{:else if block.kind === 'widget-text-field'}
									<WidgetTextField
										id={block.id}
										title={block.title}
										action={block.action}
										body={block.body}
										bind:value={block.value}
										onchange={markUnsaved}
									/>
								{:else if block.kind === 'widget-textarea'}
									<WidgetTextarea
										id={block.id}
										title={block.title}
										action={block.action}
										body={block.body}
										bind:value={block.value}
										onchange={markUnsaved}
									/>
								{:else if block.kind === 'widget-checkbox'}
									<WidgetCheckbox
										id={block.id}
										title={block.title}
										body={block.body}
										bind:checked={block.checked}
										onchange={markUnsaved}
									/>
								{:else if block.kind === 'widget-radio'}
									<WidgetRadio
										id={block.id}
										title={block.title}
										body={block.body}
										bind:checked={block.checked}
										onchange={markUnsaved}
									/>
								{:else if block.kind === 'widget-switch'}
									<WidgetSwitch
										id={block.id}
										title={block.title}
										body={block.body}
										bind:checked={block.checked}
										onchange={markUnsaved}
									/>
								{:else if block.kind === 'widget-select'}
									<WidgetSelect
										id={block.id}
										title={block.title}
										body={block.body}
										bind:value={block.value}
										onchange={markUnsaved}
									/>
								{:else if block.kind === 'widget-slider'}
									<WidgetSlider
										id={block.id}
										title={block.title}
										body={block.body}
										bind:level={block.level}
										onchange={markUnsaved}
									/>
								{:else if block.kind === 'widget-badge'}
									<WidgetBadge title={block.title} body={block.body} />
								{:else if block.kind === 'widget-alert'}
									<WidgetAlert title={block.title} body={block.body} />
								{:else if block.kind === 'widget-progress'}
									<WidgetProgress title={block.title} body={block.body} bind:level={block.level} />
								{:else if block.kind === 'widget-avatar'}
									<WidgetAvatar title={block.title} body={block.body} />
								{:else if block.kind === 'widget-card'}
									<WidgetCard
										title={block.title}
										body={block.body}
										action={block.action}
										onchange={markUnsaved}
									/>
								{:else if block.kind === 'widget-link'}
									<WidgetLink
										title={block.title}
										body={block.body}
										href={block.href}
										newTab={block.newTab}
										onnavigate={(event) => handleLinkClick(event, block)}
									/>
								{:else if block.kind.startsWith('custom:')}
									<div class="custom-block-preview">
										<div class="custom-badge-row">
											<span class="custom-pill">✳ {block.kind.slice(7)}</span>
										</div>
										<h4>{block.title || block.kind.slice(7)}</h4>
										{#if block.body}<p>{block.body}</p>{/if}
										{#if block.customProps && Object.keys(block.customProps).length > 0}
											<div class="custom-props-preview">
												{#each Object.entries(block.customProps) as [k, v] (k)}
													<span class="custom-prop-tag"><code>{k}</code>: {String(v)}</span>
												{/each}
											</div>
										{/if}
									</div>{/if}
								{#if !isPreview}
									<span class="block-type-tag">{componentInfo[block.kind].label}</span>
									<button
										type="button"
										class="selection-overlay"
										aria-label="Select {componentInfo[block.kind].label}: {block.title}"
										aria-pressed={selectedId === block.id}
										onclick={() => (selectedId = block.id)}
									></button>
									<button
										type="button"
										class="position-handle move-handle"
										aria-label="Move {componentInfo[block.kind].label}; use arrow keys to move"
										onpointerdown={(event) => startPointerInteraction(event, block.id, 'move')}
										onkeydown={(event) => {
											selectedId = block.id;
											handlePositionKeydown(event, 'move');
										}}
									>
										<svg viewBox="0 0 20 20" aria-hidden="true"
											><path
												d="M10 2v16M2 10h16M7 5l3-3 3 3m-6 10 3 3 3-3M5 7l-3 3 3 3m10-6 3 3-3 3"
											/></svg
										>
									</button>
									<button
										type="button"
										class="position-handle resize-handle"
										aria-label="Resize {componentInfo[block.kind].label}; use arrow keys to resize"
										onpointerdown={(event) => startPointerInteraction(event, block.id, 'resize')}
										onkeydown={(event) => {
											selectedId = block.id;
											handlePositionKeydown(event, 'resize');
										}}
									>
										<svg viewBox="0 0 20 20" aria-hidden="true"
											><path d="M7 17h10V7M17 7 7 17m3 0H7v-3m10-3v-4h-4" /></svg
										>
									</button>
								{/if}
							</article>
						{/each}
					{/if}
				</div>
			</div>
			{#if !isPreview}
				<p class="canvas-footnote">
					<span aria-hidden="true">⌘</span> Drag components from the palette to place them
					<span class="footnote-divider">·</span> Drag handles to move or resize
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
								aria-label="Duplicate selected section"
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
								<label class="field-label" for="block-x">Left (%)</label>
								<input
									id="block-x"
									class="field-control"
									type="number"
									min="0"
									max={100 - selectedBlock.width}
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
									max="5000"
									step="1"
									bind:value={selectedBlock.y}
									oninput={() => updateSelectedPosition('y')}
								/>
							</div>
							<div>
								<label class="field-label" for="block-width">Width (%)</label>
								<input
									id="block-width"
									class="field-control"
									type="number"
									min="20"
									max={100 - selectedBlock.x}
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
									min="100"
									max="1600"
									step="10"
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
								{#each pages as page (page.id)}<option value="/{page.slug}">{page.name}</option
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
						{#if ['hero', 'button', 'quote', 'widget-button', 'widget-text-field', 'widget-textarea', 'widget-card'].includes(selectedBlock.kind)}
							<label class="field-label" for="block-action">
								{selectedBlock.kind === 'quote'
									? 'Attribution'
									: ['widget-text-field', 'widget-textarea'].includes(selectedBlock.kind)
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
								<option value="Canada">Canada</option>
								<option value="United States">United States</option>
								<option value="United Kingdom">United Kingdom</option>
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

	.preview-button {
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

	.preview-button:hover {
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
		background: #fff;
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

	.position-handle {
		position: absolute;
		z-index: 4;
		display: grid;
		width: 28px;
		height: 28px;
		place-items: center;
		padding: 0;
		border: 1px solid #dcd7ff;
		border-radius: 7px;
		background: #fff;
		color: #6558cb;
		box-shadow: 0 2px 6px rgb(34 34 56 / 0.15);
		touch-action: none;
	}

	.position-handle svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.5;
	}

	.move-handle {
		top: 7px;
		left: 7px;
		cursor: move;
	}

	.resize-handle {
		right: 5px;
		bottom: 5px;
		cursor: nwse-resize;
	}

	.canvas-block.hero {
		min-height: 290px;
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

	.custom-block-preview {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 1rem;
		box-sizing: border-box;
		background: #fff;
		border-radius: 8px;
		border: 1px dashed #c9c1ff;
	}

	.custom-badge-row {
		margin-bottom: 0.4rem;
	}

	.custom-pill {
		display: inline-block;
		padding: 0.15rem 0.45rem;
		border-radius: 4px;
		background: #eeeaff;
		color: var(--purple);
		font-size: 0.65rem;
		font-weight: 700;
	}

	.custom-block-preview h4 {
		margin: 0 0 0.25rem;
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--ink);
	}

	.custom-block-preview p {
		margin: 0 0 0.5rem;
		font-size: 0.75rem;
		color: var(--muted);
	}

	.custom-props-preview {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-top: auto;
	}

	.custom-prop-tag {
		font-size: 0.65rem;
		background: #f7f7fa;
		padding: 0.15rem 0.35rem;
		border-radius: 4px;
		border: 1px solid #e8e8ed;
		color: #4b456f;
	}
</style>
