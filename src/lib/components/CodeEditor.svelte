<script lang="ts" module>
	/**
	 * Languages the editor can highlight / indent / autocomplete.
	 * `typescript` is JavaScript with the TypeScript dialect enabled.
	 */
	export type CodeLanguage = 'svelte' | 'html' | 'javascript' | 'typescript' | 'css';

	/**
	 * A problem reported by the host (compiler, linter, validator …) that the
	 * editor renders as a squiggle, a lint-gutter marker and a hover tooltip.
	 *
	 * Coordinates deliberately mirror what the Svelte compiler / most tools
	 * emit: lines are **1-based**, columns are **0-based**.
	 */
	export type EditorDiagnostic = {
		/** 1-based line of the problem start */
		line: number;
		/** 0-based column of the start */
		column: number;
		/** 1-based end line (defaults to `line`) */
		endLine?: number;
		/** 0-based end column (defaults to end of the token/line, min 1 char wide) */
		endColumn?: number;
		severity: 'error' | 'warning' | 'info';
		message: string;
		/** optional rule/code, shown as the diagnostic source, e.g. 'a11y_missing_attribute' */
		code?: string;
	};

	/** Imperative handle exposed through the bindable `api` prop. */
	export type CodeEditorApi = {
		focus(): void;
		undo(): boolean;
		redo(): boolean;
		/** move cursor+scroll to 1-based line/0-based column and focus */
		goTo(line: number, column?: number): void;
	};
</script>

