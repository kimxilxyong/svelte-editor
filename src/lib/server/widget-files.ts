/**
 * @fileoverview Server-side storage for user-edited built-in widgets.
 *
 * The built-in components in `src/lib/components/editor/*.svelte` are the defaults. A power user can
 * edit any of them on the Components page; the edited source belongs to the **active project** and is
 * stored as `<cwd>/.data/widgets/<projectId>/<Name>.svelte` (the `.data` folder is git-ignored runtime
 * data), so projects – and users – never see each other's edits.
 *
 * Lookup order for a project: its own override → the shared legacy file
 * `<cwd>/.data/widgets/<Name>.svelte` (edits made before projects existed; read-only fallback that is
 * never written any more when a project id is given) → the built-in default. An override always wins
 * over the default:
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

/** Project ids are UUIDs; anything else must never reach the file system. */
const projectIdPattern = /^[A-Za-z0-9-]{1,100}$/;

/**
 * Directory of one project's overrides.
 *
 * @param projectId - Project id; `undefined` addresses the shared legacy directory itself.
 * @throws {WidgetError} When the id could change the path (traversal).
 */
export function projectWidgetsDirectory(projectId?: string): string {
	if (projectId === undefined) return widgetsDirectory();
	if (!projectIdPattern.test(projectId)) throw new WidgetError('Invalid project.');
	return path.join(widgetsDirectory(), projectId);
}

function fileFor(name: string, projectId?: string): string {
	return path.join(projectWidgetsDirectory(projectId), `${name}.svelte`);
}

/** Deletes all widget overrides of a project (called when the project is deleted). */
export async function removeProjectWidgets(projectId: string): Promise<void> {
	await rm(projectWidgetsDirectory(projectId), { recursive: true, force: true });
}

/** Returns the built-in default source of a component. */
export function defaultWidgetSource(name: string): string | undefined {
	return defaultSources[`../components/editor/${name}.svelte`];
}

/** Returns the override source, or `undefined` when the component is unmodified. */
async function readOverride(name: string, projectId?: string): Promise<string | undefined> {
	const own = await readFile(fileFor(name, projectId), 'utf8').catch(() => undefined);
	if (own !== undefined || projectId === undefined) return own;
	return readFile(fileFor(name), 'utf8').catch(() => undefined);
}

/**
 * Returns the effective source (override if present, otherwise default). Used by the exporters.
 *
 * @param name - Component name from {@link componentNames}.
 * @param projectId - Project whose overrides apply (omit for the shared legacy layer only).
 */
export async function effectiveWidgetSource(
	name: string,
	projectId?: string
): Promise<string | undefined> {
	// Only known names reach the file system (no path traversal through `name`).
	if (!editableNames.has(name)) return undefined;
	return (await readOverride(name, projectId)) ?? defaultWidgetSource(name);
}

/** Lists every editable component with its modified flag (own or inherited override). */
export async function listWidgets(projectId?: string): Promise<WidgetInfo[]> {
	const directories = projectId === undefined ? [undefined] : [projectId, undefined];
	const present = new Set<string>();
	for (const directory of directories) {
		for (const file of await readdir(projectWidgetsDirectory(directory)).catch(() => [])) {
			if (file.endsWith('.svelte')) present.add(file.replace(/\.svelte$/, ''));
		}
	}
	return [...editableNames]
		.sort()
		.filter((name) => defaultWidgetSource(name) !== undefined)
		.map((name) => ({ name, modified: present.has(name) }));
}

/** Returns all overrides as `{ [name]: source }` for the canvas. */
export async function readOverrides(projectId?: string): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const { name, modified } of await listWidgets(projectId)) {
		if (!modified) continue;
		const source = await readOverride(name, projectId);
		if (source !== undefined) result[name] = source;
	}
	return result;
}

/** Reads the effective source of one component. */
export async function readWidget(nameInput: unknown, projectId?: string): Promise<string> {
	const name = assertName(nameInput);
	const source = await effectiveWidgetSource(name, projectId);
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
	force = false,
	projectId?: string
): Promise<WidgetSaveResult> {
	const name = assertName(nameInput);
	if (typeof content !== 'string') throw new WidgetError('The content must be text.');
	if (Buffer.byteLength(content) > maxWidgetBytes) throw new WidgetError('The file is too large.');
	const check = checkSvelteSource(content, `${name}.svelte`);
	if (!check.ok && !force) return { saved: false, diagnostics: check.diagnostics };
	await mkdir(projectWidgetsDirectory(projectId), { recursive: true });
	await writeFile(fileFor(name, projectId), content);
	return { saved: true, diagnostics: check.diagnostics };
}

/** Deletes the project's own override (the inherited legacy file, if any, applies again). */
export async function resetWidget(nameInput: unknown, projectId?: string): Promise<void> {
	await rm(fileFor(assertName(nameInput), projectId), { force: true });
}
