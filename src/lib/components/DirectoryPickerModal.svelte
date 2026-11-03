<script lang="ts">
	/**
	 * @component Local filesystem folder picker with explicit confirmation.
	 * @prop {boolean} open - Required, non-bindable visibility controlled by the parent.
	 * @prop {string} initialPath - Defaults to ''; loaded on first opening, otherwise resumes
	 * the last canonical directory. Changes while open do not trigger browsing.
	 * @prop {(path: string) => void} onselect - Required callback receiving the canonical
	 * selected directory only when Select this folder is pressed, followed by onclose.
	 * @prop {() => void} onclose - Required callback on Select this folder or Cancel only;
	 * the parent must set open=false. Outside clicks, navigation and Escape never dismiss.
	 *
	 * Provides an interactive modal dialog allowing users to browse and select
	 * local SvelteKit project folders directly on the server host:
	 * - Real-time breadcrumb navigation with clickable folder segments.
	 * - Root (`/`), home (`~`), and parent (`↑ Up`) quick-jump buttons.
	 * - Automatic detection badge for valid SvelteKit projects and for empty folders (usable by
	 * "Create new project").
	 * - Native modal dialog focus trapping and restoration, with Escape cancellation prevented.
	 * - Explicit auto margins preserve viewport centering against Tailwind's global margin reset.
	 * - Inline folder creation POSTs {path, name} to /editor/api/fs, then browses the
	 * returned canonical child without selecting or dismissing. Errors remain visible.
	 * - Navigation/selection/creation are gated during operations. An open-only attachment
	 * untracks path reads; aborted requests and generation checks isolate close/reopen cycles.
	 */
	import { untrack } from 'svelte';

	/**
	 * Component Properties.
	 */
	interface Props {
		/** Controls visibility of the modal dialog. */
		open: boolean;
		/** Initial directory path to load upon opening. */
		initialPath?: string;
		/** Callback invoked when user confirms folder selection. */
		onselect: (path: string) => void;
		/** Callback invoked only after explicit selection or cancellation. */
		onclose: () => void;
	}

	let { open, initialPath = '', onselect, onclose }: Props = $props();

	/** One canonical child directory returned by the filesystem endpoint. */
	type DirEntry = { name: string; path: string; isSvelteKit: boolean };
	/** Canonical directory listing; filesystem access belongs exclusively to the server. */
	type FsResponse = {
		current: string;
		parent: string | null;
		home: string;
		isSvelteKit: boolean;
		isEmpty?: boolean;
		directories: DirEntry[];
		error?: string;
	};

	let currentPath = $state('');
	let parentPath = $state<string | null>(null);
	let homePath = $state('');
	let isSvelteKit = $state(false);
	let isEmpty = $state(false);
	let directories = $state<DirEntry[]>([]);
	let loading = $state(false);
	let errorMessage = $state('');
	let creating = $state(false);
	let showCreateForm = $state(false);
	let folderName = $state('');
	let busy = $derived(loading || creating);
	const titleId = $props.id();
	// Both abort and generation checks are needed: an already-resolved response (or
	// a transport ignoring abort) must not mutate a later opening of the dialog.
	let requestGeneration = 0;
	let controller: AbortController | undefined;

	/** Invalidates every outstanding operation, including requests that ignore abort. */
	function invalidateRequests() {
		requestGeneration += 1;
		controller?.abort();
		controller = undefined;
	}

	/** Loads one canonical listing; only the latest request in an open session may commit. */
	async function loadDirectory(path: string) {
		invalidateRequests();
		const generation = requestGeneration;
		controller = new AbortController();
		loading = true;
		errorMessage = '';
		try {
			const query = path ? `?path=${encodeURIComponent(path)}` : '';
			const res = await fetch(`/editor/api/fs${query}`, { signal: controller.signal });
			const data = (await res.json()) as FsResponse;
			if (generation !== requestGeneration || !open) return;
			if (!res.ok) throw new Error(data.error || 'Failed to browse directory');

			currentPath = data.current;
			parentPath = data.parent;
			homePath = data.home;
			isSvelteKit = data.isSvelteKit;
			isEmpty = data.isEmpty ?? false;
			directories = data.directories;
		} catch (err) {
			if (generation !== requestGeneration || !open) return;
			errorMessage = err instanceof Error ? err.message : 'Error accessing directory';
		} finally {
			if (generation === requestGeneration && open) loading = false;
		}
	}

	/** Opens in the browser top layer; closing before removal restores the opener's focus. */
	function attachDialog(dialog: HTMLDialogElement) {
		const opener = document.activeElement;
		dialog.showModal();
		// The conditional dialog mounts only on open transitions. Untrack path and form
		// state so listing results cannot reattach/reload or steal focus.
		untrack(() => {
			creating = false;
			showCreateForm = false;
			folderName = '';
			void loadDirectory(currentPath || initialPath);
		});
		return () => {
			invalidateRequests();
			dialog.close();
			if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
		};
	}

	/**
	 * Wraps Tab at dialog boundaries so keyboard focus stays on controls rather than
	 * traversing browser chrome. Native modality still makes all outside content inert.
	 */
	function handleDialogKeydown(event: KeyboardEvent) {
		if (event.key !== 'Tab') return;
		const dialog = event.currentTarget as HTMLDialogElement;
		const controls = dialog.querySelectorAll<HTMLElement>(
			'button:not(:disabled), input:not(:disabled)'
		);
		const first = controls[0];
		const last = controls[controls.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last?.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first?.focus();
		}
	}

	/** Navigation is never a dismissal and cannot race creation or another listing. */
	function navigate(path: string) {
		if (!busy) void loadDirectory(path);
	}

	/** Cancels outstanding work before notifying the parent of explicit dismissal. */
	function handleCancel() {
		invalidateRequests();
		onclose();
	}

	/** Selection is explicit and only available for a successfully loaded canonical path. */
	function handleSelect() {
		if (currentPath && !busy && !errorMessage) {
			onselect(currentPath);
			handleCancel();
		}
	}

	/** Creates exactly one child folder and navigates into it without firing callbacks. */
	async function createFolder(event: SubmitEvent) {
		event.preventDefault();
		if (busy || !currentPath) return;
		const name = folderName.trim();
		if (!name || name === '.' || name === '..' || /[/\\]/.test(name) || name.includes('\0')) {
			errorMessage = 'Enter a single folder name, without slashes.';
			return;
		}
		invalidateRequests();
		const generation = requestGeneration;
		controller = new AbortController();
		creating = true;
		errorMessage = '';
		try {
			const res = await fetch('/editor/api/fs', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ path: currentPath, name }),
				signal: controller.signal
			});
			const data = (await res.json()) as { path?: string; error?: string };
			if (generation !== requestGeneration || !open) return;
			if (!res.ok || !data.path) throw new Error(data.error || 'Failed to create folder');
			currentPath = data.path;
			showCreateForm = false;
			folderName = '';
			creating = false;
			// loadDirectory starts a new generation; it owns loading until its final response.
			await loadDirectory(data.path);
		} catch (err) {
			if (generation !== requestGeneration || !open) return;
			errorMessage = err instanceof Error ? err.message : 'Failed to create folder';
		} finally {
			// After navigation, creation no longer owns the generation. On close/reopen
			// cleanup aborted this controller, so an old completion cannot clear new state.
			if (generation === requestGeneration && open) creating = false;
		}
	}

	let breadcrumbs = $derived.by(() => {
		if (!currentPath) return [];
		const parts = currentPath.split('/').filter(Boolean);
		let acc = '';
		return parts.map((part) => {
			acc += `/${part}`;
			return { name: part, path: acc };
		});
	});
