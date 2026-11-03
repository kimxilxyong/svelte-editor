/**
 * @fileoverview Isomorphic native-composite import validation shared by persistence and runtime.
 * Walks Svelte's AST (including markup expressions) rather than matching source text. Type-only
 * imports are ignored; dynamic imports and re-exports cannot bypass the explicit dependency map.
 * Compiler diagnostic positions retain the editor convention: 1-based lines, 0-based columns.
 */
import { parse } from 'svelte/compiler';

/** Exact native editor component paths supported in preview and exported projects. */
export const compositeImportPattern =
	/^(?:\$lib\/components\/editor\/|#lib\/components\/editor\/|\.\/)([A-Za-z_$][\w$]*)\.svelte$/;

/** Import-policy violations are distinct from syntax errors that may be force-saved. */
export class CompositeImportError extends Error {}

/**
 * Extracts static runtime imports and rejects dynamic imports and module re-exports.
 * @param source - Full native `.svelte` source.
 * @returns Unique module specifiers; comments, strings and type imports are ignored.
 * @throws On invalid syntax or an import that bypasses static dependency resolution.
 */
export function compositeSourceImports(source: string): string[] {
	const imports = new Set<string>();
	function visit(value: unknown): void {
		if (!value || typeof value !== 'object') return;
		if (Array.isArray(value)) return void value.forEach(visit);
		const node = value as Record<string, unknown>;
		if (node.type === 'ImportExpression')
			throw new CompositeImportError('Composite sources cannot use dynamic imports.');
		if (
			(node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') &&
			node.source &&
			node.exportKind !== 'type'
		) {
			throw new CompositeImportError('Composite sources cannot re-export modules.');
		}
		if (node.type === 'ImportDeclaration' && node.importKind !== 'type') {
			const specifiers = node.specifiers as { importKind?: string }[];
			if (!specifiers.length || specifiers.some((item) => item.importKind !== 'type')) {
				imports.add((node.source as { value: string }).value);
			}
		}
		Object.values(node).forEach(visit);
	}
	visit(parse(source, { modern: true }));
	return [...imports];
}