<script lang="ts">
	/**
	 * @component CodeEditor
	 *
	 * Reusable source-code editor built on CodeMirror 6. Supports Svelte, HTML,
	 * JavaScript, TypeScript and CSS with line numbers, folding, bracket
	 * matching/closing, autocompletion, undo/redo history, search, multiple
	 * selections and externally supplied diagnostics (squiggles, lint gutter and
	 * hover tooltips). It does **not** ship a linter: the host computes
	 * diagnostics and passes them in via `diagnostics`.
	 *
	 * Layout: the host element is `width: 100%; height: 100%` with a
	 * `min-height` of `minHeight`. Give the component a parent cell with a
	 * definite height (flex/grid cell) and the editor fills it; the inner
	 * scroller scrolls when the content is taller than the cell.
	 *
	 * Accessibility: the editable content element receives `aria-label={ariaLabel}`.
	 * CodeMirror's default focus-trap escape applies: Tab inserts indentation, so
	 * keyboard users press **Escape and then Tab** (or Shift+Tab) to leave the
	 * editor. Search is bound to Mod-f (and friends from `searchKeymap`).
	 *
	 * Reactivity model: the `EditorView` is created exactly once in the browser
	 * (inside an attachment, never during SSR). Afterwards every reactive prop is
	 * pushed into the live view by its own `$effect` — via Compartment
	 * reconfiguration for `language`, `theme`, `readonly`, `placeholder` and
	 * `ariaLabel`, via a transaction for `value` and `diagnostics` — so the
	 * document, selection and undo history survive all prop changes.
	 *
	 * @prop {string} value - Document text. `$bindable`, default `''`. Updated on every user edit;
	 *   assigning from outside replaces the document (without firing `onchange`).
	 * @prop {CodeLanguage} language - Active language. Reactive; switching (e.g. JS ⇄ TS) reconfigures
	 *   the language Compartment and keeps document and undo history. Required.
	 * @prop {EditorDiagnostic[]} [diagnostics=[]] - Problems to display. Reactive; replaces the previous set
	 *   on every change. Not bindable.
	 * @prop {boolean} [readonly=false] - Disallows edits (text can still be selected and copied).
	 * @prop {'light' | 'dark'} [theme='light'] - Colour theme. Reactive. `light` is the custom app theme,
	 *   `dark` is One Dark.
	 * @prop {string} ariaLabel - Accessible name of the editing surface. Reactive. Required.
	 * @prop {string} [placeholder] - Text shown while the document is empty. Reactive.
	 * @prop {string} [minHeight='8rem'] - CSS `min-height` of the host element.
	 * @prop {(value: string) => void} [onchange] - Called with the full new text after each user edit
	 *   (never for external `value` assignments).
	 * @prop {() => void} [onsave] - Called on Mod-s (Ctrl/Cmd+S). The browser's default "save page"
	 *   action is always suppressed while the editor has focus.
	 * @prop {() => void} [onfocus] - Called when the editor gains focus.
	 * @prop {CodeEditorApi | undefined} [api] - `$bindable`, default `undefined`. Assigned once the view
	 *   exists, reset to `undefined` when it is destroyed. Use `bind:api`.
	 * @prop {string} [class] - Extra CSS classes for the host element.
	 *
	 * @example
	 * ```svelte
	 * <script lang="ts">
	 *   import CodeEditor, {
	 *     type CodeEditorApi,
	 *     type EditorDiagnostic
	 *   } from './CodeEditor.svelte';
	 *
	 *   let source = $state('<h1>Hello</h1>');
	 *   let api = $state<CodeEditorApi>();
	 *   let problems: EditorDiagnostic[] = [
	 *     { line: 1, column: 0, severity: 'warning', message: 'Heading is empty', code: 'demo' }
	 *   ];
	 * <\/script>
	 *
	 * <div style="height: 24rem">
	 *   <CodeEditor
	 *     bind:value={source}
	 *     bind:api
	 *     language="svelte"
	 *     ariaLabel="Component source"
	 *     diagnostics={problems}
	 *     onsave={() => console.log('save')}
	 *   />
	 * </div>
	 * ```
	 */
	import { untrack } from 'svelte';
	import {
		Annotation,
		Compartment,
		EditorState,
		Prec,
		type Extension,
		type StateEffect
	} from '@codemirror/state';
	import {
		EditorView,
		crosshairCursor,
		drawSelection,
		dropCursor,
		highlightActiveLine,
		highlightActiveLineGutter,
		highlightSpecialChars,
		keymap,
		lineNumbers,
		placeholder as cmPlaceholder
	} from '@codemirror/view';
	import {
		HighlightStyle,
		bracketMatching,
		foldGutter,
		foldKeymap,
		indentOnInput,
		indentUnit,
		syntaxHighlighting
	} from '@codemirror/language';
	import {
		defaultKeymap,
		history,
		historyKeymap,
		indentWithTab,
		redo as cmRedo,
		undo as cmUndo
	} from '@codemirror/commands';
	import {
		autocompletion,
		closeBrackets,
		closeBracketsKeymap,
		completionKeymap
	} from '@codemirror/autocomplete';
	import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
	import { lintGutter, lintKeymap, setDiagnostics, type Diagnostic } from '@codemirror/lint';
	import { javascript } from '@codemirror/lang-javascript';
	import { html } from '@codemirror/lang-html';
	import { css } from '@codemirror/lang-css';
	import { svelte } from '@replit/codemirror-lang-svelte';
	import { oneDark } from '@codemirror/theme-one-dark';
	import { tags as t } from '@lezer/highlight';

	let {
		value = $bindable(''),
		language,
		diagnostics = [],
		readonly = false,
		theme = 'light',
		ariaLabel,
		placeholder,
		minHeight = '8rem',
		onchange,
		onsave,
		onfocus,
		// `api` is write-only here (the parent reads it via bind:api), which
		// trips the no-useless-assignment rule on the $bindable() default.
		// eslint-disable-next-line no-useless-assignment
		api = $bindable(),
		class: className = ''
	}: {
		value?: string;
		language: CodeLanguage;
		diagnostics?: EditorDiagnostic[];
		readonly?: boolean;
		theme?: 'light' | 'dark';
		ariaLabel: string;
		placeholder?: string;
		minHeight?: string;
		onchange?: (value: string) => void;
		onsave?: () => void;
		onfocus?: () => void;
		api?: CodeEditorApi;
		class?: string;
	} = $props();

	/**
	 * Marks transactions that originate from the `value` prop rather than from
	 * the user. The update listener ignores these so an external assignment never
	 * echoes back into `value` / `onchange` (which would cause an update loop).
	 */
	const External = Annotation.define<boolean>();

	// One Compartment per independently reactive setting. Reconfiguring a
	// Compartment swaps just that slice of the configuration; the document,
	// selection and undo history are untouched.
	const languageCompartment = new Compartment();
	const themeCompartment = new Compartment();
	const readonlyCompartment = new Compartment();
	const placeholderCompartment = new Compartment();
	const ariaCompartment = new Compartment();

	/**
	 * The live view. `$state.raw` because an EditorView is a large, mutable
	 * class instance that must never be proxied; it is reactive only so the sync
	 * effects below re-run once it has been created (they are no-ops before).
	 */
	let view = $state.raw<EditorView>();

	/** Maps a language id to its CodeMirror language support extension. */
	function languageExtension(lang: CodeLanguage): Extension {
		switch (lang) {
			case 'svelte':
				return svelte();
			case 'html':
				return html();
			case 'typescript':
				return javascript({ typescript: true });
			case 'css':
				return css();
			case 'javascript':
			default:
				return javascript();
		}
	}

	/** Shared layout/typography rules used by both colour themes. */
	const baseTheme = EditorView.theme({
		'&': { height: '100%', fontSize: '13px' },
		'&.cm-focused': { outline: 'none' },
		// The scroller owns scrolling so the gutter scrolls together with the text.
		'.cm-scroller': {
			overflow: 'auto',
			fontFamily:
				"ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
			lineHeight: '1.6'
		},
		'.cm-content': { padding: '8px 0' },
		'.cm-gutters': { border: 'none' },
		'.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 12px' }
	});

	/** Custom clean light editor chrome (purple accent #6b5ce7). */
	const lightTheme = EditorView.theme(
		{
			'&': { color: '#2b2b3a', backgroundColor: '#ffffff' },
			'.cm-content': { caretColor: '#6b5ce7' },
			'.cm-cursor, .cm-dropCursor': { borderLeftColor: '#6b5ce7', borderLeftWidth: '2px' },
			'&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
				{ backgroundColor: '#6b5ce72e' },
			'.cm-activeLine': { backgroundColor: '#6b5ce70d' },
			'.cm-gutters': { backgroundColor: '#f7f7fa', color: '#a0a0b8' },
			'.cm-activeLineGutter': { backgroundColor: '#ececf8', color: '#6b5ce7' },
			'.cm-foldPlaceholder': {
				backgroundColor: '#ececf8',
				border: 'none',
				color: '#6b5ce7',
				borderRadius: '4px'
			},
			'.cm-selectionMatch': { backgroundColor: '#6b5ce720' },
			'&.cm-focused .cm-matchingBracket': {
				backgroundColor: '#6b5ce72a',
				outline: '1px solid #6b5ce766'
			},
			'&.cm-focused .cm-nonmatchingBracket': { backgroundColor: '#e5484d2a' },
			'.cm-placeholder': { color: '#a0a0b8' },
			'.cm-tooltip': {
				border: '1px solid #e4e4ee',
				borderRadius: '8px',
				backgroundColor: '#ffffff',
				boxShadow: '0 4px 16px rgba(30, 30, 60, 0.12)',
				overflow: 'hidden'
			},
			'.cm-tooltip-autocomplete > ul > li[aria-selected]': {
				backgroundColor: '#6b5ce7',
				color: '#ffffff'
			},
			'.cm-panels': { backgroundColor: '#f7f7fa', color: '#2b2b3a' },
			'.cm-panels.cm-panels-bottom': { borderTop: '1px solid #e4e4ee' },
			'.cm-searchMatch': { backgroundColor: '#ffd9663d', outline: '1px solid #e0b43a80' },
			'.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#6b5ce733' }
		},
		{ dark: false }
	);

	/** Syntax colours matching the light chrome. */
	const lightHighlight = HighlightStyle.define([
		{ tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: '#6b5ce7' },
		{ tag: [t.definitionKeyword, t.moduleKeyword], color: '#6b5ce7', fontWeight: '600' },
		{ tag: [t.string, t.special(t.string), t.regexp], color: '#1a7f4b' },
		{ tag: [t.number, t.bool, t.null, t.atom], color: '#b45309' },
		{ tag: [t.comment, t.lineComment, t.blockComment], color: '#8b8ba3', fontStyle: 'italic' },
		{ tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#2563eb' },
		{ tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: '#1d4ed8' },
		{ tag: [t.typeName, t.className, t.namespace], color: '#0e7490' },
		{ tag: [t.propertyName, t.attributeValue], color: '#0f766e' },
		{ tag: [t.tagName], color: '#c2410c' },
		{ tag: [t.attributeName], color: '#b45309' },
		{ tag: [t.operator, t.punctuation, t.separator], color: '#6b6b85' },
		{ tag: [t.bracket, t.angleBracket, t.brace, t.squareBracket, t.paren], color: '#8b8ba3' },
		{ tag: [t.meta, t.processingInstruction], color: '#8b8ba3' },
		{ tag: t.heading, color: '#6b5ce7', fontWeight: '700' },
		{ tag: t.link, color: '#2563eb', textDecoration: 'underline' },
		{ tag: t.invalid, color: '#e5484d' }
	]);

	/** Resolves the `theme` prop to its extension bundle. */
	function themeExtension(name: 'light' | 'dark'): Extension {
		return name === 'dark' ? oneDark : [lightTheme, syntaxHighlighting(lightHighlight)];
	}

	/** Resolves the `readonly` prop to its extension. */
	function readonlyExtension(isReadonly: boolean): Extension {
		return EditorState.readOnly.of(isReadonly);
	}

	/** Resolves the `placeholder` prop to its extension (empty when unset). */
	function placeholderExtension(text: string | undefined): Extension {
		return text ? cmPlaceholder(text) : [];
	}

	/** Puts the accessible name on the editable `.cm-content` element. */
	function ariaExtension(label: string): Extension {
		return EditorView.contentAttributes.of({ 'aria-label': label });
	}

	/**
	 * Converts host diagnostics (1-based line / 0-based column) into CodeMirror
	 * diagnostics (absolute document offsets).
	 *
	 * - Lines and columns are clamped to the current document so a stale
	 *   diagnostic (the doc shrank since it was computed) can never throw a
	 *   RangeError.
	 * - Without an `endColumn` the range covers the word at the start position,
	 *   falling back to the rest of the line.
	 * - Ranges are widened to at least one character so the squiggle is visible;
	 *   at the very end of the document this means extending backwards.
	 */
	function toCmDiagnostics(state: EditorState, list: readonly EditorDiagnostic[]): Diagnostic[] {
		const doc = state.doc;
		const offset = (lineNo: number, col: number): number => {
			const line = doc.line(Math.min(Math.max(Math.trunc(lineNo), 1), doc.lines));
			return line.from + Math.min(Math.max(Math.trunc(col), 0), line.length);
		};
		return list.map((d) => {
			let from = offset(d.line, d.column);
			let to: number;
			if (d.endColumn !== undefined || d.endLine !== undefined) {
				to = offset(d.endLine ?? d.line, d.endColumn ?? doc.line(doc.lineAt(from).number).length);
			} else {
				const word = state.wordAt(from);
				to = word && word.to > from ? word.to : doc.lineAt(from).to;
			}
			if (to < from) [from, to] = [to, from];
			if (to === from) {
				if (to < doc.length) to += 1;
				else if (from > 0) from -= 1;
			}
			return {
				from,
				to,
				severity: d.severity,
				message: d.message,
				source: d.code
			};
		});
	}

	/**
	 * Attachment: creates the EditorView when the host element is mounted (so
	 * never on the server) and destroys it on teardown.
	 *
	 * The body runs under `untrack` because attachments re-run whenever a
	 * reactive value they read changes. Initial values are read once here;
	 * later changes are handled by the dedicated effects below, which must NOT
	 * recreate the view (that would drop undo history and the selection).
	 */
	function createEditor(node: HTMLElement) {
		const instance = untrack(() => {
			const extensions: Extension[] = [
				lineNumbers(),
				highlightActiveLineGutter(),
				highlightSpecialChars(),
				history(),
				foldGutter(),
				drawSelection(),
				dropCursor(),
				EditorState.allowMultipleSelections.of(true),
				indentOnInput(),
				bracketMatching(),
				closeBrackets(),
				autocompletion(),
				crosshairCursor(),
				highlightActiveLine(),
				highlightSelectionMatches(),
				lintGutter(),
				indentUnit.of('\t'),
				EditorState.tabSize.of(4),
				baseTheme,
				languageCompartment.of(languageExtension(language)),
				themeCompartment.of(themeExtension(theme)),
				readonlyCompartment.of(readonlyExtension(readonly)),
				placeholderCompartment.of(placeholderExtension(placeholder)),
				ariaCompartment.of(ariaExtension(ariaLabel)),
				// Highest precedence so Mod-s wins over any other binding. Returning
				// `true` makes CodeMirror call preventDefault (no browser "Save page").
				Prec.highest(
					keymap.of([
						{
							key: 'Mod-s',
							preventDefault: true,
							run: () => {
								onsave?.();
								return true;
							}
						}
					])
				),
				keymap.of([
					...closeBracketsKeymap,
					...defaultKeymap,
					...searchKeymap,
					...historyKeymap,
					...foldKeymap,
					...completionKeymap,
					...lintKeymap,
					indentWithTab
				]),
				EditorView.updateListener.of((update) => {
					// Only user-originated edits are propagated; transactions carrying the
					// `External` annotation came from the `value` prop and must not echo.
					if (update.docChanged && !update.transactions.some((tr) => tr.annotation(External))) {
						const text = update.state.doc.toString();
						value = text;
						onchange?.(text);
					}
					if (update.focusChanged && update.view.hasFocus) onfocus?.();
				})
			];
			return new EditorView({
				parent: node,
				state: EditorState.create({ doc: value, extensions })
			});
		});

		view = instance;
		api = {
			focus: () => instance.focus(),
			undo: () => cmUndo(instance),
			redo: () => cmRedo(instance),
			goTo: (line, column = 0) => {
				const doc = instance.state.doc;
				const target = doc.line(Math.min(Math.max(Math.trunc(line), 1), doc.lines));
				const pos = target.from + Math.min(Math.max(Math.trunc(column), 0), target.length);
				instance.dispatch({
					selection: { anchor: pos },
					effects: EditorView.scrollIntoView(pos, { y: 'center' })
				});
				instance.focus();
			}
		};

		return () => {
			instance.destroy();
			view = undefined;
			api = undefined;
		};
	}

	/** Dispatches a compartment reconfiguration into the live view. */
	function reconfigure(v: EditorView, effect: StateEffect<unknown>) {
		v.dispatch({ effects: effect });
	}

	// --- prop → editor sync ------------------------------------------------

	// External `value` changes. Declared before the diagnostics effect so that,
	// when both change in the same tick, the new document is in place before
	// diagnostics (computed for that document) are positioned against it.
	$effect(() => {
		const next = value;
		const v = view;
		if (!v) return;
		// Skip when the doc already matches: this is the echo of the user's own
		// edit (the update listener just wrote `value`) and replacing would reset
		// the cursor and pollute the undo history.
		if (next === v.state.doc.toString()) return;
		v.dispatch({
			changes: { from: 0, to: v.state.doc.length, insert: next },
			annotations: External.of(true)
		});
	});

	$effect(() => {
		const v = view;
		const lang = language;
		if (v) reconfigure(v, languageCompartment.reconfigure(languageExtension(lang)));
	});

	$effect(() => {
		const v = view;
		const name = theme;
		if (v) reconfigure(v, themeCompartment.reconfigure(themeExtension(name)));
	});

	$effect(() => {
		const v = view;
		const isReadonly = readonly;
		if (v) reconfigure(v, readonlyCompartment.reconfigure(readonlyExtension(isReadonly)));
	});

	$effect(() => {
		const v = view;
		const text = placeholder;
		if (v) reconfigure(v, placeholderCompartment.reconfigure(placeholderExtension(text)));
	});

	$effect(() => {
		const v = view;
		const label = ariaLabel;
		if (v) reconfigure(v, ariaCompartment.reconfigure(ariaExtension(label)));
	});

	$effect(() => {
		const v = view;
		// Read the prop (and, if it is a deep proxy, its items) so the effect
		// re-runs whenever the host supplies a new set of diagnostics.
		const list = diagnostics;
		if (!v) return;
		// `setDiagnostics` replaces the whole set and installs the lint state
		// field on demand; no linter source is involved.
		v.dispatch(setDiagnostics(v.state, toCmDiagnostics(v.state, list)));
	});
</script>

<div
	class={['code-editor', className, { dark: theme === 'dark' }]}
	style:min-height={minHeight}
	{@attach createEditor}
></div>

<style>
	.code-editor {
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		overflow: hidden;
		border: 1px solid #e4e4ee;
		border-radius: 10px;
		background: #ffffff;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease;
	}

	.code-editor.dark {
		border-color: #3a3f4b;
		background: #282c34;
	}

	/* Focus ring on the host (the inner editor outline is disabled). */
	.code-editor:focus-within {
		border-color: #6b5ce7;
		box-shadow: 0 0 0 3px #6b5ce72e;
	}
</style>
