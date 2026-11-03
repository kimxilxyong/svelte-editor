<script lang="ts">
	/**
	 * @component ProjectsPage
	 *
	 * `/` – the application's home: the user's **projects**. A project sits above the pages: it owns
	 * its pages, composite components, theme and the path of the SvelteKit folder it is exported to.
	 * The layout deliberately mirrors the Pages view (list · overview · settings).
	 *
	 * - **Left – project list.** Users see their own projects; admins see the projects of *all* users
	 *   (with owner badge and an owner filter). Search, "New" / "Duplicate" / "Delete" buttons, and a
	 *   context menu per row and for the list background (right-click, or the "⋯" button on a row).
	 *   Selecting a row only inspects it; **Open** (button, double-click, Enter) makes it the active
	 *   project that Pages, Editor, Composites, Code and Theme work on.
	 * - **Centre – overview.** Facts about the selected project, a getting-started checklist and
	 *   shortcuts to Pages / Editor / Composites / Theme. A brand-new project is empty on purpose.
	 * - **Right – settings.** Name, description, SvelteKit folder (with browse button and validity
	 *   badge), theme summary, Export / Import / Create SvelteKit app (for the active project; power
	 *   users and above) and the delete zone (typed confirmation; files on disk are never deleted).
	 *
	 * Data flow: `data.projects` (server load) is the source of truth; `draft` holds the unsaved edits of
	 * the selected project. Every mutation calls `/projects/api` through `projectApi` and then
	 * `invalidateAll()`, which reloads this page and the layout (active project, theme, switcher).
	 * Guests are read-only (the server rejects their writes as well).
	 *
	 * @prop {import('./$types').PageData} data - `projects` (visible projects) plus the layout's
	 *   `user`, `project` (active) and `siteTheme`.
	 */
	import { tick } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page as routePage } from '$app/state';
	import { formatTimestamp } from '../lib/admin/format.js';
	import { hasRole } from '../lib/auth/roles.js';
	import BuilderHeader from '../lib/components/BuilderHeader.svelte';
	import DirectoryPickerModal from '../lib/components/DirectoryPickerModal.svelte';
	import { normalizeEntries } from '../lib/context-menu.js';
	import { useContextMenu } from '../lib/context-menu.svelte.js';
	import { projectItemMenu, projectListMenu } from '../lib/editor-menus.js';
	import { resetProjectContext, useNavContext } from '../lib/navigation.svelte.js';
	import { projectLimits, type ProjectSummary } from '../lib/projects.js';
	import { projectApi } from '../lib/projects-client.js';
	import {
		builtInThemes,
		defaultSiteTheme,
		findMatchingTheme,
		themesEqual,
		type ManagedTheme,
		type SiteTheme
	} from '../lib/theme.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** State of the folder check next to the path field. */
	type FolderState = 'unset' | 'checking' | 'sveltekit' | 'empty' | 'other' | 'missing';
	type FileNote = { file: string; reason: string };

	const role = $derived(routePage.data.user?.role ?? null);
	const userId = $derived(routePage.data.user?.id ?? '');
	const isAdmin = $derived(hasRole(role, 'admin'));
	/** Guests are read-only. */
	const canEdit = $derived(hasRole(role, 'user'));
	/** Folder access (browse, export, import, create) is for power users and above. */
	const canUseFolders = $derived(hasRole(role, 'poweruser'));
	const activeId = $derived(routePage.data.project?.id ?? '');
	const ownCount = $derived(data.projects.filter((item) => item.ownerId === userId).length);
	const canCreate = $derived(canEdit && ownCount < projectLimits.perUser);
	const managedThemes = $derived<ManagedTheme[]>(
		(routePage.data.themes as ManagedTheme[] | undefined) ??
			builtInThemes.map((item) => ({ ...item, builtIn: true, createdAt: '', updatedAt: '' }))
	);

	let selectedId = $state('');
	let query = $state('');
	let ownerFilter = $state('all');
	let busy = $state(false);
	let status = $state('');
	let creating = $state(false);
	let newName = $state('');
	let newThemeId = $state(builtInThemes[0].id);
	let deleteOpen = $state(false);
	let deleteText = $state('');
	let showPicker = $state(false);
	let installDependencies = $state(false);
	let folderState = $state<FolderState>('unset');
	let folderMessage = $state('');
	let folderDetails = $state<string[]>([]);
	let draft = $state<{ name: string; description: string; path: string; theme: SiteTheme }>({
		name: '',
		description: '',
		path: '',
		theme: { ...defaultSiteTheme }
	});
	let nameInput = $state<HTMLInputElement | null>(null);
	let newNameInput = $state<HTMLInputElement | null>(null);

	const selected = $derived(
		data.projects.find((item) => item.id === selectedId) ??
			data.projects.find((item) => item.id === activeId) ??
			data.projects[0]
	);
	const isActive = $derived(!!selected && selected.id === activeId);
	const isOwn = $derived(!!selected && selected.ownerId === userId);
	const dirty = $derived(
		!!selected &&
			(draft.name !== selected.name ||
				draft.description !== selected.description ||
				draft.path !== selected.path ||
				!themesEqual(draft.theme, selected.theme))
	);
	/** Owners of the visible projects (for the admin filter). */
	const owners = $derived(
		[...new Map(data.projects.map((item) => [item.ownerId, item.ownerName])).entries()].sort(
			(a, b) => a[1].localeCompare(b[1])
		)
	);
	const visible = $derived(
		data.projects.filter((item) => {
			if (ownerFilter === 'mine' && item.ownerId !== userId) return false;
			if (ownerFilter !== 'all' && ownerFilter !== 'mine' && item.ownerId !== ownerFilter) {
				return false;
			}
			const needle = query.trim().toLowerCase();
			return (
				!needle ||
				item.name.toLowerCase().includes(needle) ||
				item.ownerName.toLowerCase().includes(needle) ||
				item.path.toLowerCase().includes(needle)
			);
		})
	);
	const checklist = $derived(
		selected
			? [
					{ label: 'Name your project', done: true },
					{ label: 'Choose the SvelteKit folder', done: selected.path !== '' },
					{ label: 'Add the first page', done: selected.pageCount > 0 },
					{ label: 'Pick a theme', done: selected.theme.preset !== defaultSiteTheme.preset }
				]
			: []
	);

	const contextMenu = useContextMenu();
	// The unsaved-changes guard of the shared navigation covers edits to the settings.
	useNavContext(() => ({ unsavedChanges: dirty }));

	// Keep the selection valid and (re)load the draft whenever the selected project or its stored
	// values change (after a save, a switch or a reload) – but never while the user is typing in it.
	let draftKey = '';
	let draftProjectId = '';
	$effect(() => {
		const current = selected;
		const key = current ? `${current.id}|${current.updatedAt}` : '';
		if (key === draftKey) return;
		draftKey = key;
		if (current) {
			selectedId = current.id;
			draft = {
				name: current.name,
				description: current.description,
				path: current.path,
				theme: { ...current.theme }
			};
		}
		// Messages and the delete confirmation belong to one project; a refresh of the same project
		// (for example after an export remembered the folder) must not wipe them.
		if ((current?.id ?? '') !== draftProjectId) {
			draftProjectId = current?.id ?? '';
			deleteOpen = false;
			deleteText = '';
			folderMessage = '';
			folderDetails = [];
		}
	});

	// Validate the folder on selection and after edits (power users only: it uses the file browser API).
	let checkTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const path = draft.path.trim();
		clearTimeout(checkTimer);
		if (!path) {
			folderState = 'unset';
			return;
		}
		if (!canUseFolders) {
			folderState = 'other';
			return;
		}
		folderState = 'checking';
		checkTimer = setTimeout(() => void checkFolder(path), 350);
		return () => clearTimeout(checkTimer);
	});

	async function checkFolder(path: string) {
		try {
			const response = await fetch(`/editor/api/fs?path=${encodeURIComponent(path)}`);
			const result = (await response.json()) as { isSvelteKit?: boolean; isEmpty?: boolean };
			if (draft.path.trim() !== path) return;
			folderState = !response.ok
				? 'missing'
				: result.isSvelteKit
					? 'sveltekit'
					: result.isEmpty
						? 'empty'
						: 'other';
		} catch {
			folderState = 'missing';
		}
	}

	const folderBadge: Record<FolderState, { text: string; tone: 'muted' | 'ok' | 'warn' }> = {
		unset: { text: 'No folder chosen', tone: 'muted' },
		checking: { text: 'Checking…', tone: 'muted' },
		sveltekit: { text: '✔ SvelteKit project', tone: 'ok' },
		empty: { text: '✔ Empty folder – ready for “Create SvelteKit app”', tone: 'ok' },
		other: { text: 'Folder exists but is not a SvelteKit project', tone: 'warn' },
		missing: { text: 'Folder not found (created by “Create SvelteKit app”)', tone: 'warn' }
	};

	/** Runs `task` with the busy flag and a status text; errors become the status. */
	async function run(label: string, task: () => Promise<void>) {
		busy = true;
		status = label;
		try {
			await task();
		} catch (error) {
			status = error instanceof Error ? error.message : 'Something went wrong.';
		} finally {
			busy = false;
		}
	}

	async function openCreate() {
		if (!canCreate) return;
		creating = true;
		newName = '';
		newThemeId = managedThemes[0]?.id ?? builtInThemes[0].id;
		await tick();
		newNameInput?.focus();
	}

	async function createProject() {
		const name = newName.trim();
		if (!name) return;
		const chosenTheme = managedThemes.find((item) => item.id === newThemeId)?.theme;
		await run('Creating project…', async () => {
			const { project } = await projectApi({
				action: 'create',
				name,
				...(chosenTheme ? { theme: chosenTheme } : {})
			});
			creating = false;
			resetProjectContext();
			await invalidateAll();
			if (project) selectedId = project.id;
			status = `Created “${name}” – it is empty, add the first page when you are ready.`;
		});
	}

	/** Makes `project` the active one, optionally continuing to another route. */
	async function openProject(project: ProjectSummary, destination?: string) {
		await run(`Opening ${project.name}…`, async () => {
			if (project.id !== activeId) {
				await projectApi({ action: 'open', id: project.id });
				resetProjectContext();
				await invalidateAll();
			}
			status = `${project.name} is open`;
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- destination is a resolved route
			if (destination) await goto(destination);
		});
	}

	async function saveSettings() {
		if (!selected || !dirty || !canEdit) return;
		const target = selected;
		await run('Saving…', async () => {
			await projectApi({
				action: 'update',
				id: target.id,
				name: draft.name,
				description: draft.description,
				path: draft.path.trim(),
				theme: $state.snapshot(draft.theme)
			});
			await invalidateAll();
			status = 'Project saved';
		});
	}

	async function duplicateProject(project: ProjectSummary) {
		if (!canCreate) return;
		await run('Duplicating…', async () => {
			const { project: copy } = await projectApi({ action: 'duplicate', id: project.id });
			resetProjectContext();
			await invalidateAll();
			if (copy) selectedId = copy.id;
			status = `Created “${copy?.name ?? 'copy'}”`;
		});
	}

	async function deleteProject() {
		if (!selected || deleteText.trim() !== selected.name) return;
		const target = selected;
		await run('Deleting…', async () => {
			await projectApi({ action: 'delete', id: target.id });
			deleteOpen = false;
			deleteText = '';
			selectedId = '';
			resetProjectContext();
			await invalidateAll();
			status = `Deleted “${target.name}”. Files in its SvelteKit folder were not touched.`;
		});
	}

	/** Sends an export / import / create request for the active project and reports the result. */
	async function folderRequest(label: string, body: Record<string, unknown>) {
		await run(label, async () => {
			const response = await fetch('/editor/api/project', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ root: draft.path.trim(), ...body })
			});
			const result = await response.json();
			if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status}).`);
			const written: string[] = result.written ?? [];
			const skipped: FileNote[] = result.skipped ?? [];
			const warnings: string[] = result.warnings ?? [];
			if (body.action === 'import') {
				folderMessage = `Imported ${result.pages.length} pages, ${result.composites?.length ?? 0} composites, ${result.components?.length ?? 0} components${skipped.length ? `, skipped ${skipped.length}` : ''}.`;
				folderDetails = [
					...result.pages.map((item: { slug: string }) => `read /${item.slug}`),
					...skipped.map((item) => `skipped ${item.file} (${item.reason})`)
				];
			} else {
				folderMessage =
					body.action === 'create'
						? `Created a new SvelteKit project with ${written.length} files${result.installed ? ' (dependencies installed)' : ''}.`
						: `Exported ${written.length} files${skipped.length ? `, skipped ${skipped.length}` : ''}.`;
				folderDetails = [
					...written.map((file) => `wrote ${file}`),
					...warnings.map((warning) => `warning: ${warning}`),
					...skipped.map((item) => `skipped ${item.file} (${item.reason})`)
				];
			}
			status = folderMessage;
			await invalidateAll();
		});
	}

	function focusName() {
		void tick().then(() => nameInput?.focus());
	}

	function askDelete(project: ProjectSummary) {
		selectedId = project.id;
		deleteOpen = true;
		deleteText = '';
	}

	/** Menu of one project row; selecting it first makes the settings panel show that project. */
	function rowEntries(project: ProjectSummary) {
		selectedId = project.id;
		return projectItemMenu({
			name: project.name,
			isActive: project.id === activeId,
			canDuplicate: canCreate,
			canEdit,
			hasPath: project.path !== '',
			open: () => void openProject(project),
			openPages: () => void openProject(project, resolve('/pages')),
			openEditor: () => void openProject(project, resolve('/editor')),
			rename: focusName,
			duplicate: () => void duplicateProject(project),
			copyPath: () => void navigator.clipboard?.writeText(project.path).catch(() => {}),
			remove: () => askDelete(project)
		});
	}

	function listEntries() {
		return projectListMenu({
			canAdd: canCreate,
			add: () => void openCreate(),
			reload: () => void invalidateAll()
		});
	}

	/** Left-click access to the row menu (same entries as right-click). */
	function openRowMenu(event: MouseEvent, project: ProjectSummary) {
		event.stopPropagation();
		const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
		contextMenu.openAt(box.left, box.bottom + 4, normalizeEntries(rowEntries(project)));
	}

	function rowKeydown(event: KeyboardEvent, project: ProjectSummary) {
		if (event.key === 'F2' && canEdit) {
			event.preventDefault();
			selectedId = project.id;
			focusName();
		} else if (event.key === 'Delete' && canEdit) {
			event.preventDefault();
			askDelete(project);
		}
	}

	const themeSummary = (project: ProjectSummary) => {
		const match = findMatchingTheme(project.theme, managedThemes);
		const prefix = match ? `${match.name} · ` : '';
		return `${prefix}${project.theme.preset} · ${project.theme.dark ? 'dark' : 'light'} · ${project.theme.font}`;
	};
</script>

<svelte:head>
	<title>Projects</title>
	<meta name="description" content="Create and manage your page builder projects" />
</svelte:head>

<div class="editor-shell">
	<BuilderHeader
		{status}
		{busy}
		unsaved={dirty}
		canSave={canEdit && dirty}
		readOnlyNotice={canEdit ? undefined : 'Read-only: your role cannot change projects'}
		eyebrow="PROJECTS"
		title={isAdmin ? 'All projects' : 'Your projects'}
		saveLabel="Save settings"
		onsave={saveSettings}
	/>

	<div class="workspace">
		<aside
			class="palette-panel"
			aria-label="Projects"
			{@attach contextMenu.attach(listEntries)}
			data-testid="project-list-panel"
		>
			<div class="panel-heading">
				<div>
					<p class="eyebrow">{isAdmin ? 'ALL USERS' : 'YOUR WORK'}</p>
					<h2>Projects</h2>
				</div>
				<span class="count-pill">{data.projects.length}</span>
			</div>
			<p class="panel-hint">
				{#if data.projects.length === 0}
					A project holds the pages, composites and theme of one website.
				{:else}
					Select a project to see its settings. <strong>Open</strong> it to work on its pages.
				{/if}
			</p>

			{#if data.projects.length > 4 || isAdmin}
				<div class="filters">
					<input
						class="field-control"
						type="search"
						placeholder="Search projects…"
						aria-label="Search projects"
						bind:value={query}
					/>
					{#if isAdmin && owners.length > 1}
						<select class="field-control" aria-label="Filter by owner" bind:value={ownerFilter}>
							<option value="all">All owners</option>
							<option value="mine">My projects</option>
							{#each owners as [ownerId, ownerName] (ownerId)}
								<option value={ownerId}>{ownerName}</option>
							{/each}
						</select>
					{/if}
				</div>
			{/if}

			{#if creating}
				<form
					class="create-form"
					onsubmit={(event) => {
						event.preventDefault();
						void createProject();
					}}
				>
					<label class="field-label" for="new-project-name">New project name</label>
					<input
						id="new-project-name"
						class="field-control"
						maxlength={projectLimits.nameLength}
						placeholder="e.g. Portfolio site"
						bind:this={newNameInput}
						bind:value={newName}
						onkeydown={(event) => event.key === 'Escape' && (creating = false)}
					/>
					<label class="field-label" for="new-project-theme">Theme</label>
					<select
						id="new-project-theme"
						class="field-control"
						aria-label="New project theme"
						bind:value={newThemeId}
					>
						{#each managedThemes as entry (entry.id)}
							<option value={entry.id}>
								{entry.name} ({entry.theme.preset} · {entry.theme.dark ? 'dark' : 'light'})
							</option>
						{/each}
					</select>
					<div class="actions">
						<button type="submit" class="primary" disabled={busy || !newName.trim()}>Create</button>
						<button type="button" onclick={() => (creating = false)}>Cancel</button>
					</div>
				</form>
			{/if}

			<ul class="project-list" aria-label="Projects">
				{#each visible as project (project.id)}
					<li class="project-row">
						<button
							type="button"
							class="project-item"
							class:selected={selected && project.id === selected.id}
							aria-current={selected && project.id === selected.id ? 'true' : undefined}
							data-testid="project-item"
							onclick={() => (selectedId = project.id)}
							ondblclick={() => void openProject(project)}
							onkeydown={(event) => rowKeydown(event, project)}
							{@attach contextMenu.attach(() => rowEntries(project))}
						>
							<strong>
								{project.name}
								{#if project.id === activeId}<span class="badge active">Open</span>{/if}
							</strong>
							<small class="path">{project.path || 'No folder chosen'}</small>
							<small>
								{project.pageCount}
								{project.pageCount === 1 ? 'page' : 'pages'} · {project.compositeCount}
								{project.compositeCount === 1 ? 'composite' : 'composites'}
								{#if isAdmin && project.ownerId !== userId}
									· <span class="badge owner">{project.ownerName}</span>
								{/if}
							</small>
						</button>
						<button
							type="button"
							class="row-menu"
							aria-label="Actions for {project.name}"
							aria-haspopup="menu"
							onclick={(event) => openRowMenu(event, project)}
						>
							⋯
						</button>
					</li>
				{:else}
					<li class="list-empty">
						{data.projects.length === 0 ? 'No projects yet.' : 'No project matches your search.'}
					</li>
				{/each}
			</ul>
			<div class="actions">
				<button
					type="button"
					data-testid="new-project"
					disabled={!canCreate || busy}
					onclick={openCreate}
				>
					New
				</button>
				<button
					type="button"
					disabled={!canCreate || busy || !selected}
					onclick={() => selected && duplicateProject(selected)}
				>
					Duplicate
				</button>
				<button
					type="button"
					class="danger"
					disabled={!canEdit || busy || !selected}
					onclick={() => selected && askDelete(selected)}
				>
					Delete
				</button>
			</div>
		</aside>

		<section class="canvas-panel" aria-label="Project overview">
			<div class="canvas-toolbar">
				<div class="canvas-label">
					<span class="live-dot" aria-hidden="true"></span>
					<span>Project overview</span>
					{#if selected}<span class="canvas-path">{selected.name}</span>{/if}
				</div>
				{#if selected && !isActive}
					<button
						type="button"
						class="link-button"
						disabled={busy}
						onclick={() => void openProject(selected)}
					>
						Open this project →
					</button>
				{:else if selected}
					<a class="edit-link" href={resolve('/pages')}>Open pages →</a>
				{/if}
			</div>
			<div class="canvas-stage">
				{#if !selected}
					<div class="empty-state" data-testid="projects-empty">
						<h3>Create your first project</h3>
						<p>
							A project bundles the pages, reusable composites, theme and SvelteKit folder of one
							website. New projects start empty – every widget is available right away.
						</p>
						<button type="button" class="primary-action" disabled={!canCreate} onclick={openCreate}>
							New project
						</button>
					</div>
				{:else}
					<article class="overview" data-testid="project-overview">
						<header>
							<h3>{selected.name}</h3>
							{#if isActive}<span class="badge active">Open</span>{/if}
							{#if !isOwn}<span class="badge owner">Owner: {selected.ownerName}</span>{/if}
						</header>
						{#if selected.description}<p class="description">{selected.description}</p>{/if}

						<dl class="facts">
							<div>
								<dt>Pages</dt>
								<dd>{selected.pageCount}</dd>
							</div>
							<div>
								<dt>Composites</dt>
								<dd>{selected.compositeCount}</dd>
							</div>
							<div>
								<dt>Last change</dt>
								<dd>{formatTimestamp(selected.updatedAt)}</dd>
							</div>
							<div>
								<dt>Created</dt>
								<dd>{formatTimestamp(selected.createdAt)}</dd>
							</div>
							<div class="wide">
								<dt>SvelteKit folder</dt>
								<dd class="mono">{selected.path || '— not set —'}</dd>
							</div>
							<div class="wide">
								<dt>Theme</dt>
								<dd class="theme-line">
									<span class="swatch" style:background={selected.theme.primary} aria-hidden="true"
									></span>
									<span
										class="swatch"
										style:background={selected.theme.secondary}
										aria-hidden="true"
									></span>
									{themeSummary(selected)}
								</dd>
							</div>
						</dl>

						{#if selected.pageCount === 0}
							<div class="callout" data-testid="project-empty-callout">
								<strong>This project is empty.</strong>
								<span>
									It has no pages and no composites yet – only the widgets. Add the first page to
									start building.
								</span>
							</div>
						{/if}

						<h4>Getting started</h4>
						<ul class="checklist">
							{#each checklist as item (item.label)}
								<li class:done={item.done}>
									<span aria-hidden="true">{item.done ? '✔' : '○'}</span>
									{item.label}
								</li>
							{/each}
						</ul>

						<div class="shortcuts">
							<button
								type="button"
								class="primary-action"
								disabled={busy}
								onclick={() => void openProject(selected, resolve('/pages'))}
							>
								{selected.pageCount === 0 ? 'Add the first page' : 'Open pages'}
							</button>
							<button
								type="button"
								disabled={busy || selected.pageCount === 0}
								onclick={() => void openProject(selected, resolve('/editor'))}
							>
								Open editor
							</button>
							<button
								type="button"
								disabled={busy}
								onclick={() => void openProject(selected, resolve('/composites'))}
							>
								Composites
							</button>
							<button
								type="button"
								disabled={busy}
								onclick={() => void openProject(selected, resolve('/theme'))}
							>
								Edit theme
							</button>
						</div>
					</article>
				{/if}
			</div>
			<p class="canvas-footnote">
				Projects are private: you only see your own{isAdmin
					? ' – and, as an admin, everybody’s'
					: ''}.
			</p>
		</section>

		<aside class="inspector-panel" aria-label="Project settings">
			<div class="panel-heading">
				<div>
					<p class="eyebrow">MAKE IT YOURS</p>
					<h2>Project settings</h2>
				</div>
			</div>
			{#if selected}
				<fieldset class="inspector-content" disabled={!canEdit}>
					<label class="field-label" for="project-name">Name</label>
					<input
						id="project-name"
						class="field-control"
						maxlength={projectLimits.nameLength}
						bind:this={nameInput}
						bind:value={draft.name}
					/>
					<label class="field-label" for="project-description">Description</label>
					<textarea
						id="project-description"
						class="field-control"
						rows="3"
						maxlength={projectLimits.descriptionLength}
						placeholder="What is this site for?"
						bind:value={draft.description}></textarea>

					<label class="field-label" for="project-path">SvelteKit folder</label>
					<div class="project-input-row">
						<input
							id="project-path"
							class="field-control"
							placeholder="/home/me/my-app"
							maxlength={projectLimits.pathLength}
							bind:value={draft.path}
						/>
						{#if canUseFolders}
							<button type="button" class="browse-button" onclick={() => (showPicker = true)}>
								Browse…
							</button>
						{/if}
					</div>
					<p class="folder-badge {folderBadge[folderState].tone}" data-testid="folder-state">
						{folderBadge[folderState].text}
					</p>
					<DirectoryPickerModal
						open={showPicker}
						initialPath={draft.path}
						onselect={(path) => (draft.path = path)}
						onclose={() => (showPicker = false)}
					/>

					<label class="field-label" for="project-theme">Theme</label>
					<div class="project-input-row">
						<select
							id="project-theme"
							class="field-control"
							aria-label="Theme"
							data-testid="project-theme-select"
							value={findMatchingTheme(draft.theme, managedThemes)?.id ?? 'custom'}
							onchange={(event) => {
								const chosen = managedThemes.find((t) => t.id === event.currentTarget.value);
								if (chosen) draft.theme = { ...chosen.theme };
							}}
						>
							{#if !findMatchingTheme(draft.theme, managedThemes)}
								<option value="custom" disabled>
									Custom ({draft.theme.preset} · {draft.theme.dark ? 'dark' : 'light'})
								</option>
							{/if}
							{#each managedThemes as entry (entry.id)}
								<option value={entry.id}>
									{entry.name} ({entry.theme.preset} · {entry.theme.dark ? 'dark' : 'light'})
								</option>
							{/each}
						</select>
					</div>
					<p class="panel-hint">
						Pick one of the managed themes or <a href={resolve('/theme')}>manage themes →</a>
					</p>

					<div class="actions settings-actions">
						<button type="button" class="primary" disabled={busy || !dirty} onclick={saveSettings}>
							Save settings
						</button>
						<button
							type="button"
							disabled={!dirty}
							onclick={() =>
								selected &&
								(draft = {
									name: selected.name,
									description: selected.description,
									path: selected.path,
									theme: { ...selected.theme }
								})}
						>
							Revert
						</button>
					</div>
				</fieldset>

				{#if canUseFolders}
					<div class="inspector-content project-section">
						<span class="field-label">Export &amp; import</span>
						<p class="panel-hint">
							<strong>Create SvelteKit app</strong> sets up a complete app in an empty folder (it is
							created if missing). <strong>Export</strong> writes the pages, composites, theme and
							widgets of this project into the folder; <strong>Import</strong> reads pages the editor
							exported earlier and merges them in.
						</p>
						{#if !isActive}
							<p class="panel-hint note">
								Open this project first – export and import work on the open project.
							</p>
						{/if}
						<div class="actions folder-actions">
							<button
								type="button"
								disabled={busy || !isActive || !draft.path.trim() || selected.pageCount === 0}
								onclick={() => folderRequest('Exporting…', { action: 'export' })}
							>
								Export
							</button>
							<button
								type="button"
								disabled={busy || !isActive || !draft.path.trim()}
								onclick={() => folderRequest('Importing…', { action: 'import' })}
							>
								Import
							</button>
							<button
								type="button"
								data-testid="create-project"
								disabled={busy || !isActive || !draft.path.trim()}
								onclick={() =>
									folderRequest(
										installDependencies ? 'Creating app and installing…' : 'Creating app…',
										{ action: 'create', install: installDependencies }
									)}
							>
								Create SvelteKit app
							</button>
						</div>
						<label class="install-option">
							<input type="checkbox" bind:checked={installDependencies} />
							<span>Run <code>npm install</code> after creating (slow, needs network)</span>
						</label>
						{#if folderMessage}
							<p class="panel-hint" role="status" data-testid="folder-message">{folderMessage}</p>
							<ul class="project-details">
								{#each folderDetails as line (line)}<li>{line}</li>{/each}
							</ul>
						{/if}
					</div>
				{/if}

				{#if canEdit}
					<div class="inspector-content project-section danger-zone">
						<span class="field-label">Danger zone</span>
						{#if !deleteOpen}
							<button type="button" class="danger-button" onclick={() => askDelete(selected)}>
								Delete project…
							</button>
						{:else}
							<p class="panel-hint">
								This deletes <strong>{selected.name}</strong> with its pages, composites and widget edits.
								Files in the SvelteKit folder stay. Type the project name to confirm.
							</p>
							<input
								class="field-control"
								aria-label="Type the project name to confirm"
								bind:value={deleteText}
								autocomplete="off"
							/>
							<div class="actions">
								<button
									type="button"
									class="danger-button solid"
									data-testid="confirm-delete"
									disabled={busy || deleteText.trim() !== selected.name}
									onclick={deleteProject}
								>
									Delete forever
								</button>
								<button type="button" onclick={() => (deleteOpen = false)}>Cancel</button>
							</div>
						{/if}
					</div>
				{/if}
			{:else}
				<p class="panel-hint">Select or create a project to edit its settings.</p>
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
		min-height: calc(100vh - 7.75rem);
		grid-template-columns: 252px minmax(0, 1fr) 276px;
	}

	.palette-panel {
		display: flex;
		height: 100%;
		min-height: 0;
		flex-direction: column;
		padding: 1.5rem 1.1rem;
		border-right: 1px solid var(--line);
	}

	.inspector-panel {
		padding: 1.5rem 1.1rem;
		border-left: 1px solid var(--line);
		background: #fff;
	}

	.panel-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.panel-heading h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: -0.025em;
	}

	.count-pill {
		display: grid;
		width: 25px;
		height: 25px;
		place-items: center;
		border-radius: 8px;
		background: #f4f2ff;
		color: var(--purple);
		font-size: 0.72rem;
		font-weight: 700;
	}

	.panel-hint {
		margin: 0.8rem 0 1.15rem;
		color: var(--muted);
		font-size: 0.72rem;
		line-height: 1.55;
	}

	.panel-hint.note {
		margin: 0 0 0.7rem;
		color: #8a5a00;
	}

	.canvas-panel {
		display: flex;
		min-width: 0;
		flex-direction: column;
		padding: 1.2rem 1.3rem 0.8rem;
	}

	.canvas-toolbar {
		display: flex;
		min-height: 38px;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 0 0.2rem 0.8rem;
		color: #65677e;
		font-size: 0.69rem;
		font-weight: 600;
	}

	.canvas-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.canvas-path {
		margin-left: 0.2rem;
		padding: 0.22rem 0.45rem;
		border: 1px solid #e9e9f0;
		border-radius: 5px;
		color: #9a9bac;
		font-size: 0.62rem;
		font-weight: 500;
	}

	.live-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #69c89d;
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
		padding: 0.55rem 0.65rem;
		border: 1px solid #e7e7ee;
		border-radius: 7px;
		background: #fff;
		color: #33354a;
		font: inherit;
		font-size: 0.7rem;
		outline: none;
		box-sizing: border-box;
	}

	textarea.field-control {
		resize: vertical;
	}

	.field-control:focus {
		border-color: #978be9;
		box-shadow: 0 0 0 3px rgb(119 102 223 / 12%);
	}

	h2,
	p {
		margin-top: 0;
	}

	.eyebrow {
		margin-bottom: 0.15rem;
		color: var(--muted);
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.08em;
	}

	.filters {
		display: grid;
		gap: 0.35rem;
		margin-bottom: 0.7rem;
	}

	.create-form {
		margin-bottom: 0.7rem;
		padding: 0.2rem 0.7rem 0.7rem;
		border: 1px dashed #c9c1ff;
		border-radius: 10px;
		background: #faf9ff;
	}

	.create-form .actions {
		margin-top: 0.5rem;
	}

	.project-list {
		list-style: none;
		margin: 0 0 0.6rem;
		padding: 0;
		display: flex;
		flex: 1 1 0;
		min-height: 0;
		flex-direction: column;
		gap: 0.3rem;
		overflow-y: auto;
	}

	.project-row {
		position: relative;
	}

	.project-item {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.1rem;
		padding: 0.6rem 2.2rem 0.6rem 0.7rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: #fff;
		color: var(--ink);
		font: inherit;
		font-size: 0.78rem;
		text-align: left;
		cursor: pointer;
	}

	.project-item small {
		color: var(--muted);
		font-size: 0.65rem;
	}

	.project-item .path {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.project-item.selected {
		border-color: #c9c1ff;
		background: #faf9ff;
	}

	.project-item:focus-visible,
	.row-menu:focus-visible {
		outline: 2px solid var(--purple);
		outline-offset: 2px;
	}

	.row-menu {
		position: absolute;
		top: 0.4rem;
		right: 0.4rem;
		width: 26px;
		height: 26px;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: var(--muted);
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
	}

	.row-menu:hover {
		background: #eeeaff;
		color: var(--purple);
	}

	.list-empty {
		padding: 0.8rem 0.3rem;
		color: var(--muted);
		font-size: 0.72rem;
	}

	.badge {
		display: inline-block;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		font-size: 0.58rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		vertical-align: middle;
	}

	.badge.active {
		background: #e3f6ec;
		color: #217a4d;
	}

	.badge.owner {
		background: #eeeaff;
		color: var(--purple);
	}

	.actions {
		display: flex;
		gap: 0.35rem;
	}

	.actions button,
	.shortcuts button {
		flex: 1;
		min-height: 34px;
		border: 1px solid #e6e3f5;
		border-radius: 8px;
		background: #fff;
		color: #4b456f;
		font: inherit;
		font-size: 0.72rem;
		font-weight: 650;
		cursor: pointer;
	}

	.actions button.primary {
		border-color: var(--purple);
		background: var(--purple);
		color: #fff;
	}

	.actions .danger {
		color: #b3261e;
	}

	.actions button:disabled,
	.shortcuts button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.folder-actions {
		flex-wrap: wrap;
	}

	.folder-actions button {
		flex: 1 1 auto;
		padding: 0 0.7rem;
	}

	.settings-actions {
		margin-top: 0.9rem;
	}

	.inspector-content {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.project-section {
		margin-top: 1.4rem;
		padding-top: 0.4rem;
		border-top: 1px solid var(--line);
	}

	.project-input-row {
		display: flex;
		gap: 0.35rem;
		align-items: center;
	}

	.browse-button {
		flex-shrink: 0;
		min-height: 37px;
		padding: 0 0.75rem;
		border: 1px solid #d8d4cc;
		border-radius: 7px;
		background: #fff;
		font: inherit;
		font-size: 0.72rem;
		font-weight: 650;
		cursor: pointer;
		color: #4b456f;
	}

	.browse-button:hover {
		border-color: #c9c1ff;
		background: #faf9ff;
	}

	.folder-badge {
		margin: 0.4rem 0 0;
		font-size: 0.66rem;
		line-height: 1.4;
	}

	.folder-badge.muted {
		color: var(--muted);
	}

	.folder-badge.ok {
		color: #217a4d;
	}

	.folder-badge.warn {
		color: #8a5a00;
	}

	.install-option {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-top: 0.6rem;
		font-size: 0.74rem;
	}

	.project-details {
		margin: 0;
		padding-left: 1rem;
		color: var(--muted);
		font-size: 0.62rem;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}

	.danger-button {
		min-height: 34px;
		padding: 0 0.9rem;
		border: 1px solid #f1c7c3;
		border-radius: 8px;
		background: #fff;
		color: #b3261e;
		font: inherit;
		font-size: 0.72rem;
		font-weight: 650;
		cursor: pointer;
	}

	.danger-button.solid {
		border-color: #b3261e;
		background: #b3261e;
		color: #fff;
	}

	.danger-button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.link-button,
	.edit-link {
		border: 0;
		background: transparent;
		color: #7a70c4;
		font: inherit;
		font-size: 0.72rem;
		font-weight: 650;
		cursor: pointer;
	}

	.canvas-stage {
		display: flex;
		min-height: 520px;
		flex: 1;
		align-items: flex-start;
		justify-content: center;
		padding: 1.2rem;
		overflow: auto;
		border: 1px solid #ebebf1;
		border-radius: 12px;
		background-color: #efeff4;
		background-image: radial-gradient(#d8d8e2 0.7px, transparent 0.7px);
		background-size: 14px 14px;
	}

	.canvas-footnote {
		margin: 0.7rem 0 0;
		color: #999aab;
		font-size: 0.66rem;
		text-align: center;
	}

	.overview {
		width: min(100%, 34rem);
		padding: 1.4rem 1.5rem;
		border: 1px solid #ebebf1;
		border-radius: 14px;
		background: #fff;
		box-shadow: 0 8px 28px rgb(32 35 58 / 6%);
	}

	.overview header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.overview h3 {
		margin: 0;
		font-size: 1.15rem;
		letter-spacing: -0.02em;
		overflow-wrap: anywhere;
	}

	.overview h4 {
		margin: 1.2rem 0 0.4rem;
		font-size: 0.78rem;
	}

	.description {
		margin: 0.5rem 0 0;
		color: #65677e;
		font-size: 0.78rem;
		line-height: 1.55;
	}

	.facts {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.7rem 1rem;
		margin: 1.1rem 0 0;
	}

	.facts .wide {
		grid-column: 1 / -1;
	}

	.facts dt {
		color: var(--muted);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.facts dd {
		margin: 0.15rem 0 0;
		font-size: 0.8rem;
		overflow-wrap: anywhere;
	}

	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.74rem;
	}

	.theme-line {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.swatch {
		width: 14px;
		height: 14px;
		border: 1px solid rgb(0 0 0 / 12%);
		border-radius: 50%;
	}

	.callout {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		margin-top: 1.1rem;
		padding: 0.7rem 0.9rem;
		border: 1px solid #ddd8ff;
		border-radius: 10px;
		background: #faf9ff;
		color: #4b456f;
		font-size: 0.76rem;
		line-height: 1.5;
	}

	.checklist {
		display: grid;
		gap: 0.3rem;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.76rem;
	}

	.checklist li {
		color: #65677e;
	}

	.checklist li.done {
		color: #217a4d;
	}

	.shortcuts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 1.3rem;
	}

	.shortcuts button {
		flex: 0 1 auto;
		padding: 0 0.9rem;
	}

	.shortcuts .primary-action {
		border: 0;
		background: var(--purple);
		color: #fff;
	}

	.empty-state {
		display: flex;
		max-width: 26rem;
		flex-direction: column;
		align-items: center;
		align-self: center;
		gap: 0.2rem;
		padding: 2rem 1.5rem;
		border: 1px dashed #d4cff3;
		border-radius: 14px;
		background: #fff;
		color: #65677e;
		text-align: center;
	}

	.empty-state h3 {
		margin: 0;
		color: var(--ink);
		font-size: 1rem;
	}

	.empty-state p {
		margin: 0.2rem 0 0.9rem;
		font-size: 0.76rem;
		line-height: 1.55;
	}

	.primary-action {
		display: inline-flex;
		min-height: 36px;
		align-items: center;
		padding: 0 1.1rem;
		border: 0;
		border-radius: 9px;
		background: var(--purple);
		color: #fff;
		font: inherit;
		font-size: 0.76rem;
		font-weight: 700;
		text-decoration: none;
		cursor: pointer;
	}

	.primary-action:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	@media (max-width: 1050px) {
		.workspace {
			grid-template-columns: 220px minmax(0, 1fr);
		}

		.inspector-panel {
			grid-column: 1 / -1;
			border-top: 1px solid var(--line);
			border-left: 0;
		}
	}

	@media (max-width: 700px) {
		.workspace {
			grid-template-columns: 1fr;
		}
	}
</style>
