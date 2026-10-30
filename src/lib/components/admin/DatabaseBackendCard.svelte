<script lang="ts">
	/**
	 * @component DatabaseBackendCard
	 *
	 * Admin card to inspect, test and switch the application's storage backend (SQLite file or
	 * PostgreSQL). Posts to the `?/testConnection` and `?/switch` form actions of `/admin`.
	 *
	 * ## Security decisions
	 * - The PostgreSQL URL is entered in a plain, readable text field (so it can be checked and
	 *   copied) next to a connection builder. It is **never** pre-filled and is cleared from client
	 *   state after a successful switch. The server never returns it; the active URL is only shown
	 *   masked (`******host:port/db`).
	 * - The builder's password input has no `name`, so it is never submitted on its own; only the
	 *   assembled URL (user and password percent-encoded by `postgres-url.ts`) is posted.
	 * - Overwriting a database (`replace`) needs an explicit tick **and** the typed word `REPLACE`;
	 *   the button stays disabled until both are given (the server re-validates).
	 * - Pressing Enter inside a field submits via the *first* submit button, which is the harmless
	 *   "Test connection".
	 *
	 * ## Connection builder
	 * Host / port / database / user / password / TLS mode fields and the URL field are kept in sync
	 * through event handlers (no effects): editing a builder field rebuilds the URL, editing or
	 * pasting a URL re-fills the builder when it parses.
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
	import {
		buildPostgresUrl,
		emptyPostgresParts,
		parsePostgresUrl,
		sslModeOptions,
		type PostgresUrlParts
	} from '../../admin/postgres-url.js';
	import PasswordInput from '../PasswordInput.svelte';

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
	let pgParts = $state<PostgresUrlParts>(emptyPostgresParts());
	let pgPasswordRevealed = $state(false);
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

	/** Builder field edited: regenerate the URL from the parts. */
	function onPartsInput() {
		postgresUrl = buildPostgresUrl(pgParts);
	}

	/** URL edited or pasted: mirror it into the builder when it is a parsable PostgreSQL URL. */
	function onUrlInput() {
		const parsed = parsePostgresUrl(postgresUrl);
		if (parsed) pgParts = parsed;
	}

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
				pgParts = emptyPostgresParts();
				pgPasswordRevealed = false;
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
				<input
					class="field-control mono"
					type="text"
					name="postgresUrl"
					bind:value={postgresUrl}
					oninput={onUrlInput}
					maxlength="2000"
					spellcheck="false"
					autocomplete="off"
					autocapitalize="off"
					placeholder="postgresql://host:5432/database"
					aria-describedby="pg-help"
				/>
			</label>
			<p id="pg-help" class="hint">
				Paste a URL or build one below. It is sent to the server and stored there only; it is never
				shown again — the active connection appears masked.
			</p>

			<details class="builder" open>
				<summary>Connection builder</summary>
				<div class="builder-grid">
					<label class="field">
						<span class="field-label">Host</span>
						<input
							class="field-control"
							bind:value={pgParts.host}
							oninput={onPartsInput}
							spellcheck="false"
							autocomplete="off"
							placeholder="db.example.com"
						/>
					</label>
					<label class="field">
						<span class="field-label">Port</span>
						<input
							class="field-control"
							bind:value={pgParts.port}
							oninput={onPartsInput}
							inputmode="numeric"
							pattern="[0-9]*"
							maxlength="5"
							autocomplete="off"
							placeholder="5432"
						/>
					</label>
					<label class="field">
						<span class="field-label">Database</span>
						<input
							class="field-control"
							bind:value={pgParts.database}
							oninput={onPartsInput}
							spellcheck="false"
							autocomplete="off"
							placeholder="app"
						/>
					</label>
					<label class="field">
						<span class="field-label">User</span>
						<input
							class="field-control"
							bind:value={pgParts.user}
							oninput={onPartsInput}
							spellcheck="false"
							autocomplete="off"
							placeholder="postgres"
						/>
					</label>
					<div class="field">
						<label class="field-label" for="pg-password">Password</label>
						<!-- No `name`: the builder password is not submitted, only the assembled URL is. -->
						<PasswordInput
							id="pg-password"
							bind:value={pgParts.password}
							bind:revealed={pgPasswordRevealed}
							oninput={onPartsInput}
							autocomplete="new-password"
							spellcheck="false"
						/>
					</div>
					<label class="field">
						<span class="field-label">Encryption (TLS)</span>
						<select class="field-control" bind:value={pgParts.sslMode} onchange={onPartsInput}>
							{#each sslModeOptions as option (option.value)}
								<option value={option.value}>{option.label}</option>
							{/each}
						</select>
					</label>
				</div>
				<p class="hint">
					Special characters in the user name or password are percent-encoded automatically. The
					password also appears in the URL field above. Encryption “Automatic” uses verified TLS for
					remote hosts and none for localhost.
				</p>
			</details>
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

<style>
	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.9rem;
	}

	.builder {
		margin: 0.75rem 0 1rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--line);
		border-radius: 0.6rem;
	}

	.builder summary {
		cursor: pointer;
		font-weight: 600;
	}

	.builder-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 0.75rem 1rem;
		margin-top: 0.75rem;
	}
</style>
