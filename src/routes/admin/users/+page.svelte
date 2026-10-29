<script lang="ts">
	/**
	 * @component AdminUsersPage
	 *
	 * `/admin/users` – manage accounts.
	 *
	 * - **List**: search text, role and status filters and paging. The state lives in the URL
	 *   (`?q=&role=&status=&page=&size=`): the filter form is a plain GET form that SvelteKit
	 *   turns into client navigation, so Back/Forward and reload reproduce the view.
	 * - **Actions** (form actions + `use:enhance`): create, edit (name, email, role, status),
	 *   inline role change, admin password reset, delete with confirmation.
	 * - **Dialogs** use the native `<dialog>` (focus trap, Esc, focus restoration); server
	 *   errors (e.g. "last active admin") are shown inside the dialog that caused them.
	 * - **Self-protection**: the own row cannot be deleted, demoted or disabled (UI hides the
	 *   controls; the server refuses the same).
	 * - **Responsive**: the table turns into stacked cards below 52rem (`data-label` + CSS).
	 *
	 * @prop {import('./$types').PageData} data - Users of the current page, total, normalised query and own id.
	 * @prop {import('./$types').ActionData} form - Result of the last action (used when JavaScript is off).
	 */
	import { enhance, type SubmitFunction } from '$app/forms';
	import { resolve } from '$app/paths';
	import { tick } from 'svelte';
	import { formatTimestamp } from '../../../lib/admin/format.js';
	import type { UserActionFeedback } from '../../../lib/admin/types.js';
	import { pageSizes, usersQueryToSearch } from '../../../lib/admin/users-query.js';
	import { roleInfo, roles } from '../../../lib/auth/roles.js';
	import { providerLabels, type UserRecord } from '../../../lib/auth/types.js';
	import AdminShell from '../../../lib/components/admin/AdminShell.svelte';
	import ModalDialog from '../../../lib/components/admin/ModalDialog.svelte';
	import PasswordField from '../../../lib/components/admin/PasswordField.svelte';
	import RoleBadge from '../../../lib/components/RoleBadge.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	type Busy = UserActionFeedback['action'] | null;

	let showCreate = $state(false);
	let editTarget = $state<UserRecord | null>(null);
	let resetTarget = $state<UserRecord | null>(null);
	let deleteTarget = $state<UserRecord | null>(null);
	let busy = $state<Busy>(null);
	let latest = $state<UserActionFeedback | null>(null);
	let createPassword = $state('');
	let resetPassword = $state('');

	const feedback = $derived(
		latest ??
			(form && 'section' in form && form.section === 'users' ? (form as UserActionFeedback) : null)
	);
	/** Banner: successes and the inline role select (which has no dialog of its own). */
	const bannerFeedback = $derived(
		feedback && (feedback.ok || feedback.action === 'setRole') ? feedback : null
	);

	const query = $derived(data.query);
	const pageCount = $derived(Math.max(1, Math.ceil(data.total / query.pageSize)));
	const firstShown = $derived(data.total === 0 ? 0 : (query.page - 1) * query.pageSize + 1);
	const lastShown = $derived(Math.min(data.total, query.page * query.pageSize));
	const hasFilters = $derived(Boolean(query.q || query.role || query.status));

	/** Error to show inside a dialog: only failures of that dialog's action and user. */
	function dialogError(action: UserActionFeedback['action'], userId?: string): string | null {
		const f = feedback;
		if (!f || f.ok || f.action !== action) return null;
		return (f.userId ?? undefined) === userId ? f.message : null;
	}

	function closeDialogs() {
		showCreate = false;
		editTarget = null;
		resetTarget = null;
		deleteTarget = null;
	}

	/**
	 * Builds the `use:enhance` callback for an action.
	 * @param action - Which action the form submits (drives the busy label and the feedback).
	 * @param options - `reset`: reset the form after success (dialogs re-render anyway, the inline
	 *   select must not). `revert`: undo optimistic UI (the inline role select) when not successful.
	 */
	function submitting(
		action: UserActionFeedback['action'],
		options: { reset?: boolean; revert?: (form: HTMLFormElement) => void } = {}
	): SubmitFunction {
		return ({ formElement }) => {
			busy = action;
			latest = null;
			return async ({ result, update }) => {
				busy = null;
				if (result.type === 'success' || result.type === 'failure') {
					latest = result.data as unknown as UserActionFeedback;
				}
				if (result.type === 'success') {
					closeDialogs();
					createPassword = '';
					resetPassword = '';
				} else {
					options.revert?.(formElement);
				}
				await update({ reset: options.reset ?? true });
				if (result.type === 'success' && action !== 'setRole') {
					// The opener (e.g. a deleted row's button) may be gone: announce the result and
					// give keyboard users a sensible place to continue from.
					await tick();
					document.getElementById('users-feedback')?.focus();
				}
			};
		};
	}

	/** Enhance callback of the inline role select; a refused change puts the old role back. */
	function submittingRole(user: UserRecord): SubmitFunction {
		return submitting('setRole', {
			reset: false,
			revert: (formElement) => {
				const select = formElement.elements.namedItem('role');
				if (select instanceof HTMLSelectElement) select.value = user.role;
			}
		});
	}

	/**
	 * Search parameters (without the leading `?`) of another page of the same list. Used as
	 * `resolve(`/admin/users?${…}`)`; for page 1 without filters this yields a harmless trailing `?`.
	 */
	function pageParams(page: number): string {
		return usersQueryToSearch(query, { page }).slice(1);
	}

	/** Submits the surrounding form when a role `<select>` changes. */
	function submitOnChange(event: Event) {
		(event.currentTarget as HTMLSelectElement).form?.requestSubmit();
	}
