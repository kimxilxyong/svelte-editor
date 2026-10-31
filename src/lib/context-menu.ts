/**
 * @fileoverview Pure, framework-free building blocks of the app-wide right-click ("context")
 * menu: the entry types, normalisation of conditionally built entry lists, keyboard navigation
 * and viewport placement.
 *
 * ## Role in the architecture
 * - `context-menu.svelte.ts` holds the reactive {@link ContextMenu} controller class that uses
 *   these helpers.
 * - `components/ContextMenu.svelte` renders the controller state (mounted once in the root
 *   layout).
 * - `editor-menus.ts` builds the actual page / composite / block entries.
 *
 * Everything here is deterministic and DOM-free so it can be unit-tested in Node.
 *
 * ## Conventions
 * - Coordinates are viewport (`clientX` / `clientY`) pixels.
 * - An entry list may contain `false`, `null` or `undefined` so callers can write
 *   `condition && { … }`; {@link normalizeEntries} drops them.
 */

/** A clickable menu item. */
export interface MenuAction {
	/** Stable identifier (used by tests and for `data-action`). */
	id: string;
	/** Visible text. Its first letter doubles as the type-ahead key. */
	label: string;
	/** Executed after the menu has closed. The return value is ignored; if it is a promise, rejections are logged, not thrown. */
	run: () => unknown;
	/** Visible but not activatable (greyed out, skipped by the keyboard). */
	disabled?: boolean;
	/** Destructive action – rendered in the danger colour. */
	danger?: boolean;
	/** Hint such as `Ctrl+D`. Display only; the shortcut itself is handled elsewhere. */
	shortcut?: string;
	/** Dropped from the menu entirely (useful for role / mode dependent items). */
	hidden?: boolean;
}

/** A horizontal divider between groups of items. */
export interface MenuSeparator {
	separator: true;
}

/** Entry in a finished menu. */
export type MenuEntry = MenuAction | MenuSeparator;

/** Entry as written by callers, where "no item" values are allowed. */
export type MenuEntryInput = MenuEntry | false | null | undefined;

/** Shorthand for the divider entry. */
export const separator: MenuSeparator = { separator: true };

/**
 * Type guard distinguishing actions from separators.
 *
 * @param entry - Entry to test.
 * @returns `true` when the entry is a clickable {@link MenuAction}.
 */
export function isAction(entry: MenuEntry): entry is MenuAction {
	return !('separator' in entry);
}

/**
 * Turns a caller-supplied list into a displayable one: removes falsy and `hidden` entries, then
 * collapses leading, trailing and consecutive separators (which appear when whole groups are
 * hidden).
 *
 * @param input - Entries as written by the caller.
 * @returns Clean entries; empty when nothing actionable is left.
 * @example
 * normalizeEntries([separator, a, separator, separator, false, b, separator]); // [a, separator, b]
 */
export function normalizeEntries(input: readonly MenuEntryInput[]): MenuEntry[] {
	const visible = input.filter(
		(entry): entry is MenuEntry => !!entry && (!isAction(entry) || !entry.hidden)
	);
	const result: MenuEntry[] = [];
	for (const entry of visible) {
		if (!isAction(entry) && (result.length === 0 || !isAction(result[result.length - 1]))) continue;
		result.push(entry);
	}
	while (result.length > 0 && !isAction(result[result.length - 1])) result.pop();
	return result.some(isAction) ? result : [];
}

/**
 * Finds the next activatable entry, wrapping around the ends.
 *
 * @param entries - Normalised entries.
 * @param from - Index to start from (use `-1` before the first or `entries.length` after the last).
 * @param step - `1` for forwards, `-1` for backwards.
 * @returns Index of an enabled action, or `-1` when none exists.
 */
export function nextEnabledIndex(
	entries: readonly MenuEntry[],
	from: number,
	step: 1 | -1
): number {
	const count = entries.length;
	for (let offset = 1; offset <= count; offset++) {
		const index = (((from + step * offset) % count) + count) % count;
		const entry = entries[index];
		if (isAction(entry) && !entry.disabled) return index;
	}
	return -1;
}

/**
 * Type-ahead: finds the next enabled action whose label starts with `char`, searching after
 * `from` and wrapping around.
 *
 * @param entries - Normalised entries.
 * @param from - Currently active index (`-1` when none).
 * @param char - Typed character (case-insensitive).
 * @returns Matching index or `-1`.
 */
export function findByInitial(entries: readonly MenuEntry[], from: number, char: string): number {
	const needle = char.toLowerCase();
	const count = entries.length;
	for (let offset = 1; offset <= count; offset++) {
		const index = (((from + offset) % count) + count) % count;
		const entry = entries[index];
		if (isAction(entry) && !entry.disabled && entry.label.toLowerCase().startsWith(needle)) {
			return index;
		}
	}
	return -1;
}

/** Viewport pixels kept free between the menu and the window edge. */
export const viewportMargin = 8;

/**
 * Chooses the top-left corner of a menu opened at `(x, y)` so it stays fully inside the
 * viewport: it flips to the left of / above the pointer when it would overflow and finally
 * clamps to the margin for menus larger than the window.
 *
 * @param x - Pointer X in viewport pixels.
 * @param y - Pointer Y in viewport pixels.
 * @param width - Measured menu width.
 * @param height - Measured menu height.
 * @param viewportWidth - Window inner width.
 * @param viewportHeight - Window inner height.
 * @returns Position for `left` / `top`.
 */
export function placeMenu(
	x: number,
	y: number,
	width: number,
	height: number,
	viewportWidth: number,
	viewportHeight: number
): { left: number; top: number } {
	const place = (point: number, size: number, limit: number) => {
		const start = point + size + viewportMargin > limit ? point - size : point;
		return Math.max(viewportMargin, Math.min(start, limit - size - viewportMargin));
	};
	return { left: place(x, width, viewportWidth), top: place(y, height, viewportHeight) };
}

/**
 * Whether the browser's own context menu must be kept: editable text controls need their
 * Cut / Copy / Paste / spell-check menu.
 *
 * @param target - Event target (may be `null` or a non-element node).
 * @returns `true` for inputs, textareas, selects and content-editable elements.
 */
export function wantsNativeMenu(target: EventTarget | null): boolean {
	if (!target || typeof (target as Element).closest !== 'function') return false;
	const element = target as HTMLElement;
	if (element.isContentEditable) return true;
	return element.closest('input, textarea, select, [contenteditable="true"], .cm-editor') !== null;
}
