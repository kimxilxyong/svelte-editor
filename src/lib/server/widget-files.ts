/**
 * @fileoverview Server-side storage for user-edited built-in widgets and sections.
 *
 * The built-in components in `src/lib/components/editor/*.svelte` are the defaults. A power user can
 * edit any of them on the Components page; the edited source is stored as
 * `<cwd>/.data/widgets/<Name>.svelte` (the `.data` folder is git-ignored runtime data). An override
 * always wins over the default:
 * - the canvas/preview compile the override in the browser (see `widget-runtime.svelte.ts`),
 * - `exportSite` / `exportSingleComponent` write the override instead of the default.
 *
 * Safety: only names that appear in {@link componentNames} are accepted (so a request can never
 * address an arbitrary path), sources are size-limited, and a file with compile errors is refused
 * unless `force` is set. Resetting simply deletes the override file.
 */

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { componentNames } from '../editor.js';
import { checkSvelteSource, type CheckResult } from '../svelte-diagnostics.js';

/** Largest accepted widget source in bytes. */
export const maxWidgetBytes = 128 * 1024;

/** Raw default sources of all built-in components, keyed by glob path. */
const defaultSources = import.meta.glob('../components/editor/*.svelte', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

/** Names of all built-in components that may be edited. */
const editableNames = new Set(Object.values(componentNames));

/** One row of the widget list. */
export type WidgetInfo = {
	/** Component name, e.g. `WidgetButton`. */
	name: string;
	/** `true` when an edited override exists. */
	modified: boolean;
};

/** Directory holding the overrides. Overridable for tests. */
export function widgetsDirectory(): string {
	return path.resolve(process.cwd(), process.env.WIDGETS_DIR || '.data/widgets');
}

/** Error with a message that is safe to show to the user. */
export class WidgetError extends Error {}

function assertName(name: unknown): string {
	if (typeof name !== 'string' || !editableNames.has(name)) {
		throw new WidgetError('Unknown widget.');
	}
	return name;
}

function fileFor(name: string): string {
	return path.join(widgetsDirectory(), `${name}.svelte`);
}

/** Returns the built-in default source of a component. */
export function defaultWidgetSource(name: string): string | undefined {
	return defaultSources[`../components/editor/${name}.svelte`];
}

/** Returns the override source, or `undefined` when the component is unmodified. */
async function readOverride(name: string): Promise<string | undefined> {
	return readFile(fileFor(name), 'utf8').catch(() => undefined);
}

/**
 * Returns the effective source (override if present, otherwise default). Used by the exporters.
 *
 * @param name - Component name from {@link componentNames}.
 */
export async function effectiveWidgetSource(name: string): Promise<string | undefined> {
	// Only known names reach the file system (no path traversal through `name`).
	if (!editableNames.has(name)) return undefined;
	return (await readOverride(name)) ?? defaultWidgetSource(name);
}

/** Lists every editable component with its modified flag. */
export async function listWidgets(): Promise<WidgetInfo[]> {
	const present = new Set(
		(await readdir(widgetsDirectory()).catch(() => [])).map((file) => file.replace(/\.svelte$/, ''))
	);
	return [...editableNames]
		.sort()
		.filter((name) => defaultWidgetSource(name) !== undefined)
		.map((name) => ({ name, modified: present.has(name) }));
}

/** Returns all overrides as `{ [name]: source }` for the canvas. */
export async function readOverrides(): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const { name, modified } of await listWidgets()) {
		if (!modified) continue;
		const source = await readOverride(name);
		if (source !== undefined) result[name] = source;
	}
	return result;
}

/** Reads the effective source of one component. */
export async function readWidget(nameInput: unknown): Promise<string> {
	const name = assertName(nameInput);
	const source = await effectiveWidgetSource(name);
	if (source === undefined) throw new WidgetError('Unknown widget.');
	return source;
}

/** Result of {@link saveWidget}. */
export type WidgetSaveResult = { saved: boolean; diagnostics: CheckResult['diagnostics'] };

/**
 * Saves an override. Compile errors block the write unless `force` is `true`.
 *
 * @throws {WidgetError} For unknown names, non-string or oversized content.
 */
export async function saveWidget(
	nameInput: unknown,
	content: unknown,
	force = false
): Promise<WidgetSaveResult> {
	const name = assertName(nameInput);
	if (typeof content !== 'string') throw new WidgetError('The content must be text.');
	if (Buffer.byteLength(content) > maxWidgetBytes) throw new WidgetError('The file is too large.');
	const check = checkSvelteSource(content, `${name}.svelte`);
	if (!check.ok && !force) return { saved: false, diagnostics: check.diagnostics };
	await mkdir(widgetsDirectory(), { recursive: true });
	await writeFile(fileFor(name), content);
	return { saved: true, diagnostics: check.diagnostics };
}

/** Deletes the override so the built-in default applies again. */
export async function resetWidget(nameInput: unknown): Promise<void> {
	await rm(fileFor(assertName(nameInput)), { force: true });
}
