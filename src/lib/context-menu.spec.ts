/**
 * @fileoverview Unit tests for the pure context-menu helpers and the menu builders: entry
 * normalisation, keyboard navigation, viewport placement and which entries each menu offers,
 * enables, hides or marks dangerous in which situation.
 */
import { describe, expect, it, vi } from 'vitest';
import {
	findByInitial,
	isAction,
	nextEnabledIndex,
	normalizeEntries,
	placeMenu,
	separator,
	viewportMargin,
	type MenuAction,
	type MenuEntry,
	type MenuEntryInput
} from './context-menu.js';
import {
	blockMenu,
	canvasMenu,
	pageItemMenu,
	pageListMenu,
	pagePreviewMenu,
	paletteItemMenu
} from './editor-menus.js';

const run = () => {};
const item = (id: string, extra: Partial<MenuAction> = {}): MenuAction => ({
	id,
	label: id,
	run,
	...extra
});

/** Normalises and returns ids, with `-` for separators. */
const shape = (input: MenuEntryInput[]) =>
	normalizeEntries(input).map((entry) => (isAction(entry) ? entry.id : '-'));

describe('normalizeEntries', () => {
	it('drops falsy and hidden entries', () => {
		expect(shape([item('a'), false, null, undefined, item('b', { hidden: true })])).toEqual(['a']);
	});

	it('collapses leading, trailing and doubled separators', () => {
		expect(shape([separator, item('a'), separator, separator, item('b'), separator])).toEqual([
			'a',
			'-',
			'b'
		]);
	});

	it('removes a separator left alone by a hidden group', () => {
		expect(
			shape([item('a'), separator, item('x', { hidden: true }), separator, item('b')])
		).toEqual(['a', '-', 'b']);
	});

	it('returns nothing when no action remains', () => {
		expect(normalizeEntries([separator, item('a', { hidden: true })])).toEqual([]);
	});
});

describe('keyboard navigation', () => {
	const entries: MenuEntry[] = [
		item('copy'),
		separator,
		item('cut', { disabled: true }),
		item('delete'),
		item('paste')
	];

	it('skips separators and disabled items, wrapping around', () => {
		expect(nextEnabledIndex(entries, -1, 1)).toBe(0);
		expect(nextEnabledIndex(entries, 0, 1)).toBe(3);
		expect(nextEnabledIndex(entries, 4, 1)).toBe(0);
		expect(nextEnabledIndex(entries, 0, -1)).toBe(4);
		expect(nextEnabledIndex(entries, entries.length, -1)).toBe(4);
	});

	it('reports -1 when nothing is enabled', () => {
		expect(nextEnabledIndex([item('a', { disabled: true })], -1, 1)).toBe(-1);
	});

	it('finds the next label by initial letter, ignoring case and disabled items', () => {
		expect(findByInitial(entries, 0, 'D')).toBe(3);
		expect(findByInitial(entries, 0, 'c')).toBe(0); // wraps back to "copy"
		expect(findByInitial(entries, 0, 'x')).toBe(-1);
		expect(findByInitial(entries, -1, 'u')).toBe(-1); // "cut" is disabled and starts with "c"
	});
});

describe('placeMenu', () => {
	it('keeps the pointer position when the menu fits', () => {
		expect(placeMenu(100, 120, 200, 150, 1000, 800)).toEqual({ left: 100, top: 120 });
	});

	it('flips to the left of / above the pointer near the right and bottom edges', () => {
		expect(placeMenu(950, 780, 200, 150, 1000, 800)).toEqual({ left: 750, top: 630 });
	});

	it('clamps menus bigger than the window to the margin', () => {
		expect(placeMenu(10, 10, 2000, 2000, 500, 400)).toEqual({
			left: viewportMargin,
			top: viewportMargin
		});
	});
});

