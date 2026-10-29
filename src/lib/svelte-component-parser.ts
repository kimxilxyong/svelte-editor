/**
 * @fileoverview Native Svelte Component Parser & Metadata Extractor.
 *
 * Uses the modern `svelte/compiler` AST parser to inspect `<script>` instances of
 * `.svelte` component files. It extracts declared props, default values, and prop types
 * from both:
 * 1. Modern Svelte 5 runes: `let { prop1, prop2 = defaultValue }: Props = $props();`
 * 2. Legacy Svelte 4 / 5 syntax: `export let propName = defaultValue;`
 *
 * This metadata enables the visual editor to dynamically import custom user components
 * from an external SvelteKit project and generate reactive inspector controls.
 */

import { parse } from 'svelte/compiler';

/**
 * Supported primitive property types for custom editor components.
 */
export type ComponentPropType = 'string' | 'number' | 'boolean';

/**
 * Metadata descriptor for an individual component property.
 */
export type ComponentProp = {
	/** Name of the prop (e.g., 'title', 'count', 'isOpen'). */
	name: string;
	/** Inferred primitive data type for UI control selection. */
	type: ComponentPropType;
	/** Optional default value defined in the component declaration. */
	defaultValue?: string | number | boolean;
	/** Whether the prop is marked as $bindable() in Svelte 5. */
	bindable?: boolean;
};

/**
 * Complete metadata extracted from a native `.svelte` file.
 */
export type ParsedComponentMetadata = {
	/** PascalCase component name extracted from filename. */
	name: string;
	/** File name including extension (e.g. 'CustomCard.svelte'). */
	fileName: string;
	/** List of extracted public properties. */
	props: ComponentProp[];
	/** Unmodified source code of the component. */
	rawSource: string;
};

/**
 * Normalizes TypeScript AST type nodes to one of our supported ComponentPropTypes.
 *
 * @param typeNode - AST type annotation node.
 * @returns ComponentPropType or `undefined` if not a recognized primitive.
 */
function normalizeType(typeNode?: any): ComponentPropType | undefined {
	if (!typeNode) return undefined;
	if (typeNode.type === 'TSStringKeyword') return 'string';
	if (typeNode.type === 'TSNumberKeyword') return 'number';
	if (typeNode.type === 'TSBooleanKeyword') return 'boolean';
	return undefined;
}

/**
 * Parses a native `.svelte` component source string and extracts its component metadata.
 *
 * Safe execution: if parsing fails or AST contains non-standard constructs, it gracefully
 * falls back to returning the component with an empty props array.
 *
 * @param source - Raw content of the `.svelte` file.
 * @param fileName - File name with extension (e.g., 'Hero.svelte').
 * @returns Structured metadata including component name and extracted props.
 */
export function parseSvelteComponent(source: string, fileName: string): ParsedComponentMetadata {
	const name = fileName.replace(/\.svelte$/, '');
	const props: ComponentProp[] = [];

	let ast: any;
	try {
		ast = parse(source, { modern: true });
	} catch {
		return {
			name,
			fileName,
			props: [],
			rawSource: source
		};
	}

	const script = ast.instance || ast.module;
	if (!script || !script.content || !Array.isArray(script.content.body)) {
		return {
			name,
			fileName,
			props: [],
			rawSource: source
		};
	}

	// 1. Gather type information from interfaces or type aliases in script (e.g. interface Props { ... })
	const typeMap = new Map<string, ComponentPropType>();
	for (const node of script.content.body) {
		if (node.type === 'TSInterfaceDeclaration' && node.body?.body) {
			for (const member of node.body.body) {
				if (member.key?.name && member.typeAnnotation?.typeAnnotation) {
					const t = normalizeType(member.typeAnnotation.typeAnnotation);
					if (t) typeMap.set(member.key.name, t);
				}
			}
		} else if (node.type === 'TSTypeAliasDeclaration' && node.typeAnnotation?.members) {
			for (const member of node.typeAnnotation.members) {
				if (member.key?.name && member.typeAnnotation?.typeAnnotation) {
					const t = normalizeType(member.typeAnnotation.typeAnnotation);
					if (t) typeMap.set(member.key.name, t);
				}
			}
		}
	}

	// 2. Scan statements for Svelte 5 $props() or legacy export let
	for (const node of script.content.body) {
		// Svelte 5: let { a, b = 1 } = $props();
		if (node.type === 'VariableDeclaration') {
			for (const decl of node.declarations) {
				const isPropsCall =
					decl.init?.type === 'CallExpression' &&
					(decl.init.callee?.name === '$props' ||
						(decl.init.callee?.type === 'MemberExpression' &&
							decl.init.callee.object?.name === '$props'));

				if (isPropsCall && decl.id?.type === 'ObjectPattern') {
					for (const propNode of decl.id.properties) {
						if (propNode.type === 'Property' && propNode.key?.name) {
							const propName = propNode.key.name;
							// Ignore internal callbacks or snippet slots
							if (propName.startsWith('on') || propName === 'children') continue;

							let defaultValue: string | number | boolean | undefined;
							let inferredType: ComponentPropType | undefined = typeMap.get(propName);

							if (propNode.value?.type === 'AssignmentPattern') {
								const right = propNode.value.right;
								if (right?.type === 'Literal') {
									defaultValue = right.value;
									if (typeof right.value === 'string') inferredType = 'string';
									else if (typeof right.value === 'number') inferredType = 'number';
									else if (typeof right.value === 'boolean') inferredType = 'boolean';
								} else if (
									right?.type === 'UnaryExpression' &&
									right.operator === '-' &&
									right.argument?.type === 'Literal'
								) {
									defaultValue = -Number(right.argument.value);
									inferredType = 'number';
								}
							}

							props.push({
								name: propName,
								type: inferredType ?? 'string',
								defaultValue,
								bindable: false
							});
						}
					}
				}
			}
		}

		// Legacy Svelte 4 / 5 compatibility: export let propName = defaultValue;
		if (
			node.type === 'ExportNamedDeclaration' &&
			node.declaration?.type === 'VariableDeclaration'
		) {
			for (const decl of node.declaration.declarations) {
				if (decl.id?.type === 'Identifier') {
					const propName = decl.id.name;
					if (propName.startsWith('on') || propName === 'children') continue;

					let defaultValue: string | number | boolean | undefined;
					let inferredType: ComponentPropType | undefined = typeMap.get(propName);

					if (decl.init?.type === 'Literal') {
						defaultValue = decl.init.value;
						if (typeof decl.init.value === 'string') inferredType = 'string';
						else if (typeof decl.init.value === 'number') inferredType = 'number';
						else if (typeof decl.init.value === 'boolean') inferredType = 'boolean';
					}

					if (!props.some((p) => p.name === propName)) {
						props.push({
							name: propName,
							type: inferredType ?? 'string',
							defaultValue,
							bindable: false
						});
					}
				}
			}
		}
	}

	return {
		name,
		fileName,
		props,
		rawSource: source
	};
}