</script>

{#if open}
	<dialog
		class="modal-window"
		aria-labelledby={titleId}
		oncancel={(event) => event.preventDefault()}
		onkeydown={handleDialogKeydown}
		{@attach attachDialog}
	>
		<div class="modal-header">
			<div class="modal-title-group">
				<span class="folder-icon" aria-hidden="true">📁</span>
				<div>
					<h2 id={titleId}>Choose SvelteKit Project Folder</h2>
					<p class="modal-subtitle">
						Browse your local file system to select the project directory
					</p>
				</div>
			</div>
		</div>

		<div class="path-bar">
			<button
				type="button"
				class="nav-btn"
				title="Root directory"
				disabled={busy}
				onclick={() => navigate('/')}>/</button
			>
			{#if homePath}
				<button
					type="button"
					class="nav-btn"
					title="Home directory"
					disabled={busy}
					onclick={() => navigate(homePath)}>~</button
				>
			{/if}
			{#if parentPath}
				<button
					type="button"
					class="nav-btn"
					title="Up one level"
					disabled={busy}
					onclick={() => navigate(parentPath!)}>↑ Up</button
				>
			{/if}
			<div class="breadcrumbs">
				{#each breadcrumbs as crumb, i (crumb.path)}
					<span class="crumb-sep" aria-hidden="true">/</span>
					{#if i === breadcrumbs.length - 1}
						<strong class="crumb current">{crumb.name}</strong>
					{:else}
						<button type="button" class="crumb" disabled={busy} onclick={() => navigate(crumb.path)}
							>{crumb.name}</button
						>
					{/if}
				{/each}
			</div>
		</div>

		{#if isSvelteKit}
			<div class="sveltekit-badge">
				<span class="badge-icon">✳</span>
				<span>Valid SvelteKit project directory detected</span>
			</div>
		{/if}

		{#if isEmpty}
			<div class="sveltekit-badge empty-badge">
				<span class="badge-icon">○</span>
				<span>Empty folder – ready for a new project</span>
			</div>
		{/if}

		{#if errorMessage}
			<div class="error-banner" role="alert">{errorMessage}</div>
		{/if}

		<div class="dir-list-container">
			{#if loading}
				<div class="loading-state">Loading folders…</div>
			{:else if directories.length === 0}
				<div class="empty-state">No subdirectories found</div>
			{:else}
				<ul class="dir-list" role="list">
					{#each directories as dir (dir.path)}
						<li>
							<button
								type="button"
								class="dir-item"
								class:highlight-project={dir.isSvelteKit}
								disabled={busy}
								onclick={() => navigate(dir.path)}
							>
								<span class="item-icon" aria-hidden="true">{dir.isSvelteKit ? '✳' : '📁'}</span>
								<span class="item-name">{dir.name}</span>
								{#if dir.isSvelteKit}
									<span class="project-pill">SvelteKit</span>
								{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<div class="create-folder">
			{#if showCreateForm}
				<form onsubmit={createFolder}>
					<label for={`${titleId}-folder`}>Folder name</label>
					<div class="create-fields">
						<input
							id={`${titleId}-folder`}
							bind:value={folderName}
							disabled={busy}
							autocomplete="off"
							{@attach (input) => input.focus()}
						/>
						<button type="submit" class="btn-cancel" disabled={busy}>
							{creating ? 'Creating…' : 'Create folder'}
						</button>
					</div>
				</form>
			{:else}
				<button
					type="button"
					class="btn-cancel"
					disabled={busy || !currentPath}
					onclick={() => (showCreateForm = true)}>Create new folder</button
				>
			{/if}
		</div>

		<div class="modal-footer">
			<div class="selected-preview">
				<small>Selected path:</small>
				<code title={currentPath}>{currentPath}</code>
			</div>
			<div class="footer-actions">
				<button type="button" class="btn-cancel" onclick={handleCancel}>Cancel</button>
				<button
					type="button"
					class="btn-confirm"
					disabled={!currentPath || busy || !!errorMessage}
					onclick={handleSelect}
				>
					Select this folder
				</button>
			</div>
		</div>
	</dialog>
{/if}

<style>
	.modal-window::backdrop {
		background: rgba(18, 20, 32, 0.45);
		backdrop-filter: blur(2px);
	}

	.modal-window {
		margin: auto;
		background: #ffffff;
		border-radius: 12px;
		padding: 0;
		width: calc(100% - 2rem);
		max-width: 620px;
		max-height: 85vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 16px 40px rgba(0, 0, 0, 0.18);
		border: 1px solid #e2e0ed;
		overflow: hidden;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid #e9e8f2;
	}

	.modal-title-group {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.folder-icon {
		font-size: 1.5rem;
	}

	h2 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
		color: #20233a;
	}

	.modal-subtitle {
		margin: 0.1rem 0 0;
		font-size: 0.74rem;
		color: #898ba0;
	}

	.create-folder {
		padding: 0.6rem 1.25rem;
		border-top: 1px solid #e9e8f2;
	}

	.create-folder label {
		display: block;
		margin-bottom: 0.3rem;
		color: #4b456f;
		font-size: 0.75rem;
	}

	.create-fields {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.create-fields input {
		flex: 1;
		min-width: 0;
		border: 1px solid #dcd9e9;
		border-radius: 6px;
		padding: 0.4rem 0.5rem;
		font: inherit;
		font-size: 0.78rem;
	}

	button:disabled,
	input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.path-bar {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.6rem 1.25rem;
		background: #f7f7fa;
		border-bottom: 1px solid #e9e8f2;
		overflow-x: auto;
	}

	.nav-btn {
		background: #fff;
		border: 1px solid #dcd9e9;
		border-radius: 6px;
		padding: 0.25rem 0.5rem;
		font-size: 0.72rem;
		font-weight: 600;
		color: #4b456f;
		cursor: pointer;
		flex-shrink: 0;
	}

	.nav-btn:hover {
		background: #eeeaff;
		border-color: #c9c1ff;
	}

	.breadcrumbs {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		white-space: nowrap;
		font-size: 0.75rem;
	}

	.crumb-sep {
		color: #aaa8bc;
	}

	.crumb {
		background: transparent;
		border: 0;
		color: #6b5ce7;
		font-size: inherit;
		cursor: pointer;
		padding: 0.15rem 0.25rem;
		border-radius: 4px;
	}

	.crumb:hover {
		text-decoration: underline;
		background: #eeeaff;
	}

	.crumb.current {
		color: #20233a;
		font-weight: 600;
		cursor: default;
		text-decoration: none;
	}

	.sveltekit-badge {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 1.25rem;
		background: #eef9f2;
		color: #177a41;
		font-size: 0.75rem;
		font-weight: 600;
		border-bottom: 1px solid #d2eed9;
	}

	.empty-badge {
		background: #eef4fb;
		color: #1e4f8a;
		border-bottom-color: #d3e3f5;
	}

	.badge-icon {
		font-size: 0.9rem;
	}

	.error-banner {
		padding: 0.5rem 1.25rem;
		background: #fdf2f2;
		color: #b3261e;
		font-size: 0.75rem;
		border-bottom: 1px solid #fadad7;
	}

	.dir-list-container {
		flex: 1;
		min-height: 220px;
		max-height: 340px;
		overflow-y: auto;
		padding: 0.5rem;
	}

	.dir-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.dir-item {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid transparent;
		border-radius: 8px;
		background: transparent;
		color: #20233a;
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
		text-align: left;
	}

	.dir-item:hover {
		background: #f3f2f9;
		border-color: #e4e2f0;
	}

	.dir-item.highlight-project {
		background: #faf8ff;
		border-color: #ded9ff;
	}

	.dir-item.highlight-project:hover {
		background: #f0edff;
		border-color: #c9c1ff;
	}

	.item-icon {
		font-size: 1.05rem;
		flex-shrink: 0;
	}

	.item-name {
		flex: 1;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.project-pill {
		font-size: 0.65rem;
		padding: 0.15rem 0.45rem;
		border-radius: 4px;
		background: #6b5ce7;
		color: #fff;
		font-weight: 600;
	}

	.loading-state,
	.empty-state {
		padding: 2.5rem 1rem;
		text-align: center;
		color: #898ba0;
		font-size: 0.85rem;
	}

	.modal-footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		padding: 0.85rem 1.25rem;
		border-top: 1px solid #e9e8f2;
		background: #fafafc;
		gap: 1rem;
	}

	.selected-preview {
		display: flex;
		flex-direction: column;
		flex: 1 1 10rem;
		min-width: 0;
		gap: 0.15rem;
		overflow: hidden;
	}

	.selected-preview small {
		font-size: 0.65rem;
		color: #898ba0;
		text-transform: uppercase;
		font-weight: 600;
	}

	.selected-preview code {
		font-size: 0.75rem;
		color: #33354a;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.footer-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.btn-cancel,
	.btn-confirm {
		padding: 0.45rem 0.85rem;
		border-radius: 7px;
		font-size: 0.78rem;
		font-weight: 650;
		cursor: pointer;
	}

	.btn-cancel {
		background: #fff;
		border: 1px solid #dcd9e9;
		color: #4b456f;
	}

	.btn-cancel:hover {
		background: #f5f4fa;
	}

	.btn-confirm {
		background: #6b5ce7;
		border: 1px solid #6b5ce7;
		color: #fff;
	}

	.btn-confirm:hover:not(:disabled) {
		background: #5949d2;
	}

	.btn-confirm:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@media (max-height: 650px) {
		.dir-list-container {
			min-height: 80px;
		}

		.modal-window {
			overflow-y: auto;
		}
	}
</style>
