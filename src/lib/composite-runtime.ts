/**
 * @fileoverview Context-scoped native composite compilation for canvas and preview surfaces.
 *
 * `prepareComposite` synchronously snapshots the context lookup, generated/native sources and
 * edited widget dependencies. This is deliberately separate from async dependency loading: Svelte
 * must observe every nested definition before the first await to invalidate an obsolete project
 * or source generation. Each plan owns its graph; there is no shared composite registry/cache.
 *
 * The Svelte AST supplies real import declarations (not matches inside comments or strings).
 * Only exact editor component paths and packages supplied by `loadDependencies` are resolvable.
 * Dynamic imports and module re-exports are rejected rather than bypassing the shared constrained
 * compiler. `compileComposite` delegates all evaluation and CSS handling to strict `compileSource`;
 * this module does not evaluate JavaScript. Generated geometry remains percentage-based within
 * each composite's declared pixel canvas, as implemented by `renderCompositeSource`.
 */
import { maxCompositeDepth } from './composite-context.js';
import { componentNames, type EditorComposite } from './editor.js';
import { compositeSourceImports, compositeImportPattern } from './composite-source.js';
import { renderCompositeSource } from './svelte-pages.js';
import { compileSource, loadDependencies, type WidgetComponent } from './widget-runtime.svelte.js';

/** Composite definition including the optional authoritative full native source. */
export type RuntimeComposite = EditorComposite;

/** One statically resolved import; package imports are checked after dependency loading. */
interface CompositeImport {
	/** Original specifier, used verbatim as the strict compiler's dependency-table key. */
	readonly specifier: string;
	/** Snapshot of a built-in or edited widget component's default export. */
	readonly component?: WidgetComponent;
	/** Recursively prepared composite module, including generated defaults. */
	readonly composite?: CompositeNode;
}

/** Immutable source and import tree for one composite module. */
interface CompositeNode {
	readonly name: string;
	readonly source: string;
	readonly imports: readonly CompositeImport[];
}

/** Per-render-generation snapshot; never reused between projects or context providers. */
export interface CompositePlan {
	readonly root: CompositeNode;
}

/** Static application modules only; this is not a mutable registry of project composites. */
const builtinModules = import.meta.glob<WidgetComponent>('./components/editor/*.svelte', {
	eager: true,
	import: 'default'
});

/** Own-property checks prevent inherited names such as `constructor` from becoming modules. */
function owns(object: object, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * Synchronously prepares the entire dependency tree while the caller's reactive tracking is active.
 * Every path is checked independently: a shared dependency reached through a deeper branch cannot
 * evade the depth guard via caching. Built-ins take precedence over colliding project names, matching
 * their reserved editor import paths; widget overrides are consulted only for known built-ins.
 *
 * @param composite - Root definition; undefined source generates defaults, empty source stays native.
 * @param lookup - Current provider's reactive name lookup, obtained with `useComposites`.
 * @param depth - Existing block-rendering nesting level (root page instance is zero).
 * @param widgets - Current compiled widget overrides, synchronously snapshotted by reference.
 * @returns Immutable graph/source snapshot suitable for asynchronous compilation.
 * @throws On unknown component paths, cycles, excessive nesting or invalid source syntax.
 */
export function prepareComposite(
	composite: RuntimeComposite,
	lookup: (name: string) => EditorComposite | undefined,
	depth: number,
	widgets: Record<string, WidgetComponent>
): CompositePlan {
	const widgetSnapshot = { ...widgets };
	function prepare(
		definition: RuntimeComposite,
		level: number,
		ancestors: readonly string[]
	): CompositeNode {
		if (ancestors.includes(definition.name)) {
			throw new Error(
				`Composite dependency cycle: ${[...ancestors, definition.name].join(' → ')}.`
			);
		}
		if (!Number.isInteger(level) || level < 0 || level >= maxCompositeDepth) {
			throw new Error(`Composite "${definition.name}" exceeds maximum depth ${maxCompositeDepth}.`);
		}
		const path = [...ancestors, definition.name];
		// Generation intentionally ignores overrides, including future generator source short-circuits.
		const source =
			definition.source ??
			renderCompositeSource({ ...definition, source: undefined } as RuntimeComposite);
		// The generator omits self imports; detect this block-model cycle before it is concealed.
		if (
			definition.source === undefined &&
			definition.blocks.some((block) => block.kind === `composite:${definition.name}`)
		) {
			throw new Error(`Composite dependency cycle: ${[...path, definition.name].join(' → ')}.`);
		}
		const imports = compositeSourceImports(source).map((specifier): CompositeImport => {
			const match = compositeImportPattern.exec(specifier);
			if (!match) {
				// Packages are resolved only against the actual standard table, never fetched by name.
				if (!['svelte', 'flowbite-svelte'].includes(specifier)) {
					throw new Error(`Composite "${definition.name}" cannot import "${specifier}".`);
				}
				return Object.freeze({ specifier });
			}
			const name = match[1];
			const builtinPath = `./components/editor/${name}.svelte`;
			if (Object.values(componentNames).includes(name) && owns(builtinModules, builtinPath)) {
				return Object.freeze({
					specifier,
					component: owns(widgetSnapshot, name) ? widgetSnapshot[name] : builtinModules[builtinPath]
				});
			}
			const nested = lookup(name) as RuntimeComposite | undefined;
			if (!nested) {
				throw new Error(`Composite "${definition.name}" imports unknown component "${name}".`);
			}
			return Object.freeze({ specifier, composite: prepare(nested, level + 1, path) });
		});
		return Object.freeze({ name: definition.name, source, imports: Object.freeze(imports) });
	}
	return Object.freeze({ root: prepare(composite, depth, []) });
}

/**
 * Loads the shared allowlisted packages, then compiles nested composites bottom-up. The local
 * module cache deduplicates diamond imports only after every path was validated synchronously.
 * Errors propagate to CompositeSource's visible alert/boundary; invalid active source never falls
 * back to generated content. Obsolete promises have no registry to mutate and are discarded by
 * the component's promise-keyed rendering boundary.
 *
 * @param plan - Complete immutable snapshot produced by `prepareComposite`.
 * @param isCurrent - Optional generation guard checked after dependency loading and before module
 *   evaluation. Obsolete work must not inject CSS or execute a stale module script.
 * @returns Compiled Svelte client component, using shared widget runtime evaluation/CSS behavior.
 * @throws On superseded generations, unknown packages or shared compiler/evaluation failure.
 */
export async function compileComposite(
	plan: CompositePlan,
	isCurrent: () => boolean = () => true
): Promise<WidgetComponent> {
	const standard = await loadDependencies();
	const compiled = new Map<string, WidgetComponent>();
	function build(node: CompositeNode): WidgetComponent {
		if (!isCurrent()) throw new Error('Composite compilation superseded.');
		const cached = compiled.get(node.name);
		if (cached) return cached;
		const deps: Record<string, unknown> = { ...standard };
		for (const dependency of node.imports) {
			if (dependency.composite) {
				deps[dependency.specifier] = { default: build(dependency.composite) };
			} else if (dependency.component) {
				deps[dependency.specifier] = { default: dependency.component };
			} else if (!owns(standard, dependency.specifier)) {
				throw new Error(`Composite "${node.name}" cannot import "${dependency.specifier}".`);
			}
		}
		if (!isCurrent()) throw new Error('Composite compilation superseded.');
		const component = compileSource(node.name, node.source, deps);
		compiled.set(node.name, component);
		return component;
	}
	return build(plan.root);
}