describe('page menus', () => {
	const options = {
		name: 'About',
		canDuplicate: true,
		canDelete: true,
		edit: run,
		preview: run,
		duplicate: run,
		remove: run,
		copyRoute: run
	};

	it('offers the page actions and marks Delete as dangerous', () => {
		const entries = normalizeEntries(pageItemMenu(options)).filter(isAction);
		expect(entries.map((entry) => entry.id)).toEqual([
			'edit',
			'preview',
			'duplicate',
			'copy-route',
			'delete'
		]);
		expect(entries[0].label).toBe('Edit “About”');
		expect(entries.at(-1)?.danger).toBe(true);
	});

	it('disables Delete for the last page and Duplicate at the page limit', () => {
		const entries = normalizeEntries(
			pageItemMenu({ ...options, canDelete: false, canDuplicate: false })
		).filter(isAction);
		const disabled = entries.filter((entry) => entry.disabled).map((entry) => entry.id);
		expect(disabled).toEqual(['duplicate', 'delete']);
	});

	it('enables Save in the list menu only when there is something to save', () => {
		const base = { canAdd: true, add: run, save: run, reload: run, openComposites: run };
		const save = (canSave: boolean) =>
			normalizeEntries(pageListMenu({ ...base, canSave }))
				.filter(isAction)
				.find((entry) => entry.id === 'save');
		expect(save(true)?.disabled).toBe(false);
		expect(save(false)?.disabled).toBe(true);
	});

	it('hides "Edit this page" while previewing', () => {
		const base = { canSave: false, edit: run, togglePreview: run, save: run };
		expect(shape(pagePreviewMenu({ ...base, previewing: false }))).toContain('edit');
		const previewing = shape(pagePreviewMenu({ ...base, previewing: true }));
		expect(previewing).not.toContain('edit');
		expect(previewing).toContain('toggle-preview');
	});
});

describe('editor menus', () => {
	const blockBase = {
		isTop: false,
		isBottom: false,
		editComposite: run,
		duplicate: run,
		reorder: run,
		remove: run
	};

	it('offers "Edit composite" first for composite instances only', () => {
		expect(shape(blockMenu(blockBase))[0]).toBe('duplicate');
		const instance = normalizeEntries(blockMenu({ ...blockBase, compositeName: 'Hero' }));
		const first = instance[0] as MenuAction;
		expect(first.id).toBe('edit-composite');
		expect(first.label).toBe('Edit composite “Hero”');
	});

	it('disables impossible layer moves', () => {
		const ids = (options: { isTop: boolean; isBottom: boolean }) =>
			normalizeEntries(blockMenu({ ...blockBase, ...options }))
				.filter(isAction)
				.filter((entry) => entry.disabled)
				.map((entry) => entry.id);
		expect(ids({ isTop: true, isBottom: false })).toEqual(['bring-front', 'forward']);
		expect(ids({ isTop: false, isBottom: true })).toEqual(['backward', 'send-back']);
	});

	it('reorders through the callback with the matching action', () => {
		const reorder = vi.fn();
		const entries = normalizeEntries(blockMenu({ ...blockBase, reorder })).filter(isAction);
		entries.find((entry) => entry.id === 'send-back')?.run();
		entries.find((entry) => entry.id === 'bring-front')?.run();
		expect(reorder.mock.calls).toEqual([['back'], ['front']]);
	});

	const canvasBase = {
		composing: false,
		previewing: false,
		canUndo: true,
		canRedo: false,
		canSave: true,
		isEmpty: false,
		canDeleteComposite: true,
		undo: run,
		redo: run,
		save: run,
		togglePreview: run,
		clear: run,
		newComposite: run,
		renameComposite: run,
		deleteComposite: run,
		openOther: run
	};

	it('shows composite management only when editing composites', () => {
		expect(shape(canvasMenu(canvasBase))).not.toContain('new-composite');
		const composing = shape(canvasMenu({ ...canvasBase, composing: true }));
		expect(composing).toEqual(
			expect.arrayContaining(['new-composite', 'rename-composite', 'delete-composite'])
		);
	});

	it('limits the menu to view / save / navigation in preview', () => {
		expect(shape(canvasMenu({ ...canvasBase, previewing: true }))).toEqual([
			'save',
			'toggle-preview',
			'-',
			'open-other'
		]);
	});

	it('guards destructive actions: last composite and empty canvas', () => {
		const entries = normalizeEntries(
			canvasMenu({ ...canvasBase, composing: true, canDeleteComposite: false, isEmpty: true })
		).filter(isAction);
		const disabled = entries.filter((entry) => entry.disabled).map((entry) => entry.id);
		expect(disabled).toEqual(expect.arrayContaining(['redo', 'delete-composite', 'clear']));
		expect(disabled).not.toContain('undo');
	});

	it('points "Open other" at the opposite editor', () => {
		const label = (composing: boolean) =>
			(
				normalizeEntries(canvasMenu({ ...canvasBase, composing }))
					.filter(isAction)
					.find((entry) => entry.id === 'open-other') as MenuAction
			).label;
		expect(label(false)).toBe('Open composites');
		expect(label(true)).toBe('Open pages');
	});

	it('palette items can be added, composites can also be edited', () => {
		const base = { label: 'Alert', addToCanvas: run, editComposite: run };
		expect(shape(paletteItemMenu(base))).toEqual(['add']);
		expect(shape(paletteItemMenu({ ...base, compositeName: 'Hero' }))).toEqual([
			'add',
			'edit-composite'
		]);
	});
});