</script>

<svelte:head>
	<title>Users · Administration</title>
</svelte:head>

<AdminShell title="Users" eyebrow="Admin" active="users">
	{#snippet actions()}
		<button class="btn primary" type="button" onclick={() => (showCreate = true)}>New user</button>
	{/snippet}

	{#if bannerFeedback}
		<p
			id="users-feedback"
			tabindex="-1"
			class="notice {bannerFeedback.ok ? 'ok' : 'error'}"
			role={bannerFeedback.ok ? 'status' : 'alert'}
		>
			{bannerFeedback.message}
		</p>
	{/if}

	<section class="card" aria-labelledby="list-title">
		<div class="card-head">
			<div>
				<p class="eyebrow">Accounts</p>
				<h2 id="list-title">All users <span class="muted">({data.total})</span></h2>
			</div>
		</div>

		<form class="filters" method="GET" role="search" aria-label="Filter users">
			<label class="field">
				<span class="field-label">Search name or email</span>
				<input class="field-control" type="search" name="q" value={query.q} maxlength="100" />
			</label>
			<label class="field">
				<span class="field-label">Role</span>
				<select class="field-control" name="role" value={query.role}>
					<option value="">All roles</option>
					{#each roles as role (role)}
						<option value={role}>{roleInfo[role].label}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span class="field-label">Status</span>
				<select class="field-control" name="status" value={query.status}>
					<option value="">Any status</option>
					<option value="active">Active</option>
					<option value="disabled">Disabled</option>
				</select>
			</label>
			<label class="field">
				<span class="field-label">Per page</span>
				<select class="field-control" name="size" value={String(query.pageSize)}>
					{#each pageSizes as size (size)}
						<option value={String(size)}>{size}</option>
					{/each}
				</select>
			</label>
			<div class="filter-buttons">
				<button class="btn primary" type="submit">Apply</button>
				{#if hasFilters}
					<a class="btn" href={resolve('/admin/users')}>Clear</a>
				{/if}
			</div>
		</form>

		{#if data.users.length === 0}
			<p class="hint" role="status">
				{hasFilters ? 'No users match these filters.' : 'There are no users yet.'}
			</p>
		{:else}
			<div class="table-wrap">
				<table class="data users">
					<caption class="sr-only">
						Users {firstShown}–{lastShown} of {data.total}
					</caption>
					<thead>
						<tr>
							<th scope="col">Name</th>
							<th scope="col">Email</th>
							<th scope="col">Role</th>
							<th scope="col">Sign-in methods</th>
							<th scope="col">Status</th>
							<th scope="col">Last login</th>
							<th scope="col">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each data.users as user (user.id)}
							{@const isSelf = user.id === data.currentUserId}
							<tr>
								<td data-label="Name">
									<strong>{user.name}</strong>
									{#if isSelf}<span class="pill">you</span>{/if}
								</td>
								<td data-label="Email">{user.email ?? '—'}</td>
								<td data-label="Role">
									{#if isSelf}
										<RoleBadge role={user.role} />
									{:else}
										<form
											method="POST"
											action="?/setRole"
											use:enhance={submittingRole(user)}
											class="inline-role"
										>
											<input type="hidden" name="id" value={user.id} />
											<select
												class="field-control compact"
												name="role"
												value={user.role}
												aria-label="Role of {user.name}"
												disabled={busy !== null}
												onchange={submitOnChange}
											>
												{#each roles as role (role)}
													<option value={role}>{roleInfo[role].label}</option>
												{/each}
											</select>
											<noscript><button class="btn small" type="submit">Save</button></noscript>
										</form>
									{/if}
								</td>
								<td data-label="Sign-in">
									<span class="methods">
										{#if user.hasPassword}<span class="pill">{providerLabels.password}</span>{/if}
										{#each user.identities as identity (identity.id)}
											<span class="pill" title={identity.label ?? undefined}>
												{providerLabels[identity.provider]}{identity.label
													? ` · ${identity.label}`
													: ''}
											</span>
										{/each}
										{#if !user.hasPassword && user.identities.length === 0}
											<span class="muted">none</span>
										{/if}
									</span>
								</td>
								<td data-label="Status">
									<span class="pill {user.disabled ? 'bad' : 'ok'}">
										{user.disabled ? 'Disabled' : 'Active'}
									</span>
								</td>
								<td data-label="Last login">
									{#if user.lastLoginAt}
										<time datetime={user.lastLoginAt}>{formatTimestamp(user.lastLoginAt)}</time>
									{:else}
										<span class="muted">never</span>
									{/if}
								</td>
								<td data-label="Actions">
									<div class="row-actions">
										<button
											class="btn small"
											type="button"
											aria-label="Edit {user.name}"
											onclick={() => (editTarget = user)}
										>
											Edit
										</button>
										<button
											class="btn small"
											type="button"
											aria-label="Reset password of {user.name}"
											onclick={() => (resetTarget = user)}
										>
											Reset password
										</button>
										{#if !isSelf}
											<button
												class="btn small danger"
												type="button"
												aria-label="Delete {user.name}"
												onclick={() => (deleteTarget = user)}
											>
												Delete
											</button>
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<nav class="pager" aria-label="Pagination">
				<span class="muted">Showing {firstShown}–{lastShown} of {data.total}</span>
				<span class="pager-links">
					{#if query.page > 1}
						<a
							class="btn small"
							href={resolve(`/admin/users?${pageParams(query.page - 1)}`)}
							rel="prev">← Previous</a
						>
					{/if}
					<span aria-current="page">Page {query.page} of {pageCount}</span>
					{#if query.page < pageCount}
						<a
							class="btn small"
							href={resolve(`/admin/users?${pageParams(query.page + 1)}`)}
							rel="next">Next →</a
						>
					{/if}
				</span>
			</nav>
		{/if}
	</section>

	<!-- Create -->
	<ModalDialog
		bind:open={showCreate}
		title="New user"
		description="Creates an account with a password."
	>
		{@const error = dialogError('create')}
		<form method="POST" action="?/create" use:enhance={submitting('create')}>
			<label class="field">
				<span class="field-label">Name</span>
				<input class="field-control" name="name" required maxlength="80" autocomplete="off" />
			</label>
			<label class="field">
				<span class="field-label">Email</span>
				<input
					class="field-control"
					type="email"
					name="email"
					required
					maxlength="254"
					autocomplete="off"
				/>
			</label>
			<PasswordField bind:value={createPassword} label="Password" />
			<label class="field">
				<span class="field-label">Role</span>
				<select class="field-control" name="role" value="user">
					{#each roles as role (role)}
						<option value={role}>{roleInfo[role].label} – {roleInfo[role].description}</option>
					{/each}
				</select>
			</label>
			{#if error}<p class="notice error" role="alert">{error}</p>{/if}
			<div class="row">
				<button class="btn primary" type="submit" disabled={busy !== null}>
					{busy === 'create' ? 'Creating…' : 'Create user'}
				</button>
				<button class="btn" type="button" onclick={closeDialogs}>Cancel</button>
			</div>
		</form>
	</ModalDialog>

	<!-- Edit -->
	<ModalDialog
		bind:open={
			() => editTarget !== null,
			(value) => {
				if (!value) editTarget = null;
			}
		}
		title={editTarget ? `Edit ${editTarget.name}` : 'Edit user'}
	>
		{#if editTarget}
			{@const user = editTarget}
			{@const isSelf = user.id === data.currentUserId}
			{@const error = dialogError('update', user.id)}
			<form method="POST" action="?/update" use:enhance={submitting('update')}>
				<input type="hidden" name="id" value={user.id} />
				<label class="field">
					<span class="field-label">Name</span>
					<input class="field-control" name="name" required maxlength="80" value={user.name} />
				</label>
				<label class="field">
					<span class="field-label">Email</span>
					<input
						class="field-control"
						type="email"
						name="email"
						maxlength="254"
						value={user.email ?? ''}
						placeholder={user.email ? undefined : 'No email (wallet / social account)'}
					/>
				</label>
				<label class="field">
					<span class="field-label">Role</span>
					<select class="field-control" name="role" value={user.role} disabled={isSelf}>
						{#each roles as role (role)}
							<option value={role}>{roleInfo[role].label} – {roleInfo[role].description}</option>
						{/each}
					</select>
				</label>
				<label class="field">
					<span class="field-label">Status</span>
					<select
						class="field-control"
						name="status"
						value={user.disabled ? 'disabled' : 'active'}
						disabled={isSelf}
					>
						<option value="active">Active</option>
						<option value="disabled">Disabled – cannot sign in; sessions are revoked</option>
					</select>
				</label>
				{#if isSelf}
					<p class="hint">
						You cannot change your own role or disable your own account; ask another admin.
					</p>
				{:else if user.email !== null}
					<p class="hint">Changing the email marks it as unverified.</p>
				{/if}
				{#if error}<p class="notice error" role="alert">{error}</p>{/if}
				<div class="row">
					<button class="btn primary" type="submit" disabled={busy !== null}>
						{busy === 'update' ? 'Saving…' : 'Save changes'}
					</button>
					<button class="btn" type="button" onclick={closeDialogs}>Cancel</button>
				</div>
			</form>
		{/if}
	</ModalDialog>

	<!-- Reset password -->
	<ModalDialog
		bind:open={
			() => resetTarget !== null,
			(value) => {
				if (!value) resetTarget = null;
			}
		}
		title={resetTarget ? `Reset password for ${resetTarget.name}` : 'Reset password'}
		description="Sets a new password and signs the user out on all devices."
	>
		{#if resetTarget}
			{@const user = resetTarget}
			{@const error = dialogError('resetPassword', user.id)}
			<form method="POST" action="?/resetPassword" use:enhance={submitting('resetPassword')}>
				<input type="hidden" name="id" value={user.id} />
				<PasswordField bind:value={resetPassword} label="New password" />
				{#if error}<p class="notice error" role="alert">{error}</p>{/if}
				<div class="row">
					<button class="btn primary" type="submit" disabled={busy !== null}>
						{busy === 'resetPassword' ? 'Resetting…' : 'Reset password'}
					</button>
					<button class="btn" type="button" onclick={closeDialogs}>Cancel</button>
				</div>
			</form>
		{/if}
	</ModalDialog>

	<!-- Delete -->
	<ModalDialog
		bind:open={
			() => deleteTarget !== null,
			(value) => {
				if (!value) deleteTarget = null;
			}
		}
		title={deleteTarget ? `Delete ${deleteTarget.name}?` : 'Delete user'}
	>
		{#if deleteTarget}
			{@const user = deleteTarget}
			{@const error = dialogError('delete', user.id)}
			<form method="POST" action="?/delete" use:enhance={submitting('delete')}>
				<input type="hidden" name="id" value={user.id} />
				<p class="hint">
					This permanently deletes <strong>{user.email ?? user.name}</strong>, their linked sign-in
					methods and all of their sessions. It cannot be undone.
				</p>
				{#if error}<p class="notice error" role="alert">{error}</p>{/if}
				<div class="row">
					<button class="btn danger" type="submit" disabled={busy !== null}>
						{busy === 'delete' ? 'Deleting…' : 'Delete user'}
					</button>
					<button class="btn" type="button" onclick={closeDialogs}>Cancel</button>
				</div>
			</form>
		{/if}
	</ModalDialog>
</AdminShell>

<style>
	.filters {
		display: grid;
		grid-template-columns: minmax(12rem, 2fr) repeat(3, minmax(7rem, 1fr)) auto;
		gap: 0.2rem 0.7rem;
		align-items: end;
		margin-bottom: 1rem;
	}

	.filter-buttons {
		display: flex;
		gap: 0.4rem;
		padding-bottom: 0.05rem;
	}

	a.btn {
		display: inline-block;
		text-decoration: none;
	}

	.methods,
	.row-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.inline-role {
		display: flex;
		gap: 0.3rem;
		align-items: center;
	}

	.compact {
		min-height: 30px;
		width: auto;
		padding: 0.25rem 0.5rem;
		font-size: 0.74rem;
	}

	.pager {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		margin-top: 0.9rem;
		font-size: 0.76rem;
	}

	.pager-links {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.notice:focus-visible {
		outline: 2px solid var(--purple);
		outline-offset: 2px;
	}

	@media (max-width: 52rem) {
		.filters {
			grid-template-columns: 1fr 1fr;
		}

		.filters :global(.field:first-child) {
			grid-column: 1 / -1;
		}

		/* Table → stacked cards. The header stays in the DOM for screen readers. */
		table.users thead {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
		}

		table.users,
		table.users tbody,
		table.users tr,
		table.users td {
			display: block;
			width: 100%;
		}

		table.users tr {
			margin-bottom: 0.8rem;
			padding: 0.3rem 0.2rem;
			border: 1px solid var(--line);
			border-radius: 10px;
		}

		table.users td {
			display: grid;
			grid-template-columns: 6.5rem 1fr;
			gap: 0.5rem;
			border-bottom: 0;
		}

		table.users td::before {
			content: attr(data-label);
			color: var(--muted);
			font-size: 0.66rem;
			font-weight: 700;
			letter-spacing: 0.05em;
			text-transform: uppercase;
		}
	}
</style>
