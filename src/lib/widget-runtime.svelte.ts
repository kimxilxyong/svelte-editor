/**
 * @fileoverview Browser-side runtime for user-edited built-in widgets.
 *
 * Edited widget sources (see `server/widget-files.ts`) are fetched from `GET /editor/api/widgets`,
 * compiled in the browser with `svelte/compiler` (`generate: 'client'`) and evaluated into real
 * Svelte components. `BlockContent` consults {@link widgetRuntime} and renders the override
 * instead of the built-in component whenever one exists.
 *
 * The compiled module's `import` statements are rewritten into lookups in a fixed dependency
 * table (`svelte`, `svelte/internal/client`, `flowbite-svelte`). Overrides may therefore only
 * import those packages; anything else fails to compile here and the default component is used.
 * Overrides can only be authored by power users, and are evaluated with `new Function`.
 */

/* eslint-disable svelte/no-svelte-internal -- edited widgets must share the app's own client runtime */
import { compile } from 'svelte/compiler';
import type { Component } from 'svelte';

/** Widgets take a per-kind prop superset, so their props are deliberately untyped. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WidgetComponent = Component<any>;

/** Reactive registry of compiled overrides, keyed by component name (e.g. `WidgetButton`). */
export const widgetRuntime = $state<{ components: Record<string, WidgetComponent> }>({
	components: {}
});

/** Modules an override may import. Loaded lazily so unmodified sites pay nothing. */
async function loadDependencies(): Promise<Record<string, unknown>> {
	const [client, svelte, flowbite] = await Promise.all([
		// @ts-expect-error svelte ships no typings for its internal client runtime
		import('svelte/internal/client'),
		import('svelte'),
		import('flowbite-svelte')
	]);
	return { 'svelte/internal/client': client, svelte, 'flowbite-svelte': flowbite };
}

/**
 * Rewrites ES module imports of compiled output into reads from `__deps`.
 *
 * @param code - Compiled client JS.
 * @returns A function body that `return`s the component.
 * @throws {Error} When the code imports a module outside the dependency table.
 */
export function toFunctionBody(code: string, known: Iterable<string>): string {
	const allowed = [...known];
	const lookup = (spec: string) => {
		if (!allowed.includes(spec)) throw new Error(`Widgets cannot import "${spec}".`);
		return `__deps[${JSON.stringify(spec)}]`;
	};
	return code
		.replace(/^\s*import\s+['"]([^'"]+)['"];?\s*$/gm, (_m, spec: string) => {
			// Side-effect-only imports (e.g. `svelte/internal/disclose-version`) are not needed.
			return spec.startsWith('svelte/internal/') ? '' : (lookup(spec), '');
		})
		.replace(
			/^\s*import\s+\*\s+as\s+([\w$]+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm,
			(_m, id, spec) => {
				return `const ${id} = ${lookup(spec)};`;
			}
		)
		.replace(/^\s*import\s+\{([^}]*)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_m, names, spec) => {
			const mapped = String(names)
				.split(',')
				.map((part) => part.trim())
				.filter(Boolean)
				.map((part) => part.replace(/\s+as\s+/, ': '))
				.join(', ');
			return `const { ${mapped} } = ${lookup(spec)};`;
		})
		.replace(/^\s*import\s+([\w$]+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_m, id, spec) => {
			return `const ${id} = ${lookup(spec)}.default;`;
		})
		.replace(/^\s*export\s+default\s+/m, 'return ');
}

/**
 * Compiles one widget source into a component.
 *
 * @param name - Component name (used as compiler filename).
 * @param source - Full `.svelte` source.
 * @param deps - Dependency table, see {@link loadDependencies}.
 * @returns The component, or `undefined` when the source does not compile or evaluate.
 */
export function compileWidget(
	name: string,
	source: string,
	deps: Record<string, unknown>
): WidgetComponent | undefined {
	try {
		const { js } = compile(source, { generate: 'client', filename: `${name}.svelte`, dev: false });
		const body = toFunctionBody(js.code, Object.keys(deps));
		return new Function('__deps', body)(deps) as WidgetComponent;
	} catch (error) {
		console.warn(`The edited widget ${name} could not be compiled; using the default.`, error);
		return undefined;
	}
}

/**
 * Fetches all overrides and refreshes {@link widgetRuntime}. Safe to call repeatedly (e.g. after
 * the Components page saved a widget); failures leave the previous state untouched.
 */
export async function loadWidgetOverrides(): Promise<void> {
	try {
		const response = await fetch('/editor/api/widgets', { cache: 'no-store' });
		if (!response.ok) return;
		const { overrides } = (await response.json()) as { overrides?: Record<string, string> };
		const entries = Object.entries(overrides ?? {});
		if (entries.length === 0) {
			widgetRuntime.components = {};
			return;
		}
		const deps = await loadDependencies();
		const next: Record<string, WidgetComponent> = {};
		for (const [name, source] of entries) {
			const component = compileWidget(name, source, deps);
			if (component) next[name] = component;
		}
		widgetRuntime.components = next;
	} catch {
		// Network or compile problems must never break the canvas: defaults stay in place.
	}
}
