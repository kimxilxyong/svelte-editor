/**
 * @fileoverview Builders for the right-click menus used by the Projects page (`/`), the Pages
 * overview (`/pages`) and the shared visual editor (`/editor`, `/composites`).
 *
 * Each builder is a **pure function**: it receives the current state plus the callbacks to run
 * and returns entries for the {@link ContextMenu} controller (`context-menu.svelte.ts`). Keeping
 * them free of Svelte and the DOM makes the menu contents (what is offered, enabled, hidden or
 * marked dangerous in which situation) unit-testable and keeps the route components small.
 *
 * Menus are grouped by what was clicked, from most to least specific:
 *
 * | Target                       | Builder              | Typical entries                       |
 * | ---------------------------- | -------------------- | ------------------------------------- |
 * | A project row                | {@link projectItemMenu} | Open, Pages, Editor, Rename, Duplicate, Delete |
 * | The project list background  | {@link projectListMenu} | New project, Reload                |
 * | A page row                   | {@link pageItemMenu} | Edit, Preview, Duplicate, Delete      |
 * | The page list background     | {@link pageListMenu} | Add, Save, Reload, Open composites    |
 * | The page preview             | {@link pagePreviewMenu} | Edit, Preview, Save                |
 * | A block on the canvas        | {@link blockMenu}    | Edit composite, Duplicate, Order, Delete |
 * | The canvas / toolbar         | {@link canvasMenu}   | Undo, Save, Preview, New/Rename/Delete composite |
 * | A palette item               | {@link paletteItemMenu} | Add to canvas, Edit composite     |
 *
 * Because the DOM events bubble, the most specific menu wins and the rest are skipped (see the
 * nesting rule in `context-menu.svelte.ts`).
 */

import { separator, type MenuEntryInput } from './context-menu.js';

/** Callbacks and state for a page row of the Pages overview. */
export interface PageItemMenuOptions {
	/** Display name, used in labels. */
	name: string;
	/** Duplicate allowed (page limit not reached). */
	canDuplicate: boolean;
	/** Delete allowed (at least one page must remain). */
	canDelete: boolean;
	edit: () => void;
	preview: () => void;
	duplicate: () => void;
	remove: () => void;
	/** Copies the page route (e.g. `/about`) to the clipboard. */
	copyRoute: () => void;
}

/**
 * Menu of a single page in the Pages list.
 *
 * @param options - State and callbacks, see {@link PageItemMenuOptions}.
 * @returns Entries for {@link ContextMenu.show}.
 */
export function pageItemMenu(options: PageItemMenuOptions): MenuEntryInput[] {
	return [
		{ id: 'edit', label: `Edit “${options.name}”`, run: options.edit },
		{ id: 'preview', label: 'Preview', run: options.preview },
		separator,
		{
			id: 'duplicate',
			label: 'Duplicate',
			disabled: !options.canDuplicate,
			run: options.duplicate
		},
		{ id: 'copy-route', label: 'Copy route', run: options.copyRoute },
		separator,
		{
			id: 'delete',
			label: 'Delete',
			danger: true,
			disabled: !options.canDelete,
			run: options.remove
		}
	];
}

/** Callbacks and state for the background of the Pages list. */
export interface PageListMenuOptions {
	/** Another page may be added (limit not reached). */
	canAdd: boolean;
	/** Unsaved changes exist or the database is not created yet, and the role may save. */
	canSave: boolean;
	add: () => void;
	save: () => void;
	/** Reloads the saved site, discarding unsaved edits (the caller confirms). */
	reload: () => void;
	/** Opens the Composites editor. */
	openComposites: () => void;
}

/**
 * Menu of the empty area of the Pages list: list-level actions.
 *
 * @param options - State and callbacks, see {@link PageListMenuOptions}.
 * @returns Entries for {@link ContextMenu.show}.
 */
export function pageListMenu(options: PageListMenuOptions): MenuEntryInput[] {
	return [
		{ id: 'add', label: 'Add page', disabled: !options.canAdd, run: options.add },
		{ id: 'save', label: 'Save site', disabled: !options.canSave, run: options.save },
		{ id: 'reload', label: 'Reload from database', run: options.reload },
		separator,
		{ id: 'open-composites', label: 'Open composites', run: options.openComposites }
	];
}

/** Callbacks and state for the page preview on the Pages overview. */
export interface PagePreviewMenuOptions {
	/** The overview currently shows the interactive live preview. */
	previewing: boolean;
	canSave: boolean;
	edit: () => void;
	togglePreview: () => void;
	save: () => void;
}

