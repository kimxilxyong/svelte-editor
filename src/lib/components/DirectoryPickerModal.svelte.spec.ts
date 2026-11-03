/**
 * @fileoverview Real-browser regression coverage for explicit-only directory picker
 * dismissal, native dialog focus behavior, canonical folder creation, operation gating,
 * close/reopen isolation, and viewport centering under the app's global Tailwind reset.
 * Fetch is mocked; no server files or routes are changed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import DirectoryPickerModal from './DirectoryPickerModal.svelte';
import '../../routes/layout.css';

/** Builds a canonical directory response with a navigable child at every level. */
function listing(path: string) {
	return {
		current: path,
		parent: path === '/' ? null : path.substring(0, path.lastIndexOf('/')) || '/',
		home: '/home/test',
		isSvelteKit: false,
		isEmpty: false,
		directories: [{ name: 'child', path: `${path === '/' ? '' : path}/child`, isSvelteKit: false }]
	};
}

/** Creates JSON responses for either GET listings or POST results/errors. */
function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

/** Controllable network completion; intentionally ignores AbortSignal to exercise stale guards. */
function deferred() {
	let resolve!: (response: Response) => void;
	const promise = new Promise<Response>((done) => (resolve = done));
	return { promise, resolve };
}

/** Returns a fetch mock that canonicalizes each requested directory. */
function mockListings() {
	const fetcher = vi.fn(async (input: RequestInfo | URL) => {
		const path =
			new URL(String(input), location.origin).searchParams.get('path') || '/work/project';
		return json(listing(path));
	});
	vi.stubGlobal('fetch', fetcher);
	return fetcher;
}

/** Reads the visible canonical selection preview rather than any breadcrumb label. */
const selectedPath = () => document.querySelector('.selected-preview code')?.textContent;
const dialog = () => document.querySelector('dialog') as HTMLDialogElement | null;
const select = () => page.getByRole('button', { name: 'Select this folder' });
const root = () => page.getByRole('button', { name: '/', exact: true });

