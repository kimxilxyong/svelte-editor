<script lang="ts">
	/**
	 * @component AdminOverviewPage
	 *
	 * `/admin` – dashboard for administrators:
	 * 1. database backend (inspect / test / switch),
	 * 2. authentication settings (self-registration, default role),
	 * 3. sign-in provider status (read-only),
	 * 4. user summary by role and the newest audit entries.
	 *
	 * The route is guarded by `hooks.server.ts` and again by `requireRole` in the load function
	 * and in every action. The cards are separate components; this page only wires data and the
	 * `form` result of the last (non-JS) action to the matching card.
	 *
	 * @prop {import('./$types').PageData} data - Server load result (backend, settings, providers, users, audit).
	 * @prop {import('./$types').ActionData} form - Result of the last form action, if any.
	 */
	import { resolve } from '$app/paths';
	import { roles } from '../../lib/auth/roles.js';
	import type { DatabaseFeedback, SettingsFeedback } from '../../lib/admin/types.js';
	import AdminShell from '../../lib/components/admin/AdminShell.svelte';
	import AuditTable from '../../lib/components/admin/AuditTable.svelte';
	import AuthSettingsCard from '../../lib/components/admin/AuthSettingsCard.svelte';
	import DatabaseBackendCard from '../../lib/components/admin/DatabaseBackendCard.svelte';
	import ProvidersCard from '../../lib/components/admin/ProvidersCard.svelte';
	import RoleBadge from '../../lib/components/RoleBadge.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// ActionData is a union of all action results; each card only gets its own section.
	const databaseForm = $derived(
		form && 'section' in form && form.section === 'database' ? (form as DatabaseFeedback) : null
	);
	const settingsForm = $derived(
		form && 'section' in form && form.section === 'settings' ? (form as SettingsFeedback) : null
	);
</script>

<svelte:head>
	<title>Administration</title>
</svelte:head>

<AdminShell title="Administration" eyebrow="Admin" active="overview">
	<div class="grid-2">
		<DatabaseBackendCard backend={data.backend} form={databaseForm} />
		<div class="stack">
			<AuthSettingsCard settings={data.settings} form={settingsForm} />
			<ProvidersCard providers={data.providers} />
		</div>
	</div>

	<section class="card" aria-labelledby="users-title">
		<div class="card-head">
			<div>
				<p class="eyebrow">People</p>
				<h2 id="users-title">Users</h2>
			</div>
			<a class="btn small" href={resolve('/admin/users')}>Manage users →</a>
		</div>
		<ul class="role-summary">
			{#each roles as role (role)}
				<li>
					<RoleBadge {role} />
					<strong>{data.users.byRole[role]}</strong>
				</li>
			{/each}
			<li>
				<span class="pill {data.users.disabled > 0 ? 'warn' : ''}">Disabled</span>
				<strong>{data.users.disabled}</strong>
			</li>
			<li class="muted">Total <strong>{data.users.total}</strong></li>
		</ul>
	</section>

	<section class="card" aria-labelledby="activity-title">
		<div class="card-head">
			<div>
				<p class="eyebrow">Audit trail</p>
				<h2 id="activity-title">Recent activity</h2>
			</div>
			<span class="muted small-text">Last {data.audit.length} entries, newest first</span>
		</div>
		<AuditTable entries={data.audit} />
	</section>
</AdminShell>

<style>
	.stack {
		display: grid;
		gap: 1rem;
		min-width: 0;
	}

	.role-summary {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem 1.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.82rem;
	}

	.role-summary li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.small-text {
		font-size: 0.72rem;
	}

	/* .btn is a shared class from AdminShell; it must not look underlined as a link. */
	a.btn {
		text-decoration: none;
	}
</style>