/**
 * Menu of the page preview area on the Pages overview.
 *
 * @param options - State and callbacks, see {@link PagePreviewMenuOptions}.
 * @returns Entries for {@link ContextMenu.show}.
 */
export function pagePreviewMenu(options: PagePreviewMenuOptions): MenuEntryInput[] {
	return [
		{ id: 'edit', label: 'Edit this page', hidden: options.previewing, run: options.edit },
		{
			id: 'toggle-preview',
			label: options.previewing ? 'Back to overview' : 'Live preview',
			run: options.togglePreview
		},
		separator,
		{ id: 'save', label: 'Save site', disabled: !options.canSave, run: options.save }
	];
}

/** Layer-order operations of a block (mirrors the inspector's order buttons). */
export type BlockOrder = 'front' | 'forward' | 'backward' | 'back';

/** Callbacks and state for a block on the visual editor canvas. */
export interface BlockMenuOptions {
	/** Name of the composite this block is an instance of, when it is one. */
	compositeName?: string;
	/** Position in the stacking order, used to disable impossible moves. */
	isTop: boolean;
	isBottom: boolean;
	editComposite: () => void;
	duplicate: () => void;
	reorder: (action: BlockOrder) => void;
	remove: () => void;
}

/**
 * Menu of a block on the canvas. Offers "Edit composite" for composite instances – the quickest
 * way from a page to the composite it uses.
 *
 * @param options - State and callbacks, see {@link BlockMenuOptions}.
 * @returns Entries for {@link ContextMenu.show}.
 */
export function blockMenu(options: BlockMenuOptions): MenuEntryInput[] {
	return [
		options.compositeName !== undefined && {
			id: 'edit-composite',
			label: `Edit composite “${options.compositeName}”`,
			run: options.editComposite
		},
		options.compositeName !== undefined && separator,
		{ id: 'duplicate', label: 'Duplicate', shortcut: 'Ctrl+D', run: options.duplicate },
		separator,
		{
			id: 'bring-front',
			label: 'Bring to front',
			disabled: options.isTop,
			run: () => options.reorder('front')
		},
		{
			id: 'forward',
			label: 'Move forward',
			disabled: options.isTop,
			run: () => options.reorder('forward')
		},
		{
			id: 'backward',
			label: 'Move backward',
			disabled: options.isBottom,
			run: () => options.reorder('backward')
		},
		{
			id: 'send-back',
			label: 'Send to back',
			disabled: options.isBottom,
			run: () => options.reorder('back')
		},
		separator,
		{ id: 'delete', label: 'Delete', danger: true, shortcut: 'Del', run: options.remove }
	];
}

/** Callbacks and state for the canvas / toolbar area of the visual editor. */
export interface CanvasMenuOptions {
	/** Editing composites (`true`) or pages (`false`). */
	composing: boolean;
	previewing: boolean;
	canUndo: boolean;
	canRedo: boolean;
	/** Unsaved changes exist (or the database is missing) and the role may save. */
	canSave: boolean;
	/** The open document has no blocks to clear. */
	isEmpty: boolean;
	/** More than one composite exists, so deleting one is allowed. */
	canDeleteComposite: boolean;
	undo: () => void;
	redo: () => void;
	save: () => void;
	togglePreview: () => void;
	clear: () => void;
	newComposite: () => void;
	renameComposite: () => void;
	deleteComposite: () => void;
	/** Switches to the other editor (pages ↔ composites). */
	openOther: () => void;
}

/**
 * Menu of the canvas background and toolbar. In preview mode only the view / save / navigation
 * entries are shown, since nothing can be edited there.
 *
 * @param options - State and callbacks, see {@link CanvasMenuOptions}.
 * @returns Entries for {@link ContextMenu.show}.
 */
export function canvasMenu(options: CanvasMenuOptions): MenuEntryInput[] {
	const editing = !options.previewing;
	return [
		{
			id: 'undo',
			label: 'Undo',
			shortcut: 'Ctrl+Z',
			hidden: !editing,
			disabled: !options.canUndo,
			run: options.undo
		},
		{
			id: 'redo',
			label: 'Redo',
			shortcut: 'Ctrl+Y',
			hidden: !editing,
			disabled: !options.canRedo,
			run: options.redo
		},
		editing && separator,
		{ id: 'save', label: 'Save', disabled: !options.canSave, run: options.save },
		{
			id: 'toggle-preview',
			label: options.previewing ? 'Back to editor' : 'Preview',
			run: options.togglePreview
		},
		separator,
		options.composing &&
			editing && { id: 'new-composite', label: 'New composite…', run: options.newComposite },
		options.composing &&
			editing && {
				id: 'rename-composite',
				label: 'Rename composite…',
				run: options.renameComposite
			},
		options.composing &&
			editing && {
				id: 'delete-composite',
				label: 'Delete composite',
				danger: true,
				disabled: !options.canDeleteComposite,
				run: options.deleteComposite
			},
		options.composing && editing && separator,
		editing && {
			id: 'clear',
			label: options.composing ? 'Clear composite' : 'Clear page',
			danger: true,
			disabled: options.isEmpty,
			run: options.clear
		},
		editing && separator,
		{
			id: 'open-other',
			label: options.composing ? 'Open pages' : 'Open composites',
			run: options.openOther
		}
	];
}