/** Checks the rendered border-box center against both viewport axes, allowing subpixel rounding. */
function expectCentered() {
	const box = dialog()!.getBoundingClientRect();
	expect(Math.abs(box.left + box.width / 2 - innerWidth / 2)).toBeLessThanOrEqual(1);
	expect(Math.abs(box.top + box.height / 2 - innerHeight / 2)).toBeLessThanOrEqual(1);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('DirectoryPickerModal', () => {
	it('centers in the desktop viewport before and after opening folder creation', async () => {
		await page.viewport(1280, 720);
		mockListings();
		await render(DirectoryPickerModal, {
			open: true,
			onclose: vi.fn(),
			onselect: vi.fn()
		});
		await expect.element(select()).toBeEnabled();
		expectCentered();
		await page.getByRole('button', { name: 'Create new folder' }).click();
		expectCentered();
	});

	it('keeps folder, up, root, home, breadcrumb, outside clicks and Escape open without callbacks', async () => {
		const fetcher = mockListings();
		const onclose = vi.fn();
		const onselect = vi.fn();
		await render(DirectoryPickerModal, {
			open: true,
			initialPath: '/work/project',
			onclose,
			onselect
		});
		await expect.poll(selectedPath).toBe('/work/project');
		await page.getByRole('button', { name: 'child', exact: true }).click();
		await expect.poll(selectedPath).toBe('/work/project/child');
		await page.getByRole('button', { name: '↑ Up' }).click();
		await expect.poll(selectedPath).toBe('/work/project');
		await page.getByRole('button', { name: 'work', exact: true }).click();
		await expect.poll(selectedPath).toBe('/work');
		await root().click();
		await expect.poll(selectedPath).toBe('/');
		await page.getByRole('button', { name: '~', exact: true }).click();
		await expect.poll(selectedPath).toBe('/home/test');
		// Real pointer click outside the centered window lands on the native backdrop.
		await page.getByRole('dialog').click({ position: { x: -8, y: -8 }, force: true });
		await userEvent.keyboard('{Escape}');
		expect(dialog()?.open).toBe(true);
		expect(onclose).not.toHaveBeenCalled();
		expect(onselect).not.toHaveBeenCalled();
		expect(fetcher).toHaveBeenCalledTimes(6); // Exactly one GET per navigation, not per result.
		expect(document.querySelector('[aria-label="Close"]')).toBeNull();
	});

	it('only Select confirms the canonical path; Cancel closes without selecting', async () => {
		mockListings();
		const onclose = vi.fn();
		const onselect = vi.fn();
		const view = await render(DirectoryPickerModal, { open: true, onclose, onselect });
		await expect.element(select()).toBeEnabled();
		await select().click();
		expect(onselect).toHaveBeenCalledExactlyOnceWith('/work/project');
		expect(onclose).toHaveBeenCalledTimes(1);
		expect(onselect.mock.invocationCallOrder[0]).toBeLessThan(onclose.mock.invocationCallOrder[0]);
		await view.rerender({ open: false });
		await view.rerender({ open: true });
		await page.getByRole('button', { name: 'Cancel', exact: true }).click();
		expect(onclose).toHaveBeenCalledTimes(2);
		expect(onselect).toHaveBeenCalledTimes(1);
	});

	it('traps keyboard focus and restores it to the opener on parent dismissal', async () => {
		mockListings();
		const opener = document.createElement('button');
		opener.textContent = 'Open picker';
		document.body.append(opener);
		opener.focus();
		try {
			const view = await render(DirectoryPickerModal, {
				open: true,
				onclose: vi.fn(),
				onselect: vi.fn()
			});
			await expect.element(select()).toBeEnabled();
			(select().element() as HTMLElement).focus();
			await userEvent.keyboard('{Tab}');
			await userEvent.keyboard('{Tab}');
			expect(dialog()?.contains(document.activeElement)).toBe(true);
			await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
			expect(dialog()?.contains(document.activeElement)).toBe(true);
			await view.rerender({ open: false });
			expect(document.activeElement).toBe(opener);
		} finally {
			opener.remove();
		}
	});

	it('creates with Enter, gates navigation and selection, then browses the canonical child without closing', async () => {
		const fetcher = mockListings();
		const pending = deferred();
		const childListing = deferred();
		const onclose = vi.fn();
		const onselect = vi.fn();
		await render(DirectoryPickerModal, { open: true, onclose, onselect });
		await expect.element(select()).toBeEnabled();
		await page.getByRole('button', { name: 'Create new folder' }).click();
		await page.getByRole('textbox', { name: 'Folder name' }).fill('new project');
		fetcher.mockImplementationOnce(() => pending.promise);
		await userEvent.keyboard('{Enter}');
		await expect.element(root()).toBeDisabled();
		await expect.element(select()).toBeDisabled();
		await expect.element(page.getByRole('textbox', { name: 'Folder name' })).toBeDisabled();
		await expect.element(page.getByRole('button', { name: 'Creating…' })).toBeDisabled();
		(
			page.getByRole('button', { name: 'child', exact: true }).element() as HTMLButtonElement
		).click();
		expect(fetcher).toHaveBeenCalledTimes(2);
		const [url, options] = fetcher.mock.calls[1] as unknown as [string, RequestInit];
		expect(url).toBe('/editor/api/fs');
		expect(options.method).toBe('POST');
		expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
		expect(JSON.parse(String(options.body))).toEqual({
			path: '/work/project',
			name: 'new project'
		});
		fetcher.mockImplementationOnce(() => childListing.promise);
		pending.resolve(json({ path: '/work/project/new project' }, 201));
		await expect.poll(selectedPath).toBe('/work/project/new project');
		await expect.element(select()).toBeDisabled();
		childListing.resolve(json(listing('/work/project/new project')));
		await expect.element(select()).toBeEnabled();
		expect(fetcher).toHaveBeenCalledTimes(3);
		expect(String(fetcher.mock.calls[2][0])).toBe(
			'/editor/api/fs?path=%2Fwork%2Fproject%2Fnew%20project'
		);
		expect(dialog()?.open).toBe(true);
		expect(onclose).not.toHaveBeenCalled();
		expect(onselect).not.toHaveBeenCalled();
		await select().click();
		expect(onselect).toHaveBeenCalledExactlyOnceWith('/work/project/new project');
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	it('shows creation errors inline, keeps the form open and permits retry without selecting', async () => {
		const fetcher = mockListings();
		const onclose = vi.fn();
		const onselect = vi.fn();
		await render(DirectoryPickerModal, { open: true, onclose, onselect });
		await expect.element(select()).toBeEnabled();
		await page.getByRole('button', { name: 'Create new folder' }).click();
		await page.getByRole('textbox', { name: 'Folder name' }).fill('../invalid');
		await page.getByRole('button', { name: 'Create folder', exact: true }).click();
		await expect.element(page.getByRole('alert')).toHaveTextContent('Enter a single folder name');
		expect(fetcher).toHaveBeenCalledTimes(1);
		await page.getByRole('textbox', { name: 'Folder name' }).fill('existing');
		fetcher.mockImplementationOnce(async () => json({ error: 'A folder already exists' }, 409));
		await page.getByRole('button', { name: 'Create folder', exact: true }).click();
		await expect.element(page.getByRole('alert')).toHaveTextContent('A folder already exists');
		await expect
			.element(page.getByRole('button', { name: 'Create folder', exact: true }))
			.toBeEnabled();
		expect(selectedPath()).toBe('/work/project');
		expect(dialog()?.open).toBe(true);
		expect(onclose).not.toHaveBeenCalled();
		expect(onselect).not.toHaveBeenCalled();
	});

	it('loads only on open transitions and ignores stale listing responses across close/reopen', async () => {
		const pending = deferred();
		const fetcher = mockListings();
		const view = await render(DirectoryPickerModal, {
			open: false,
			initialPath: '/first',
			onclose: vi.fn(),
			onselect: vi.fn()
		});
		expect(fetcher).not.toHaveBeenCalled();
		fetcher.mockImplementationOnce(() => pending.promise);
		await view.rerender({ open: true });
		await expect.element(root()).toBeDisabled();
		await expect.element(select()).toBeDisabled();
		await expect.element(page.getByRole('button', { name: 'Create new folder' })).toBeDisabled();
		await view.rerender({ initialPath: '/second' });
		expect(fetcher).toHaveBeenCalledTimes(1);
		const signal = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].signal;
		await view.rerender({ open: false });
		expect(signal?.aborted).toBe(true);
		await view.rerender({ open: true });
		await expect.poll(selectedPath).toBe('/second');
		pending.resolve(json(listing('/stale')));
		await pending.promise;
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(selectedPath()).toBe('/second');
		expect(fetcher).toHaveBeenCalledTimes(2);
		await view.rerender({ open: false });
		await view.rerender({ open: true });
		await expect.element(select()).toBeEnabled();
		expect(String(fetcher.mock.calls[2][0])).toBe('/editor/api/fs?path=%2Fsecond');
		expect(fetcher).toHaveBeenCalledTimes(3);
	});

	it('ignores stale creation success after close/reopen and does not clear a new operation', async () => {
		const fetcher = mockListings();
		const creation = deferred();
		const reopened = deferred();
		const view = await render(DirectoryPickerModal, {
			open: true,
			onclose: vi.fn(),
			onselect: vi.fn()
		});
		await expect.element(select()).toBeEnabled();
		await page.getByRole('button', { name: 'Create new folder' }).click();
		await page.getByRole('textbox', { name: 'Folder name' }).fill('old');
		fetcher.mockImplementationOnce(() => creation.promise);
		await page.getByRole('button', { name: 'Create folder', exact: true }).click();
		await page.getByRole('button', { name: 'Cancel', exact: true }).click();
		await view.rerender({ open: false });
		fetcher.mockImplementationOnce(() => reopened.promise);
		await view.rerender({ open: true });
		creation.resolve(json({ path: '/work/project/old' }, 201));
		await creation.promise;
		await new Promise((resolve) => setTimeout(resolve, 30));
		await expect.element(select()).toBeDisabled();
		expect(selectedPath()).toBe('/work/project');
		expect(fetcher).toHaveBeenCalledTimes(3);
		reopened.resolve(json(listing('/work/project')));
		await expect.element(select()).toBeEnabled();
	});

	it('fits a narrow viewport with long paths and the inline creation form', async () => {
		await page.viewport(360, 640);
		mockListings();
		try {
			await render(DirectoryPickerModal, {
				open: true,
				initialPath: `/work/${'long-folder-name-'.repeat(12)}`,
				onclose: vi.fn(),
				onselect: vi.fn()
			});
			await expect.element(select()).toBeEnabled();
			expectCentered();
			await page.getByRole('button', { name: 'Create new folder' }).click();
			expectCentered();
			const modal = dialog()!;
			const box = modal.getBoundingClientRect();
			expect(box.left).toBeGreaterThanOrEqual(0);
			expect(box.right).toBeLessThanOrEqual(innerWidth);
			expect(box.bottom).toBeLessThanOrEqual(innerHeight);
			expect(modal.scrollWidth).toBeLessThanOrEqual(modal.clientWidth + 1);
			await expect.element(select()).toBeVisible();
			await expect.element(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
		} finally {
			await page.viewport(1280, 720);
		}
	});
});
