/**
 * @fileoverview End-to-end coverage that a composite's preview layout and widget styling are
 * preserved when the composite is placed on a page and previewed through the Pages route.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

const compositeName = 'VisualParityCheck';
const headline = 'Composite preview headline';
const description = 'Composite preview text body';
const buttonLabel = 'Composite preview button';

async function setNumberField(page: Page, name: string, value: number): Promise<void> {
	const field = page.getByLabel(name);
	await field.fill(String(value));
	await field.press('Tab');
	await expect(field).toHaveValue(String(value));
}

async function dragPaletteItemToCanvas(
	page: Page,
	label: string | RegExp,
	canvas: Locator,
	position: { x: number; y: number }
): Promise<void> {
	const item = page.locator('.palette-item').filter({ hasText: label });
	await expect(item).toBeVisible();
	await item.dragTo(canvas, { targetPosition: position, force: true });
}

test('composite and page previews preserve child styles and positions', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1000 });

	await page.goto('/composites');
	await page.once('dialog', (dialog) => dialog.accept(compositeName));
	await page.getByRole('button', { name: 'New', exact: true }).click();

	const compositeCanvas = page.locator('.page-canvas');
	await dragPaletteItemToCanvas(page, /Alert/, compositeCanvas, { x: 260, y: 120 });
	await page.getByLabel('Heading').fill(headline);
	await page.getByLabel('Message').fill(description);
	await setNumberField(page, 'Left (px)', 64);
	await setNumberField(page, 'Top (px)', 48);
	await setNumberField(page, 'Width (px)', 360);
	await setNumberField(page, 'Height (px)', 72);

	await dragPaletteItemToCanvas(page, /Button/, compositeCanvas, { x: 480, y: 260 });
	await page.getByLabel('Button label').fill(buttonLabel);
	await setNumberField(page, 'Left (px)', 64);
	await setNumberField(page, 'Top (px)', 152);
	await setNumberField(page, 'Width (px)', 168);
	await setNumberField(page, 'Height (px)', 48);

	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('.save-status')).toContainText('Saved to the database');
	await page.getByRole('button', { name: 'Preview', exact: true }).click();

	const compositePreview = await page.evaluate(() => {
		const canvas = document.querySelector<HTMLElement>('.page-canvas.preview');
		const alert = canvas?.querySelector<HTMLElement>('article.canvas-block.widget-alert');
		const buttonBlock = canvas?.querySelector<HTMLElement>('article.canvas-block.widget-button');
		const button = buttonBlock?.querySelector('button');
		const alertContent = alert?.querySelector<HTMLElement>('[role="alert"]');
		if (!canvas || !alert || !buttonBlock || !button || !alertContent) {
			throw new Error('Composite preview is missing the expected alert or button.');
		}

		const geometry = (element: HTMLElement) => ({
			left: Number.parseFloat(element.style.left),
			top: Number.parseFloat(element.style.top),
			width: Number.parseFloat(element.style.width),
			height: Number.parseFloat(element.style.height)
		});
		const style = (element: HTMLElement) => {
			const computed = getComputedStyle(element);
			return {
				color: computed.color,
				backgroundColor: computed.backgroundColor,
				borderRadius: computed.borderRadius,
				fontFamily: computed.fontFamily,
				fontSize: computed.fontSize,
				fontWeight: computed.fontWeight,
				padding: computed.padding
			};
		};

		return {
			canvasWidth: Number.parseFloat(canvas.style.width),
			alert: {
				text: alert.textContent,
				geometry: geometry(alert),
				style: style(alertContent)
			},
			button: {
				text: button.textContent,
				geometry: geometry(buttonBlock),
				style: style(button)
			}
		};
	});

	expect(compositePreview.alert.text).toContain(headline);
	expect(compositePreview.alert.text).toContain(description);
	expect(compositePreview.button.text).toContain(buttonLabel);
	expect(compositePreview.alert.geometry).toEqual({ left: 64, top: 48, width: 360, height: 72 });
	expect(compositePreview.button.geometry).toEqual({ left: 64, top: 152, width: 168, height: 48 });

	await page.getByRole('button', { name: 'Back to editor', exact: true }).click();
	await page.goto('/');
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('.save-status')).toContainText('Saved to the database');

	await page.getByRole('link', { name: 'Edit this page' }).click();
	await page.getByRole('tab', { name: 'Composites', exact: true }).click();
	const pageCanvas = page.locator('.page-canvas');
	await dragPaletteItemToCanvas(page, new RegExp(compositeName), pageCanvas, { x: 450, y: 300 });

	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('.save-status')).toContainText('Saved to the database');
	await page.getByRole('button', { name: 'Preview', exact: true }).click();

	const pagePreview = await page.evaluate(
		({ composite, headlineText, buttonText }) => {
			const pageRoot = document.querySelector<HTMLElement>('.page-canvas.preview');
			const instance = pageRoot?.querySelector<HTMLElement>(
				`article.canvas-block[class~="composite:${composite}"]`
			);
			const alertWrapper = [
				...(instance?.querySelectorAll<HTMLElement>('.composite-child') ?? [])
			].find((element) => element.textContent?.includes(headlineText));
			const buttonWrapper = [
				...(instance?.querySelectorAll<HTMLElement>('.composite-child') ?? [])
			].find((element) => element.textContent?.includes(buttonText));
			const alertContent = alertWrapper?.querySelector<HTMLElement>('[role="alert"]');
			const button = buttonWrapper?.querySelector('button');
			if (!pageRoot || !instance || !alertWrapper || !buttonWrapper || !alertContent || !button) {
				throw new Error('Page preview is missing the composite or one of its widgets.');
			}

			const geometry = (element: HTMLElement) => ({
				left: element.offsetLeft,
				top: element.offsetTop,
				width: element.offsetWidth,
				height: element.offsetHeight
			});
			const style = (element: HTMLElement) => {
				const computed = getComputedStyle(element);
				return {
					color: computed.color,
					backgroundColor: computed.backgroundColor,
					borderRadius: computed.borderRadius,
					fontFamily: computed.fontFamily,
					fontSize: computed.fontSize,
					fontWeight: computed.fontWeight,
					padding: computed.padding
				};
			};

			return {
				alert: {
					text: alertWrapper.textContent,
					geometry: geometry(alertWrapper),
					style: style(alertContent)
				},
				button: {
					text: button.textContent,
					geometry: geometry(buttonWrapper),
					style: style(button)
				}
			};
		},
		{ composite: compositeName, headlineText: headline, buttonText: buttonLabel }
	);

	expect(pagePreview.alert.text).toContain(description);
	expect(pagePreview.button.text).toContain(buttonLabel);
	expect(pagePreview.alert.geometry).toEqual(compositePreview.alert.geometry);
	expect(pagePreview.button.geometry).toEqual(compositePreview.button.geometry);
	expect(pagePreview.alert.style).toEqual(compositePreview.alert.style);
	expect(pagePreview.button.style).toEqual(compositePreview.button.style);
});