/** Callbacks for an item of the component palette. */
export interface PaletteItemMenuOptions {
	/** Label of the component (e.g. `Alert`, `Testimonial`). */
	label: string;
	/** Name of the composite when the item is one (enables "Edit composite"). */
	compositeName?: string;
	/** Places the component on the open canvas without dragging (keyboard / trackpad friendly). */
	addToCanvas: () => void;
	editComposite: () => void;
}

/**
 * Menu of a palette item: a drag-free way to place it, and for composites a jump to the editor.
 *
 * @param options - State and callbacks, see {@link PaletteItemMenuOptions}.
 * @returns Entries for {@link ContextMenu.show}.
 */
export function paletteItemMenu(options: PaletteItemMenuOptions): MenuEntryInput[] {
	return [
		{ id: 'add', label: `Add ${options.label} to canvas`, run: options.addToCanvas },
		options.compositeName !== undefined && {
			id: 'edit-composite',
			label: `Edit composite “${options.compositeName}”`,
			run: options.editComposite
		}
	];
}

/** Callbacks and state for a project row of the Projects page. */
export interface ProjectItemMenuOptions {
	/** Display name, used in labels. */
	name: string;
	/** The project is already the active one (Open is then pointless). */
	isActive: boolean;
	/** Another project may be created (per-user limit not reached). */
	canDuplicate: boolean;
	/** The viewer may change projects (not a read-only guest). */
	canEdit: boolean;
	/** A SvelteKit folder is set, so its path can be copied. */
	hasPath: boolean;
	/** Makes the project active. */
	open: () => void;
	/** Makes the project active and opens its pages. */
	openPages: () => void;
	/** Makes the project active and opens the visual editor. */
	openEditor: () => void;
	/** Focuses the name field in the settings panel. */
	rename: () => void;
	duplicate: () => void;
	copyPath: () => void;
	/** Asks for the typed delete confirmation. */
	remove: () => void;
}

/**
 * Menu of a single project in the Projects list.
 *
 * @param options - State and callbacks, see {@link ProjectItemMenuOptions}.
 * @returns Entries for {@link ContextMenu.show}.
 */
export function projectItemMenu(options: ProjectItemMenuOptions): MenuEntryInput[] {
	return [
		{
			id: 'open',
			label: options.isActive ? `“${options.name}” is open` : `Open “${options.name}”`,
			disabled: options.isActive,
			run: options.open
		},
		{ id: 'open-pages', label: 'Open pages', run: options.openPages },
		{ id: 'open-editor', label: 'Open editor', run: options.openEditor },
		separator,
		{ id: 'rename', label: 'Rename…', disabled: !options.canEdit, run: options.rename },
		{
			id: 'duplicate',
			label: 'Duplicate',
			disabled: !options.canEdit || !options.canDuplicate,
			run: options.duplicate
		},
		{ id: 'copy-path', label: 'Copy folder path', hidden: !options.hasPath, run: options.copyPath },
		separator,
		{
			id: 'delete',
			label: 'Delete…',
			danger: true,
			disabled: !options.canEdit,
			run: options.remove
		}
	];
}

/** Callbacks and state for the background of the Projects list. */
export interface ProjectListMenuOptions {
	/** Another project may be created (per-user limit not reached) and the role may write. */
	canAdd: boolean;
	add: () => void;
	reload: () => void;
}

/**
 * Menu of the empty area of the Projects list: list-level actions.
 *
 * @param options - State and callbacks, see {@link ProjectListMenuOptions}.
 * @returns Entries for {@link ContextMenu.show}.
 */
export function projectListMenu(options: ProjectListMenuOptions): MenuEntryInput[] {
	return [
		{ id: 'new-project', label: 'New project…', disabled: !options.canAdd, run: options.add },
		{ id: 'reload', label: 'Reload projects', run: options.reload }
	];
}
