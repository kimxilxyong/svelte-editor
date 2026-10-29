<script lang="ts">
	/**
	 * @component DatabaseBackendCard
	 *
	 * Admin card to inspect, test and switch the application's storage backend (SQLite file or
	 * PostgreSQL). Posts to the `?/testConnection` and `?/switch` form actions of `/admin`.
	 *
	 * ## Security decisions
	 * - The PostgreSQL URL is entered in a `type="password"` field, is **never** pre-filled and is
	 *   cleared from client state after a successful switch. The server never returns it; the active
	 *   URL is only shown masked (`******host:port/db`).
	 * - Overwriting a database (`replace`) needs an explicit tick **and** the typed word `REPLACE`;
	 *   the button stays disabled until both are given (the server re-validates).
	 * - Pressing Enter inside a field submits via the *first* submit button, which is the harmless
	 *   "Test connection".
	 *
	 * ## State
	 * Feedback is kept in local `$state` (from the `use:enhance` result) so it survives submissions
	 * of other cards; the `form` prop provides the same data for the no-JavaScript fallback.
	 *
	 * @prop {BackendSummary} backend - Active backend (masked location).
	 * @prop {DatabaseFeedback | null} [form=null] - Result of the last database action (fallback).
	 *
	 * @example
	 * <DatabaseBackendCard backend={data.backend} form={dbForm} />
	 */
	import { enhance, type SubmitFunction } from '$app/forms';
	import { untrack } from 'svelte';
	import type { BackendSummary, DatabaseFeedback, DataMode } from '../../admin/types.js';

	interface Props {
		backend: BackendSummary;
		form?: DatabaseFeedback | null;
	}

	let { backend, form = null }: Props = $props();

	/** Word the admin must type to allow overwriting the target (mirrors the server constant). */
	const REPLACE_WORD = 'REPLACE';

	// Initial form state is intentionally a one-time snapshot of the props; afterwards the user's
	// input is the source of truth (a switch invalidates the page, which must not reset the form).
	let target = $state<'sqlite' | 'postgres'>(
		untrack(() => form?.values.backend ?? backend.backend)
	);
	let sqlitePath = $state(
		untrack(() => form?.values.sqlitePath || (backend.backend === 'sqlite' ? backend.location : ''))
	);
	let postgresUrl = $state('');
	let dataMode = $state<DataMode>(untrack(() => form?.values.dataMode ?? 'copy'));
	let confirmReplace = $state(false);
	let confirmText = $state('');
	let pending = $state<'testConnection' | 'switch' | null>(null);
	let latest = $state<DatabaseFeedback | null>(null);

	const feedback = $derived(latest ?? form);
	const replaceReady = $derived(
		dataMode !== 'replace' || (confirmReplace && confirmText.trim() === REPLACE_WORD)
	);
	const sourceLabels = {
		'config-file': 'saved configuration',
		env: 'DATABASE_URL environment variable',
		default: 'built-in default'
	} as const;
	const dataModes: { id: DataMode; label: string; help: string }[] = [
		{
			id: 'copy',
			label: 'Copy',
			help: 'Copy all current data into the target. The target must be empty (no users).'
		},
		{
			id: 'replace',
			label: 'Replace',
			help: 'Erase the target’s tables, then copy all current data into it.'
		},
		{
			id: 'keep',
			label: 'Keep',
			help: 'Use the data already in the target as it is. It needs an active admin account.'
		}
	];

	const handleSubmit: SubmitFunction = ({ action }) => {
		pending = action.search.startsWith('?/switch') ? 'switch' : 'testConnection';
		latest = null;
		return async ({ result, update }) => {
			pending = null;
			if (result.type === 'success' || result.type === 'failure') {
				latest = result.data as unknown as DatabaseFeedback;
			}
			if (result.type === 'success' && (result.data as DatabaseFeedback | undefined)?.switched) {
				// The credential must not linger in the browser once it has been used.
				postgresUrl = '';
				confirmReplace = false;
				confirmText = '';
			}
			// reset:false keeps what the admin typed, so a typo can be fixed without retyping.
			await update({ reset: false });
		};
	};
</script>

