<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		open: boolean;
		initialPath?: string;
		onselect: (path: string) => void;
		onclose: () => void;
	}

	let { open, initialPath = '', onselect, onclose }: Props = $props();

	type DirEntry = { name: string; path: string; isSvelteKit: boolean };
	type FsResponse = {
		current: string;
		parent: string | null;
		home: string;
		isSvelteKit: boolean;
		directories: DirEntry[];
		error?: string;
	};

	let currentPath = $state('');
	let parentPath = $state<string | null>(null);
	let homePath = $state('');
	let isSvelteKit = $state(false);
	let directories = $state<DirEntry[]>([]);
	let loading = $state(false);
	let errorMessage = $state('');

	async function loadDirectory(path: string) {
		loading = true;
		errorMessage = '';
		try {
			const query = path ? `?path=${encodeURIComponent(path)}` : '';
			const res = await fetch(`/editor/api/fs${query}`);
			const data = (await res.json()) as FsResponse;
			if (!res.ok) throw new Error(data.error || 'Failed to browse directory');

			currentPath = data.current;
			parentPath = data.parent;
			homePath = data.home;
			isSvelteKit = data.isSvelteKit;
			directories = data.directories;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Error accessing directory';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (open) {
			loadDirectory(currentPath || initialPath);
		}
	});

	function handleSelect() {
		if (currentPath) {
			onselect(currentPath);
			onclose();
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
	<div
		class="modal-backdrop"
		role="presentation"
		onclick={onclose}
		onkeydown={(e) => {
			if (e.key === 'Escape') onclose();
		}}
	>
		<div
			class="modal-window"
			role="dialog"
			aria-modal="true"
			aria-labelledby="modal-title"
			tabindex="-1"
		>
			<div class="modal-header">
				<div class="modal-title-group">
					<span class="folder-icon" aria-hidden="true">📁</span>
					<div>
						<h2 id="modal-title">Choose SvelteKit Project Folder</h2>
						<p class="modal-subtitle">
							Browse your local file system to select the project directory
						</p>
					</div>
				</div>
				<button type="button" class="close-btn" aria-label="Close" onclick={onclose}>✕</button>
			</div>

			<div class="path-bar">
				<button
					type="button"
					class="nav-btn"
					title="Root directory"
					onclick={() => loadDirectory('/')}>/</button
				>
				{#if homePath}
					<button
						type="button"
						class="nav-btn"
						title="Home directory"
						onclick={() => loadDirectory(homePath)}>~</button
					>
				{/if}
				{#if parentPath}
					<button
						type="button"
						class="nav-btn"
						title="Up one level"
						onclick={() => loadDirectory(parentPath!)}>↑ Up</button
					>
				{/if}
				<div class="breadcrumbs">
					{#each breadcrumbs as crumb, i (crumb.path)}
						<span class="crumb-sep" aria-hidden="true">/</span>
						{#if i === breadcrumbs.length - 1}
							<strong class="crumb current">{crumb.name}</strong>
						{:else}
							<button type="button" class="crumb" onclick={() => loadDirectory(crumb.path)}
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
									onclick={() => loadDirectory(dir.path)}
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

			<div class="modal-footer">
				<div class="selected-preview">
					<small>Selected path:</small>
					<code title={currentPath}>{currentPath}</code>
				</div>
				<div class="footer-actions">
					<button type="button" class="btn-cancel" onclick={onclose}>Cancel</button>
					<button
						type="button"
						class="btn-confirm"
						disabled={!currentPath || loading}
						onclick={handleSelect}
					>
						Select this folder
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(18, 20, 32, 0.45);
		backdrop-filter: blur(2px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 1rem;
	}

	.modal-window {
		background: #ffffff;
		border-radius: 12px;
		width: 100%;
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

	.close-btn {
		background: transparent;
		border: 0;
		font-size: 1.1rem;
		color: #898ba0;
		cursor: pointer;
		padding: 0.3rem;
		border-radius: 6px;
	}

	.close-btn:hover {
		background: #f1f0f7;
		color: #20233a;
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
</style>
