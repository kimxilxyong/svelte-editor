/**
 * @fileoverview Visual coverage for the editor canvas: the preview scales the page to the
 * available width (like the pages route) and every resize handle - edges included - shows its
 * resize cursor when hovered.
 */
import { expect, test } from '@playwright/test';

test('editor preview fits the stage without horizontal scrolling', async ({ page }) => {
	await page.setViewportSize({ width: 1400, height: 900 });
	await page.goto('/editor');
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await page.getByRole('button', { name: 'Preview', exact: true }).click();

	const canvas = page.locator('.page-canvas.preview');
	await expect(canvas).toBeVisible();
	const geometry = await page.evaluate(() => {
		const stage = document.querySelector<HTMLElement>('.canvas-stage')!;
		const canvas = document.querySelector<HTMLElement>('.page-canvas')!;
		const s = stage.getBoundingClientRect();
		const c = canvas.getBoundingClientRect();
		return {
			stageRight: s.right,
			canvasLeft: c.left,
			canvasRight: c.right,
			scrolls: stage.scrollWidth > stage.clientWidth
		};
	});
	expect(geometry.scrolls).toBe(false);
	expect(geometry.canvasRight).toBeLessThanOrEqual(geometry.stageRight);
	// The scaled page uses (nearly) the whole stage width.
	expect(geometry.canvasRight - geometry.canvasLeft).toBeGreaterThan(900);
	await expect(page.locator('.canvas-stage')).toHaveScreenshot('editor-preview-fit.png', {
		maxDiffPixelRatio: 0.02
	});
});

test('all resize handles expose their resize cursor over the whole edge', async ({ page }) => {
	await page.setViewportSize({ width: 1400, height: 900 });
	await page.goto('/editor');
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await page
		.locator('article.canvas-block')
		.first()
		.click({ position: { x: 100, y: 50 } });
	await expect(page.locator('.frame-handle')).toHaveCount(8);

	const expected: Record<string, string> = {
		n: 'ns-resize',
		s: 'ns-resize',
		e: 'ew-resize',
		w: 'ew-resize',
		nw: 'nwse-resize',
		se: 'nwse-resize',
		ne: 'nesw-resize',
		sw: 'nesw-resize'
	};
	for (const [dir, cursor] of Object.entries(expected)) {
		const box = await page.locator(`.handle-${dir}`).boundingBox();
		if (!box) throw new Error(`Handle ${dir} is not visible.`);
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		const actual = await page.evaluate(
			([x, y]) => {
				const el = document.elementFromPoint(x, y);
				return el ? getComputedStyle(el).cursor : '';
			},
			[box.x + box.width / 2, box.y + box.height / 2]
		);
		expect(actual, `cursor over ${dir}`).toBe(cursor);
	}

	// Away from the square, but still on the left edge: the strip keeps the resize cursor.
	const west = await page.locator('.handle-w').boundingBox();
	const block = await page.locator('article.canvas-block.selected').boundingBox();
	if (!west || !block) throw new Error('Selection geometry missing.');
	const edgeCursor = await page.evaluate(
		([x, y]) => getComputedStyle(document.elementFromPoint(x, y)!).cursor,
		[block.x + 1, block.y + block.height * 0.3]
	);
	expect(edgeCursor).toBe('ew-resize');
	await page.locator('article.canvas-block.selected').screenshot({
		path: 'test-results/selected-handles.png'
	});
});