<section class="card" aria-labelledby="db-title">
	<div class="card-head">
		<div>
			<p class="eyebrow">Storage</p>
			<h2 id="db-title">Database backend</h2>
		</div>
		<span class="pill" title="Active backend">
			{backend.backend === 'postgres' ? 'PostgreSQL' : 'SQLite'}
		</span>
	</div>

	<dl class="facts">
		<dt>Location</dt>
		<dd><code>{backend.location}</code></dd>
		<dt>Configured by</dt>
		<dd>{sourceLabels[backend.source]}</dd>
		<dt>Server version</dt>
		<dd>{backend.serverVersion ?? 'unknown'}</dd>
		<dt>Users</dt>
		<dd>{backend.userCount}</dd>
	</dl>

	<form method="POST" use:enhance={handleSubmit} autocomplete="off">
		<fieldset>
			<legend>Target backend</legend>
			<label class="choice">
				<input type="radio" name="backend" value="sqlite" bind:group={target} />
				<span>SQLite <small>A local file; no server needed.</small></span>
			</label>
			<label class="choice">
				<input type="radio" name="backend" value="postgres" bind:group={target} />
				<span>PostgreSQL <small>A remote database server.</small></span>
			</label>
		</fieldset>

		{#if target === 'sqlite'}
			<label class="field">
				<span class="field-label">SQLite file path</span>
				<input
					class="field-control"
					name="sqlitePath"
					bind:value={sqlitePath}
					maxlength="300"
					spellcheck="false"
					placeholder="e.g. data/app.db"
					aria-describedby="sqlite-help"
				/>
			</label>
			<p id="sqlite-help" class="hint">
				Relative paths are resolved against the server’s working directory; the folder must exist.
			</p>
		{:else}
			<label class="field">
				<span class="field-label">PostgreSQL connection URL</span>
				<!-- type=password: masks shoulder-surfing and keeps browsers from storing it as text. -->
				<input
					class="field-control"
					type="password"
					name="postgresUrl"
					bind:value={postgresUrl}
					maxlength="2000"
					spellcheck="false"
					autocomplete="off"
					placeholder="postgres://user:password@host:5432/database"
					aria-describedby="pg-help"
				/>
			</label>
			<p id="pg-help" class="hint">
				Stored only on the server. It is never shown again — the active connection appears masked.
			</p>
		{/if}

		<fieldset>
			<legend>What happens to the existing data? (applies to “Switch backend”)</legend>
			{#each dataModes as mode (mode.id)}
				<label class="choice">
					<input type="radio" name="dataMode" value={mode.id} bind:group={dataMode} />
					<span>{mode.label} <small>{mode.help}</small></span>
				</label>
			{/each}
		</fieldset>

		{#if dataMode === 'replace'}
			<div class="notice error" role="group" aria-label="Confirm overwrite">
				<strong>This permanently erases the target database’s contents.</strong>
				<label class="choice">
					<input type="checkbox" name="confirmReplace" bind:checked={confirmReplace} />
					<span>I understand that all existing data in the target will be deleted.</span>
				</label>
				<label class="field">
					<span class="field-label">Type {REPLACE_WORD} to confirm</span>
					<input
						class="field-control"
						name="confirmText"
						bind:value={confirmText}
						autocomplete="off"
						spellcheck="false"
						maxlength="20"
					/>
				</label>
			</div>
		{/if}

		<p class="hint">
			Switching keeps you signed in: sessions are copied together with the data (modes
			<em>Copy</em> and <em>Replace</em>). With <em>Keep</em> the target’s own accounts apply, so you
			will have to sign in again there.
		</p>

		<div class="row">
			<button class="btn" type="submit" formaction="?/testConnection" disabled={pending !== null}>
				{pending === 'testConnection' ? 'Testing…' : 'Test connection'}
			</button>
			<button
				class="btn primary"
				type="submit"
				formaction="?/switch"
				disabled={pending !== null || !replaceReady}
			>
				{pending === 'switch' ? 'Switching…' : 'Switch backend'}
			</button>
		</div>
	</form>

	<div aria-live="polite">
		{#if feedback?.error}
			<p class="notice error" role="alert">
				{feedback.action === 'switch' ? 'Switch failed: ' : 'Connection failed: '}{feedback.error}
			</p>
		{:else if feedback?.test}
			<div class="notice ok" role="status">
				<strong>Connection successful.</strong>
				<dl>
					<dt>Server version</dt>
					<dd>{feedback.test.serverVersion ?? 'unknown'}</dd>
					<dt>Schema present</dt>
					<dd>{feedback.test.hasSchema ? 'yes' : 'no (will be created on switch)'}</dd>
					<dt>Users</dt>
					<dd>{feedback.test.userCount}</dd>
					<dt>Active admins</dt>
					<dd>{feedback.test.adminCount}</dd>
				</dl>
			</div>
		{:else if feedback?.switched}
			<div class="notice ok" role="status">
				<strong>
					Switched to {feedback.switched.backend === 'postgres' ? 'PostgreSQL' : 'SQLite'}
					(<code>{feedback.switched.location}</code>).
				</strong>
				{#if feedback.switched.dataMode === 'keep'}
					<p>The target’s existing data is in use; you may need to sign in again.</p>
				{:else if Object.keys(feedback.switched.copied).length === 0}
					<p>That backend was already active; no data was copied.</p>
				{:else}
					<p>Rows copied (your session was copied as well, so you stay signed in):</p>
					<dl>
						{#each Object.entries(feedback.switched.copied) as [table, count] (table)}
							<dt><code>{table}</code></dt>
							<dd>{count}</dd>
						{/each}
					</dl>
				{/if}
			</div>
		{/if}
	</div>
</section>
