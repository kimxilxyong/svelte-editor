/**
 * @fileoverview Browser tests of the right-click menu in a real DOM: opening, nesting
 * (most specific target wins), native-menu escape hatches, keyboard operation, dismissal and
 * action execution.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import ContextMenuHarness from './testing/ContextMenuHarness.svelte';

/** Dispatches a right-button `contextmenu` event; returns whether the default was prevented. */
function rightClick(element: Element, init: MouseEventInit = {}): boolean {
	const box = element.getBoundingClientRect();
	const event = new MouseEvent('contextmenu', {
		bubbles: true,
		cancelable: true,
		button: 2,
		clientX: box.left + 5,
		clientY: box.top + 5,
		...init
	});
	element.dispatchEvent(event);
	return event.defaultPrevented;
}

const menuItems = () => [...document.querySelectorAll('[role="menuitem"]')];
const labels = () => menuItems().map((item) => item.textContent?.trim());

describe('ContextMenu', () => {
	it('opens the most specific menu and suppresses the native one', async () => {
		render(ContextMenuHarness);
		const prevented = rightClick(page.getByTestId('row').element());
		expect(prevented).toBe(true);
		await expect.poll(labels).toEqual(['Edit', 'Delete']);
		expect(document.querySelector('[role="separator"]')).not.toBeNull();
		expect(document.querySelector('[data-action="delete"]')?.classList.contains('danger')).toBe(
			true
		);
	});

	it('falls back to the outer menu on the surrounding area', async () => {
		render(ContextMenuHarness);
		rightClick(page.getByTestId('list').element());
		await expect.poll(labels).toEqual(['Add', 'Save']);
		expect(document.querySelector('[data-action="save"]')?.getAttribute('aria-disabled')).toBe(
			'true'
		);
	});

	it('keeps the native menu for text fields, Shift+right-click and empty menus', async () => {
		render(ContextMenuHarness);
		expect(rightClick(page.getByTestId('field').element())).toBe(false);
		expect(rightClick(page.getByTestId('row').element(), { shiftKey: true })).toBe(false);
		expect(rightClick(page.getByTestId('empty').element())).toBe(true); // outer list still offers
		await expect.poll(() => document.querySelector('[role="menu"]')).not.toBeNull();
	});

	it('keeps the menu inside the viewport', async () => {
		render(ContextMenuHarness);
		rightClick(page.getByTestId('row').element(), {
			clientX: innerWidth - 2,
			clientY: innerHeight - 2
		});
		await expect.poll(() => document.querySelector('[role="menu"]')).not.toBeNull();
		await expect
			.poll(() => {
				const box = document.querySelector('[role="menu"]')!.getBoundingClientRect();
				return box.right <= innerWidth && box.bottom <= innerHeight && box.left >= 0;
			})
			.toBe(true);
	});

	it('runs the clicked action once and closes', async () => {
		const log: string[] = [];
		render(ContextMenuHarness, { log });
		rightClick(page.getByTestId('row').element());
		await expect.poll(menuItems).toHaveLength(2);
		await page.getByRole('menuitem', { name: 'Edit' }).click();
		await expect.poll(() => log).toEqual(['edit']);
		expect(document.querySelector('[role="menu"]')).toBeNull();
	});

	it('does not run disabled actions', async () => {
		const log: string[] = [];
		render(ContextMenuHarness, { log });
		rightClick(page.getByTestId('list').element());
		await expect.poll(menuItems).toHaveLength(2);
		(document.querySelector('[data-action="save"]') as HTMLElement).click();
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(log).toEqual([]);
		expect(document.querySelector('[role="menu"]')).not.toBeNull();
	});

	it('supports arrow keys, Enter, Escape and returns focus to the opener', async () => {
		const log: string[] = [];
		render(ContextMenuHarness, { log });
		const row = page.getByTestId('row').element() as HTMLElement;
		row.focus();
		rightClick(row);
		await expect.poll(() => document.activeElement?.getAttribute('data-action')).toBe('edit');

		await userEvent.keyboard('{ArrowDown}');
		await expect.poll(() => document.activeElement?.getAttribute('data-action')).toBe('delete');
		await userEvent.keyboard('{ArrowDown}'); // wraps
		await expect.poll(() => document.activeElement?.getAttribute('data-action')).toBe('edit');

		await userEvent.keyboard('d'); // type-ahead
		await expect.poll(() => document.activeElement?.getAttribute('data-action')).toBe('delete');

		await userEvent.keyboard('{Escape}');
		expect(document.querySelector('[role="menu"]')).toBeNull();
		expect(document.activeElement).toBe(row);
		expect(log).toEqual([]);

		rightClick(row);
		await expect.poll(menuItems).toHaveLength(2);
		await userEvent.keyboard('{Enter}');
		await expect.poll(() => log).toEqual(['edit']);
	});

	it('closes on an outside click', async () => {
		render(ContextMenuHarness);
		rightClick(page.getByTestId('row').element());
		await expect.poll(menuItems).toHaveLength(2);
		document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull();
	});
});
