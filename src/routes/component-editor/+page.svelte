<script lang="ts">
	/**
	 * @component ComponentEditorPage
	 *
	 * `/component-editor` – a source editor for native `<name>.svelte` files of a real SvelteKit
	 * project. The file is shown as separate **Script** (TypeScript or JavaScript), **Markup**
	 * (HTML + Svelte template) and **Style** (CSS) editors, with an optional **Module script**.
	 *
	 * ## Layout (same shell as the pages and editor routes)
	 * - Header: the shared top navigation (`AppNav`, mounted in the root layout) + `BuilderHeader` (Save, Undo and Redo of the focused part editor).
	 * - Left: project folder (browse), component file list, "New component". The **Built-in
	 *   widgets** tab instead lists the editor's own widgets/sections; saving stores an override in
	 *   `.data/widgets` (see `widget-files.ts`) that the canvas and exports use ("Reset to default").
	 * - Centre: the part editors (or a read-only "Full file" view of the assembled source).
	 * - Right: problems from the Svelte compiler (click to jump) and the detected props.
	 *
	 * ## Data flow
	 * 1. `POST /component-editor/api` `list`/`read` fetch files below `src/lib/components`.
	 * 2. `splitSvelteSource` turns the file into {@link SvelteParts}; each editor binds one field.
	 * 3. `joinSvelteSource(parts)` re-assembles the file on every edit (`joined`); a debounced
	 *    effect runs `checkSvelteSource(joined.source)` and `distributeDiagnostics` maps the
	 *    whole-file positions back into the part editors (`problems`).
	 * 4. Save sends `joined.source`. The server re-checks; with compile errors nothing is written
	 *    until the developer confirms **Save anyway** (`force`). Warnings never block.
	 *
	 * ## Notes
	 * - The saved file is normalised: block order module script → script → markup → style, one
	 *   blank line between blocks, indentation preserved. The "dirty" flag compares against the
	 *   normalised form of the loaded file, so merely opening a file does not mark it changed.
	 * - The project path is shared with the pages route through `localStorage['editor-project-root']`.
	 * - The route is client-driven; there are no load functions and no prerendering.
	 */
	import { onMount } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import BuilderHeader from '../../lib/components/BuilderHeader.svelte';
	import { loadWidgetOverrides } from '../../lib/widget-runtime.svelte.js';
	import { useNavContext } from '../../lib/navigation.svelte.js';
	import DirectoryPickerModal from '../../lib/components/DirectoryPickerModal.svelte';
	import CodeEditor, {
		type CodeEditorApi,
		type CodeLanguage,
		type EditorDiagnostic
	} from '../../lib/components/CodeEditor.svelte';
	import { parseSvelteComponent } from '../../lib/svelte-component-parser.js';
	import { checkSvelteSource } from '../../lib/svelte-diagnostics.js';
	import {
		distributeDiagnostics,
		emptyParts,
		joinSvelteSource,
		newComponentSource,
		splitSvelteSource,
		type ScriptLang,
		type PartDiagnostic,
		type PartId,
		type SvelteParts
	} from '../../lib/svelte-parts.js';

	/** Response of the list action. */
	type ListResponse = {
		root?: string;
		files?: { path: string; size: number }[];
		truncated?: boolean;
		error?: string;
	};
	/** A problem prepared for the right-hand list. */
	type ProblemRow = PartDiagnostic & { part: PartId };

	const projectKey = 'editor-project-root';
	const themeKey = 'component-editor-theme';
	const partLabels: Record<PartId, string> = {
		moduleScript: 'Module script',
		script: 'Script',
		markup: 'Markup',
		style: 'Style'
	};
	const emptyProblems = (): Record<PartId, PartDiagnostic[]> => ({
		moduleScript: [],
		script: [],
		markup: [],
		style: []
	});

	/** `project`: files of a real SvelteKit project; `widgets`: the built-in widgets/sections. */
	let mode = $state<'project' | 'widgets'>('project');
	let widgets = $state<{ name: string; modified: boolean }[]>([]);
	let projectRoot = $state('');
	let showPicker = $state(false);
	let files = $state<{ path: string; size: number }[]>([]);
	let filter = $state('');
	let truncated = $state(false);
	let selectedPath = $state<string | null>(null);
	let parts = $state<SvelteParts>(emptyParts('ts'));
	/** Normalised text of the file as last loaded or saved; the baseline for `dirty`. */
	let baseline = $state('');
	let notes = $state<string[]>([]);
	let problems = $state<Record<PartId, PartDiagnostic[]>>(emptyProblems());
	let status = $state('Choose a SvelteKit project folder to start.');
	let busy = $state(false);
	let theme = $state<'light' | 'dark'>('light');
	let fullView = $state(false);
	let confirmForce = $state(false);
	let activePart = $state<PartId>('script');
	let newName = $state('');
	let newLang = $state<ScriptLang>('ts');
	let creating = $state(false);
	let showModule = $state(false);
	let apis = $state<Partial<Record<PartId, CodeEditorApi>>>({});

	const joined = $derived(joinSvelteSource(parts));
	const dirty = $derived(selectedPath !== null && joined.source !== baseline);
	// Feeds the shared top navigation (unsaved-changes guard).
	useNavContext(() => ({ unsavedChanges: dirty }));
	const visibleFiles = $derived(
		files.filter((file) => file.path.toLowerCase().includes(filter.trim().toLowerCase()))
	);
	const rows = $derived<ProblemRow[]>(
		(Object.keys(problems) as PartId[])
			.flatMap((part) => problems[part].map((item) => ({ ...item, part })))
			.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
	);
	const errorCount = $derived(rows.filter((row) => row.severity === 'error').length);
	const warningCount = $derived(rows.length - errorCount);
	const props = $derived.by(() => {
		if (!selectedPath) return [];
		try {
			return parseSvelteComponent(joined.source, selectedPath.split('/').pop() ?? '').props;
		} catch {
			return [];
		}
	});
	const hasModule = $derived(parts.moduleScript.trim() !== '' || showModule);

	onMount(() => {
		projectRoot = localStorage.getItem(projectKey) ?? '';
		theme = localStorage.getItem(themeKey) === 'dark' ? 'dark' : 'light';
		if (projectRoot) void loadFiles();
	});

	// Debounced compiler check. The timer is cleared whenever the source changes again.
	$effect(() => {
		const { source, map } = joined;
		const name = selectedPath?.split('/').pop();
		if (!name) {
			problems = emptyProblems();
			return;
		}
		const timer = setTimeout(() => {
			problems = distributeDiagnostics(checkSvelteSource(source, name).diagnostics, map);
			confirmForce = confirmForce && errorCount > 0;
		}, 250);
		return () => clearTimeout(timer);
	});

	// Warn before the browser tab is closed or reloaded with unsaved edits.
	$effect(() => {
		if (!dirty) return;
		const handler = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener('beforeunload', handler);
		return () => window.removeEventListener('beforeunload', handler);
	});

	// In-app navigation (links, Back button, browser history) asks before discarding edits.
	beforeNavigate(({ cancel, willUnload }) => {
		if (dirty && !willUnload && !confirm('Discard your unsaved changes to this component?')) {
			cancel();
		}
	});

	/**
	 * Calls the component editor API.
	 *
	 * @param body - Action payload; `root` is added automatically.
	 * @returns Parsed JSON, or an `{ error }` object when the request failed.
	 */
	async function request<T extends { error?: string }>(body: Record<string, unknown>): Promise<T> {
		if (mode === 'widgets') return widgetRequest<T>(body);
		try {
			const response = await fetch('/component-editor/api', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ root: projectRoot.trim(), ...body }),
				cache: 'no-store'
			});
			return (await response.json()) as T;
		} catch {
			return { error: 'The server could not be reached.' } as T;
		}
	}

	/**
	 * Built-in widget mode: the same actions as the project API, mapped onto
	 * `/editor/api/widgets` (`path` is `<Name>.svelte`, no project folder involved).
	 */
	async function widgetRequest<T extends { error?: string }>(
		body: Record<string, unknown>
	): Promise<T> {
		const name = typeof body.path === 'string' ? body.path.replace(/\.svelte$/, '') : undefined;
		try {
			const response = await fetch('/editor/api/widgets', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ...body, name, root: undefined }),
				cache: 'no-store'
			});
			return (await response.json()) as T;
		} catch {
			return { error: 'The server could not be reached.' } as T;
		}
	}

	async function loadWidgets() {
		const result = await widgetRequest<{
			widgets?: { name: string; modified: boolean }[];
			error?: string;
		}>({ action: 'list' });
		if (result.widgets) widgets = result.widgets;
		else status = result.error ?? 'The widgets could not be listed.';
	}

	async function setMode(next: 'project' | 'widgets') {
		if (next === mode) return;
		if (dirty && !confirm('Discard your unsaved changes to this component?')) return;
		mode = next;
		selectedPath = null;
		parts = emptyParts('ts');
		baseline = '';
		if (next === 'widgets') {
			await loadWidgets();
			status = 'Edit a built-in widget; the canvas and exports use your version.';
		} else {
			status = projectRoot.trim()
				? 'Choose a component.'
				: 'Choose a SvelteKit project folder to start.';
		}
	}

	/** Deletes the edited version of the open widget so the built-in default applies again. */
	async function resetWidget() {
		if (mode !== 'widgets' || !selectedPath || busy) return;
		if (!confirm('Reset this widget to the built-in default?')) return;
		busy = true;
		const result = await widgetRequest<{ error?: string }>({ action: 'reset', path: selectedPath });
		if (result.error) {
			busy = false;
			status = result.error;
			return;
		}
		const read = await widgetRequest<{ content?: string; error?: string }>({
			action: 'read',
			path: selectedPath
		});
		busy = false;
		if (read.content !== undefined) loadSource(selectedPath, read.content);
		await Promise.all([loadWidgets(), loadWidgetOverrides()]);
		status = `${selectedPath} was reset to the default.`;
	}

	async function loadFiles() {
		busy = true;
		const result = await request<ListResponse>({ action: 'list' });
		busy = false;
		if (result.error || !result.files) {
			files = [];
			status = result.error ?? 'The project could not be read.';
			return;
		}
		files = result.files;
		truncated = result.truncated === true;
		localStorage.setItem(projectKey, projectRoot.trim());
		status = files.length
			? `${files.length} component${files.length === 1 ? '' : 's'} found.`
			: 'No components yet in src/lib/components – create one.';
	}

	/** Loads a file into the editors; asks first if the current one has unsaved edits. */
	async function openFile(path: string) {
		if (path === selectedPath) return;
		if (dirty && !confirm('Discard your unsaved changes to this component?')) return;
		busy = true;
		const result = await request<{ content?: string; error?: string }>({ action: 'read', path });
		busy = false;
		if (result.error || result.content === undefined) {
			status = result.error ?? 'The file could not be read.';
			return;
		}
		loadSource(path, result.content);
		status = `Opened ${path}.`;
	}

	function loadSource(path: string, content: string) {
		const split = splitSvelteSource(content);
		parts = split.parts;
		notes = split.notes;
		baseline = joinSvelteSource(split.parts).source;
		selectedPath = path;
		showModule = false;
		confirmForce = false;
		fullView = false;
	}

	/**
	 * Saves the assembled file.
	 *
	 * @param force - Write even though the compiler reported errors.
	 */
	async function save(force = false) {
		if (!selectedPath || busy) return;
		if (errorCount > 0 && !force) {
			confirmForce = true;
			status = `${errorCount} error${errorCount === 1 ? '' : 's'} – fix them or choose "Save anyway".`;
			return;
		}
		busy = true;
		const source = joined.source;
		const result = await request<{ saved?: boolean; error?: string }>({
			action: 'save',
			path: selectedPath,
			content: source,
			force
		});
		busy = false;
		if (result.error) {
			status = result.error;
		} else if (result.saved) {
			baseline = source;
			confirmForce = false;
			status = `Saved ${selectedPath}.`;
			if (mode === 'widgets') await Promise.all([loadWidgets(), loadWidgetOverrides()]);
		} else {
			confirmForce = true;
			status = 'The compiler rejected the file – see the problems list.';
		}
	}

	async function createComponent(event: SubmitEvent) {
		event.preventDefault();
		let name = newName.trim().replace(/\\/g, '/');
		if (!name) return;
		if (!name.endsWith('.svelte')) name += '.svelte';
		if (dirty && !confirm('Discard your unsaved changes to this component?')) return;
		creating = true;
		const content = newComponentSource(newLang);
		const result = await request<{ saved?: boolean; error?: string }>({
			action: 'create',
			path: name,
			content
		});
		creating = false;
		if (result.error || !result.saved) {
			status = result.error ?? 'The component could not be created.';
			return;
		}
		newName = '';
		await loadFiles();
		loadSource(name, content);
		status = `Created ${name}.`;
	}

	/** Switches the script language; the module script follows so both blocks stay consistent. */
	function setLanguage(lang: ScriptLang) {
		parts.scriptLang = lang;
		parts.moduleLang = lang;
	}

	function setTheme(next: 'light' | 'dark') {
		theme = next;
		localStorage.setItem(themeKey, next);
	}

	/** Moves the cursor of the right editor to a problem. */
	function jump(row: ProblemRow) {
		fullView = false;
		apis[row.part]?.goTo(row.line, row.column);
	}

	const scriptLanguage = $derived<CodeLanguage>(
		parts.scriptLang === 'ts' ? 'typescript' : 'javascript'
	);
	const moduleLanguage = $derived<CodeLanguage>(
		parts.moduleLang === 'ts' ? 'typescript' : 'javascript'
	);

	/** Converts part diagnostics to the editor's shape (identical fields, explicit for typing). */
	const forEditor = (part: PartId): EditorDiagnostic[] => problems[part];
	const countOf = (part: PartId, severity: 'error' | 'warning') =>
		problems[part].filter((item) => item.severity === severity).length;
