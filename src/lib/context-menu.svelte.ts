/**
 * @fileoverview Reactive controller of the app-wide right-click menu (`.svelte.ts` module).
 *
 * ## How it fits together
 * 1. The root layout creates **one** {@link ContextMenu}, publishes it with
 *    {@link provideContextMenu} and renders it with `components/ContextMenu.svelte`.
 * 2. Any component asks for it with {@link useContextMenu} (during init) and either
 *    - attaches a menu declaratively: `<li {@attach menu.attach(() => entries)}>`, or
 *    - calls `menu.show(event, entries)` from its own `oncontextmenu` handler.
 *    Entries are produced lazily at event time, so labels / `disabled` flags always reflect the
 *    current state.
 *
 * ## Nesting rule (context awareness)
 * Events bubble from the innermost element outwards. The first handler that shows a menu calls
 * `preventDefault()`; outer handlers see `event.defaultPrevented` and stay out of the way. So a
 * page row shows page actions, while the empty area around it shows the list actions – with no
 * coordination between the two components.
 *
 * ## Escape hatches (the native browser menu is kept when…)
 * - the target is an editable control or code editor ({@link wantsNativeMenu});
 * - the user holds **Shift** while right-clicking with the mouse;
 * - the builder returns no entries (nothing to offer here).
 *
 * One menu is open at a time; opening another replaces it.
 */

import { getContext, setContext } from 'svelte';
import type { Attachment } from 'svelte/attachments';
import {
	findByInitial,
	isAction,
	nextEnabledIndex,
	normalizeEntries,
	wantsNativeMenu,
	type MenuEntry,
	type MenuEntryInput
} from './context-menu.js';

/** Entries, or a function producing them at the moment the menu opens. */
export type MenuSource = readonly MenuEntryInput[] | (() => readonly MenuEntryInput[]);

/**
 * State and behaviour of the single context menu. The renderer only reads the reactive fields
 * and forwards user input to the methods.
 *
 * @example
 * const menu = useContextMenu();
 * // in markup:
 * // <li {@attach menu.attach(() => [{ id: 'edit', label: 'Edit', run: edit }])}>…</li>
 */
export class ContextMenu {
	/** Whether the menu is currently displayed. */
	open = $state(false);
	/** Requested anchor in viewport pixels (the renderer clamps it into the window). */
	x = $state(0);
	y = $state(0);
	/** Normalised entries of the open menu. */
	entries = $state.raw<MenuEntry[]>([]);
	/** Index of the keyboard-focused action, or `-1`. */
	activeIndex = $state(-1);

	/** Element that had focus when the menu opened; focus returns there on dismissal. */
	#opener: HTMLElement | null = null;

	/**
	 * Opens the menu for a `contextmenu` event.
	 *
	 * @param event - The event; its default (native menu) is prevented when a menu is shown.
	 * @param source - Entries, or a function returning them.
	 * @returns `true` when the custom menu was shown, `false` when the native menu is kept.
	 */
	show(event: MouseEvent, source: MenuSource): boolean {
		if (event.defaultPrevented) return false; // an inner element already handled it
		if (event.shiftKey && event.button === 2) return false; // Shift + right-click: native menu
		if (wantsNativeMenu(event.target)) return false;

		const entries = normalizeEntries(typeof source === 'function' ? source() : source);
		if (entries.length === 0) return false;

		let { clientX: x, clientY: y } = event;
		// Keyboard invocation (menu key / Shift+F10) may report 0,0: anchor to the focused element.
		if (x === 0 && y === 0 && event.target instanceof Element) {
			const box = event.target.getBoundingClientRect();
			x = box.left + Math.min(box.width, 24);
			y = box.top + Math.min(box.height, 24);
		}

		event.preventDefault();
		this.openAt(x, y, entries);
		return true;
	}

	/** Opens the menu at an explicit position with already-normalised entries. */
	openAt(x: number, y: number, entries: MenuEntry[]): void {
		this.#opener =
			typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		this.x = x;
		this.y = y;
		this.entries = entries;
		this.activeIndex = nextEnabledIndex(entries, -1, 1);
		this.open = true;
	}

	/**
	 * Closes the menu.
	 *
	 * @param restoreFocus - Return focus to the element focused before opening (keyboard
	 *   dismissal and after running an action). Pointer dismissal leaves focus where the user
	 *   clicked.
	 */
	close(restoreFocus = false): void {
		if (!this.open) return;
		this.open = false;
		this.entries = [];
		this.activeIndex = -1;
		const opener = this.#opener;
		this.#opener = null;
		if (restoreFocus && opener?.isConnected) opener.focus();
	}

	/** Moves the keyboard highlight to the next / previous enabled action (wrapping). */
	move(step: 1 | -1): void {
		this.activeIndex = nextEnabledIndex(
			this.entries,
			this.activeIndex < 0 ? (step === 1 ? -1 : 0) : this.activeIndex,
			step
		);
	}

	/** Moves the highlight to the first or last enabled action. */
	jump(edge: 'first' | 'last'): void {
		this.activeIndex =
			edge === 'first'
				? nextEnabledIndex(this.entries, -1, 1)
				: nextEnabledIndex(this.entries, this.entries.length, -1);
	}

	/** Type-ahead: highlights the next action starting with `char`. */
	typeAhead(char: string): void {
		const index = findByInitial(this.entries, this.activeIndex, char);
		if (index >= 0) this.activeIndex = index;
	}

	/** Highlights an action (pointer hover); ignored for disabled actions. */
	hover(index: number): void {
		const entry = this.entries[index];
		if (entry && isAction(entry) && !entry.disabled) this.activeIndex = index;
	}

	/**
	 * Runs an action: the menu closes first (restoring focus) so the action can freely move
	 * focus, navigate or open dialogs. Async failures are logged, never left unhandled.
	 *
	 * @param index - Index into {@link ContextMenu.entries}.
	 */
	activate(index: number): void {
		const entry = this.entries[index];
		if (!entry || !isAction(entry) || entry.disabled) return;
		this.close(true);
		void Promise.resolve()
			.then(entry.run)
			.catch((error: unknown) => console.error(`Context menu action "${entry.id}" failed`, error));
	}

	/**
	 * Svelte attachment that opens this menu on right-click of the element.
	 *
	 * @param source - Entries or a lazily evaluated builder (preferred: always current).
	 * @returns An attachment for `{@attach …}`.
	 */
	attach(source: MenuSource): Attachment<HTMLElement> {
		return (element) => {
			const handler = (event: MouseEvent) => void this.show(event, source);
			element.addEventListener('contextmenu', handler);
			return () => element.removeEventListener('contextmenu', handler);
		};
	}
}

const key = Symbol('context-menu');

/**
 * Publishes the menu to all descendants. Call once in the root layout, during init.
 *
 * @param menu - The controller instance to share.
 */
export function provideContextMenu(menu: ContextMenu): void {
	setContext(key, menu);
}

/**
 * Reads the shared menu. Must be called during component initialisation.
 *
 * @returns The controller created by the root layout.
 * @throws When no ancestor called {@link provideContextMenu}.
 */
export function useContextMenu(): ContextMenu {
	const menu = getContext<ContextMenu | undefined>(key);
	if (!menu) throw new Error('useContextMenu() needs <ContextMenu> mounted in an ancestor layout.');
	return menu;
}