</script>

<svelte:head>
	<title>Component editor</title>
	<meta name="description" content="Edit Svelte components part by part" />
</svelte:head>

{#snippet badges(part: PartId)}
	{#if countOf(part, 'error') > 0}
		<span class="badge error" title="Errors">{countOf(part, 'error')} ✕</span>
	{/if}
	{#if countOf(part, 'warning') > 0}
		<span class="badge warning" title="Warnings">{countOf(part, 'warning')} ⚠</span>
	{/if}
	{#if problems[part].length === 0 && selectedPath}
		<span class="badge ok" title="No problems">✓</span>
	{/if}
{/snippet}

<div class="editor-shell">
	<BuilderHeader
		eyebrow="COMPONENT EDITOR"
		title={selectedPath ?? 'No file open'}
		{status}
		{busy}
		unsaved={dirty}
		canSave={selectedPath !== null && dirty}
		onsave={() => save()}
		onundo={selectedPath ? () => apis[activePart]?.undo() : undefined}
		onredo={selectedPath ? () => apis[activePart]?.redo() : undefined}
		canUndo={selectedPath !== null}
		canRedo={selectedPath !== null}
	/>

	<div class="workspace">
		<aside class="side-panel" aria-label="Components">
			<div class="panel-heading">
				<div>
					<p class="eyebrow">PROJECT</p>
					<h2>Components</h2>
				</div>
				<span class="count-pill">{files.length}</span>
			</div>

			<div class="mode-tabs" role="tablist" aria-label="Component source">
				<button
					type="button"
					role="tab"
					aria-selected={mode === 'project'}
					class:on={mode === 'project'}
					onclick={() => setMode('project')}>Project</button
				>
				<button
					type="button"
					role="tab"
					aria-selected={mode === 'widgets'}
					class:on={mode === 'widgets'}
					onclick={() => setMode('widgets')}>Built-in widgets</button
				>
			</div>

			{#if mode === 'widgets'}
				<p class="panel-hint">
					Edits are stored in <code>.data/widgets</code> and replace the default on the canvas, in the
					preview and in exports.
				</p>
				<ul class="file-list" aria-label="Built-in widgets">
					{#each widgets as widget (widget.name)}
						<li>
							<button
								type="button"
								class="file-item"
								class:active={`${widget.name}.svelte` === selectedPath}
								onclick={() => openFile(`${widget.name}.svelte`)}
							>
								<strong>{widget.name}</strong>
								{#if widget.modified}<small>edited</small>{/if}
							</button>
						</li>
					{/each}
				</ul>
				{#if selectedPath}
					<button type="button" class="ghost" disabled={busy} onclick={resetWidget}>
						Reset to default
					</button>
				{/if}
			{:else}
				<label class="field-label" for="ce-root">Project path</label>
				<div class="row">
					<input
						id="ce-root"
						class="field-control"
						placeholder="/home/me/my-app"
						maxlength="500"
						bind:value={projectRoot}
						onkeydown={(event) => event.key === 'Enter' && loadFiles()}
					/>
					<button type="button" class="ghost" onclick={() => (showPicker = true)}>Browse…</button>
				</div>
				<div class="row">
					<button
						type="button"
						class="ghost grow"
						disabled={busy || !projectRoot.trim()}
						onclick={loadFiles}
					>
						Open project
					</button>
				</div>
				<DirectoryPickerModal
					open={showPicker}
					initialPath={projectRoot}
					onselect={(path) => {
						projectRoot = path;
						showPicker = false;
						void loadFiles();
					}}
					onclose={() => (showPicker = false)}
				/>

				<label class="field-label" for="ce-filter">Files in <code>src/lib/components</code></label>
				<input
					id="ce-filter"
					class="field-control"
					type="search"
					placeholder="Filter…"
					bind:value={filter}
				/>
				<ul class="file-list" aria-label="Component files">
					{#each visibleFiles as file (file.path)}
						<li>
							<button
								type="button"
								class="file-item"
								class:active={file.path === selectedPath}
								aria-current={file.path === selectedPath ? 'true' : undefined}
								onclick={() => openFile(file.path)}
							>
								<strong>{file.path.split('/').pop()}</strong>
								{#if file.path.includes('/')}
									<small>{file.path.slice(0, file.path.lastIndexOf('/'))}/</small>
								{/if}
							</button>
						</li>
					{:else}
						<li class="empty">{files.length ? 'No match.' : 'Nothing to show.'}</li>
					{/each}
				</ul>
				{#if truncated}<p class="panel-hint">Only the first files are listed.</p>{/if}

				<form class="new-form" onsubmit={createComponent}>
					<label class="field-label" for="ce-new">New component</label>
					<input
						id="ce-new"
						class="field-control"
						placeholder="widgets/MyCard"
						maxlength="120"
						bind:value={newName}
						disabled={files.length === 0 && !projectRoot.trim()}
					/>
					<div class="row">
						<select class="field-control" aria-label="Script language" bind:value={newLang}>
							<option value="ts">TypeScript</option>
							<option value="js">JavaScript</option>
						</select>
						<button
							type="submit"
							class="primary"
							disabled={creating || !newName.trim() || !projectRoot.trim()}
						>
							Create
						</button>
					</div>
				</form>
			{/if}
		</aside>

		<section class="canvas-panel" aria-label="Source editors">
			{#if !selectedPath}
				<div class="placeholder">
					<h2>Edit a component</h2>
					<p>
						Open a project, then pick a <code>.svelte</code> file on the left or create a new one. Script,
						markup and style are edited separately and checked by the Svelte compiler.
					</p>
				</div>
			{:else}
				<div class="toolbar">
					<div class="segmented" role="group" aria-label="View">
						<button type="button" class:on={!fullView} onclick={() => (fullView = false)}>
							Parts
						</button>
						<button type="button" class:on={fullView} onclick={() => (fullView = true)}>
							Full file
						</button>
					</div>
					<div class="segmented" role="group" aria-label="Theme">
						<button type="button" class:on={theme === 'light'} onclick={() => setTheme('light')}>
							Light
						</button>
						<button type="button" class:on={theme === 'dark'} onclick={() => setTheme('dark')}>
							Dark
						</button>
					</div>
				</div>

				{#if confirmForce}
					<div class="force-bar" role="alert">
						<span>
							{errorCount} compile error{errorCount === 1 ? '' : 's'} – the file was not written.
						</span>
						<button type="button" onclick={() => save(true)}>Save anyway</button>
						<button type="button" class="link" onclick={() => (confirmForce = false)}
							>Dismiss</button
						>
					</div>
				{/if}
				{#if notes.length}
					<div class="note-bar" role="note">{notes.join(' ')}</div>
				{/if}

				{#if fullView}
					<div class="card grow-card">
						<header>
							<h3>Full file <small>(read-only preview of what will be saved)</small></h3>
						</header>
						<div class="editor-slot">
							<CodeEditor
								value={joined.source}
								language="svelte"
								readonly
								{theme}
								ariaLabel="Assembled component source"
							/>
						</div>
					</div>
				{:else}
					{#if hasModule}
						<div class="card" style="flex: 2 1 0">
							<header>
								<h3>Module script <small>runs once per module</small></h3>
								<span class="badges">{@render badges('moduleScript')}</span>
							</header>
							<div class="editor-slot">
								<CodeEditor
									bind:value={parts.moduleScript}
									bind:api={apis.moduleScript}
									language={moduleLanguage}
									{theme}
									minHeight="4rem"
									ariaLabel="Module script"
									onsave={() => save()}
									onfocus={() => (activePart = 'moduleScript')}
								/>
							</div>
						</div>
					{/if}
					<div class="card" style="flex: 4 1 0">
						<header>
							<h3>Script</h3>
							<span class="badges">{@render badges('script')}</span>
							<div class="segmented small" role="group" aria-label="Script language">
								<button
									type="button"
									class:on={parts.scriptLang === 'ts'}
									onclick={() => setLanguage('ts')}
								>
									TS
								</button>
								<button
									type="button"
									class:on={parts.scriptLang === 'js'}
									onclick={() => setLanguage('js')}
								>
									JS
								</button>
							</div>
							{#if !hasModule}
								<button type="button" class="link" onclick={() => (showModule = true)}>
									+ module script
								</button>
							{/if}
						</header>
						<div class="editor-slot">
							<CodeEditor
								bind:value={parts.script}
								bind:api={apis.script}
								language={scriptLanguage}
								{theme}
								minHeight="6rem"
								ariaLabel="Component script"
								placeholder="// Component logic, e.g. let {'{ title }'} = $props();"
								diagnostics={forEditor('script')}
								onsave={() => save()}
								onfocus={() => (activePart = 'script')}
							/>
						</div>
					</div>
					<div class="card" style="flex: 4 1 0">
						<header>
							<h3>Markup <small>HTML + Svelte template</small></h3>
							<span class="badges">{@render badges('markup')}</span>
						</header>
						<div class="editor-slot">
							<CodeEditor
								bind:value={parts.markup}
								bind:api={apis.markup}
								language="svelte"
								{theme}
								minHeight="6rem"
								ariaLabel="Component markup"
								diagnostics={forEditor('markup')}
								onsave={() => save()}
								onfocus={() => (activePart = 'markup')}
							/>
						</div>
					</div>
					<div class="card" style="flex: 3 1 0">
						<header>
							<h3>Style <small>CSS, scoped to the component</small></h3>
							<span class="badges">{@render badges('style')}</span>
						</header>
						<div class="editor-slot">
							<CodeEditor
								bind:value={parts.style}
								bind:api={apis.style}
								language="css"
								{theme}
								minHeight="5rem"
								ariaLabel="Component style"
								diagnostics={forEditor('style')}
								onsave={() => save()}
								onfocus={() => (activePart = 'style')}
							/>
						</div>
					</div>
				{/if}
			{/if}
		</section>

		<aside class="inspector-panel" aria-label="Problems and props">
			<div class="panel-heading">
				<div>
					<p class="eyebrow">COMPILER</p>
					<h2>Problems</h2>
				</div>
				<span class="count-pill" class:bad={errorCount > 0}>{rows.length}</span>
			</div>
			{#if !selectedPath}
				<p class="panel-hint">Open a component to see compiler errors and warnings.</p>
			{:else if rows.length === 0}
				<p class="panel-hint ok-text" role="status">No problems found. ✓</p>
			{:else}
				<p class="panel-hint">
					{errorCount} error{errorCount === 1 ? '' : 's'}, {warningCount}
					warning{warningCount === 1 ? '' : 's'}. Select one to jump to it.
				</p>
				<ul class="problem-list">
					{#each rows as row, i (i)}
						<li>
							<button type="button" class={row.severity} onclick={() => jump(row)}>
								<span class="where">
									{partLabels[row.part]} · {row.line}:{row.column + 1}
								</span>
								<span class="what">{row.message}</span>
								{#if row.code}<code>{row.code}</code>{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}

			{#if selectedPath}
				<div class="props-section">
					<p class="eyebrow">PUBLIC API</p>
					<h2>Props</h2>
					{#if props.length === 0}
						<p class="panel-hint">No <code>$props()</code> with simple types detected.</p>
					{:else}
						<ul class="prop-list">
							{#each props as prop (prop.name)}
								<li>
									<strong>{prop.name}</strong>
									<span>{prop.type}{prop.bindable ? ' · bindable' : ''}</span>
									{#if prop.defaultValue !== undefined}
										<code>= {JSON.stringify(prop.defaultValue)}</code>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
		</aside>
	</div>
</div>

<style>
	:global(main:has(.editor-shell)) {
		width: 100%;
		max-width: none;
		padding: 0;
	}

	.editor-shell {
		--ink: #20233a;
		--muted: #898ba0;
		--line: #e9e9f0;
		--purple: #6b5ce7;
		--error: #d6334a;
		--warn: #b7791f;
		min-height: calc(100vh - 3rem);
		background: #f7f7fa;
		color: var(--ink);
		font-family:
			Inter,
			ui-sans-serif,
			system-ui,
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			sans-serif;
	}

	.workspace {
		display: grid;
		height: calc(100vh - 16.5rem);
		min-height: 34rem;
		grid-template-columns: 252px minmax(0, 1fr) 300px;
	}

	.side-panel,
	.inspector-panel {
		display: flex;
		min-height: 0;
		flex-direction: column;
		padding: 1.2rem 1.1rem;
		overflow-y: auto;
	}

	.side-panel {
		border-right: 1px solid var(--line);
	}

	.inspector-panel {
		border-left: 1px solid var(--line);
		background: #fff;
	}

	.panel-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.panel-heading h2,
	.props-section h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: -0.025em;
	}

	.eyebrow {
		margin: 0;
		color: var(--muted);
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.08em;
	}

	.count-pill {
		display: grid;
		min-width: 25px;
		height: 25px;
		padding: 0 0.3rem;
		place-items: center;
		border-radius: 8px;
		background: #f4f2ff;
		color: var(--purple);
		font-size: 0.72rem;
		font-weight: 700;
	}

	.count-pill.bad {
		background: #fdecef;
		color: var(--error);
	}

	.panel-hint {
		margin: 0.7rem 0 0.9rem;
		color: var(--muted);
		font-size: 0.72rem;
		line-height: 1.55;
	}

	.ok-text {
		color: #2f855a;
	}

	.field-label {
		display: block;
		margin: 0.85rem 0 0.4rem;
		color: #686a80;
		font-size: 0.67rem;
		font-weight: 650;
	}

	.field-control {
		display: block;
		width: 100%;
		min-height: 37px;
		padding: 0.5rem 0.65rem;
		border: 1px solid #e7e7ee;
		border-radius: 7px;
		background: #fff;
		color: #33354a;
		font: inherit;
		font-size: 0.7rem;
		outline: none;
	}

	.field-control:focus {
		border-color: #978be9;
		box-shadow: 0 0 0 3px rgb(119 102 223 / 12%);
	}

	.row {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.4rem;
	}

	.row .field-control {
		min-width: 0;
		flex: 1;
	}

	button.ghost,
	button.primary {
		padding: 0.45rem 0.7rem;
		border: 1px solid #d9d4fb;
		border-radius: 7px;
		background: #fff;
		color: var(--purple);
		font: inherit;
		font-size: 0.7rem;
		font-weight: 650;
		cursor: pointer;
	}

	button.primary {
		border-color: var(--purple);
		background: var(--purple);
		color: #fff;
	}

	button.grow {
		flex: 1;
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.file-list {
		display: flex;
		min-height: 6rem;
		flex: 1 1 0;
		flex-direction: column;
		gap: 0.3rem;
		margin: 0.5rem 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}

	.file-list .empty {
		color: var(--muted);
		font-size: 0.7rem;
	}

	.file-item {
		display: flex;
		width: 100%;
		flex-direction: column;
		align-items: flex-start;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--line);
		border-radius: 9px;
		background: #fff;
		color: var(--ink);
		font: inherit;
		font-size: 0.75rem;
		cursor: pointer;
	}

	.file-item small {
		color: var(--muted);
		font-size: 0.62rem;
	}

	.file-item.active {
		border-color: #c9c1ff;
		background: #f4f2ff;
	}

	.canvas-panel {
		display: flex;
		min-width: 0;
		min-height: 0;
		flex-direction: column;
		gap: 0.7rem;
		padding: 0.9rem 1.1rem;
	}

	.toolbar {
		display: flex;
		justify-content: space-between;
		gap: 0.8rem;
	}

	.segmented {
		display: inline-flex;
		overflow: hidden;
		border: 1px solid #ddd9f7;
		border-radius: 8px;
		background: #fff;
	}

	.segmented button {
		padding: 0.35rem 0.8rem;
		border: 0;
		background: transparent;
		color: #686a80;
		font: inherit;
		font-size: 0.7rem;
		font-weight: 650;
		cursor: pointer;
	}

	.segmented button.on {
		background: var(--purple);
		color: #fff;
	}

	.segmented.small button {
		padding: 0.15rem 0.6rem;
		font-size: 0.65rem;
	}

	.card {
		display: flex;
		min-height: 7rem;
		flex-direction: column;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: #fff;
	}

	.grow-card {
		flex: 1 1 0;
	}

	.card header {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 0.8rem;
		border-bottom: 1px solid var(--line);
		background: #fbfbfd;
	}

	.card h3 {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 700;
	}

	.card h3 small {
		margin-left: 0.3rem;
		color: var(--muted);
		font-size: 0.62rem;
		font-weight: 500;
	}

	.badges {
		display: flex;
		flex: 1;
		gap: 0.3rem;
	}

	.badge {
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		font-size: 0.62rem;
		font-weight: 700;
	}

	.badge.error {
		background: #fdecef;
		color: var(--error);
	}

	.badge.warning {
		background: #fff4dc;
		color: var(--warn);
	}

	.badge.ok {
		background: #e6f6ee;
		color: #2f855a;
	}

	.link {
		border: 0;
		background: none;
		color: var(--purple);
		font: inherit;
		font-size: 0.68rem;
		cursor: pointer;
	}

	.editor-slot {
		flex: 1 1 0;
		min-height: 0;
	}

	.force-bar,
	.note-bar {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.5rem 0.8rem;
		border-radius: 8px;
		font-size: 0.72rem;
	}

	.force-bar {
		border: 1px solid #f3b6c0;
		background: #fdecef;
		color: #8f1d30;
	}

	.force-bar span {
		flex: 1;
	}

	.force-bar button:not(.link) {
		padding: 0.3rem 0.7rem;
		border: 1px solid var(--error);
		border-radius: 6px;
		background: var(--error);
		color: #fff;
		font: inherit;
		font-weight: 650;
		cursor: pointer;
	}

	.note-bar {
		border: 1px solid #f1dfae;
		background: #fff8e5;
		color: #7a5a10;
	}

	.placeholder {
		margin: auto;
		max-width: 28rem;
		text-align: center;
		color: var(--muted);
		font-size: 0.8rem;
		line-height: 1.6;
	}

	.placeholder h2 {
		margin: 0 0 0.5rem;
		color: var(--ink);
	}

	.problem-list,
	.prop-list {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.problem-list button {
		display: flex;
		width: 100%;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.5rem 0.65rem;
		border: 1px solid var(--line);
		border-left-width: 4px;
		border-radius: 7px;
		background: #fff;
		color: var(--ink);
		font: inherit;
		font-size: 0.7rem;
		text-align: left;
		cursor: pointer;
	}

	.problem-list button.error {
		border-left-color: var(--error);
	}

	.problem-list button.warning {
		border-left-color: #e0a526;
	}

	.problem-list .where {
		color: var(--muted);
		font-size: 0.62rem;
		font-weight: 650;
	}

	.problem-list code,
	.prop-list code {
		color: var(--muted);
		font-size: 0.62rem;
	}

	.props-section {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid var(--line);
	}

	.prop-list li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.1rem 0.5rem;
		padding: 0.35rem 0.5rem;
		border-radius: 6px;
		background: #f7f7fb;
		font-size: 0.72rem;
	}

	.prop-list span {
		color: var(--muted);
		font-size: 0.65rem;
	}

	@media (max-width: 1000px) {
		.workspace {
			display: block;
			height: auto;
		}

		.canvas-panel {
			min-height: 50rem;
		}
	}
	.mode-tabs {
		display: flex;
		gap: 0.25rem;
		margin-bottom: 0.75rem;
	}

	.mode-tabs button {
		flex: 1;
		padding: 0.35rem 0.5rem;
		border: 1px solid #e8e8ed;
		border-radius: 6px;
		background: #fff;
		font-size: 0.8rem;
		cursor: pointer;
	}

	.mode-tabs button.on {
		border-color: #6d28d9;
		background: #f5f3ff;
		color: #5b21b6;
		font-weight: 600;
	}
</style>
