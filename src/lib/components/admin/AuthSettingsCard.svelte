<script lang="ts">
	/**
	 * @component AuthSettingsCard
	 *
	 * Admin card for the authentication settings: whether visitors may register themselves and
	 * which role self-registered accounts receive. Posts to the `?/updateSettings` action.
	 *
	 * The role list deliberately excludes `admin` – open registration must never create
	 * administrators (the server enforces this too).
	 *
	 * @prop {{ allowRegistration: boolean; defaultRole: Role }} settings - Current stored settings.
	 * @prop {SettingsFeedback | null} [form=null] - Result of the last settings action (fallback
	 *   for the no-JavaScript case).
	 *
	 * @example
	 * <AuthSettingsCard settings={data.settings} form={settingsForm} />
	 */
	import { enhance, type SubmitFunction } from '$app/forms';
	import { untrack } from 'svelte';
	import { roleInfo, roles, type Role } from '../../auth/roles.js';
	import type { SettingsFeedback } from '../../admin/types.js';

	interface Props {
		settings: { allowRegistration: boolean; defaultRole: Role };
		form?: SettingsFeedback | null;
	}

	let { settings, form = null }: Props = $props();

	/** Roles that may be the default for self-registration (everything but admin). */
	const assignable = roles.filter((role) => role !== 'admin');

	// One-time snapshot; later the user's input is the source of truth.
	let allowRegistration = $state(untrack(() => settings.allowRegistration));
	let defaultRole = $state<Role>(untrack(() => settings.defaultRole));
	let saving = $state(false);
	let latest = $state<SettingsFeedback | null>(null);
	const feedback = $derived(latest ?? form);

	const handleSubmit: SubmitFunction = () => {
		saving = true;
		latest = null;
		return async ({ result, update }) => {
			saving = false;
			if (result.type === 'success' || result.type === 'failure') {
				latest = result.data as unknown as SettingsFeedback;
			}
			await update({ reset: false });
		};
	};
</script>

<section class="card" aria-labelledby="auth-title">
	<div class="card-head">
		<div>
			<p class="eyebrow">Access</p>
			<h2 id="auth-title">Authentication settings</h2>
		</div>
	</div>

	<form method="POST" action="?/updateSettings" use:enhance={handleSubmit}>
		<label class="choice">
			<input type="checkbox" name="allowRegistration" bind:checked={allowRegistration} />
			<span>
				Allow self-registration
				<small>
					Visitors can create an account with a password, a social provider or a wallet. When off,
					only admins can create users.
				</small>
			</span>
		</label>

		<label class="field">
			<span class="field-label">Default role for new accounts</span>
			<select
				class="field-control"
				name="defaultRole"
				bind:value={defaultRole}
				aria-describedby="default-role-help"
			>
				{#each assignable as role (role)}
					<option value={role}>{roleInfo[role].label}</option>
				{/each}
			</select>
		</label>
		<p id="default-role-help" class="hint">
			{roleInfo[defaultRole].description} The admin role can only be granted by an existing admin.
		</p>

		<div class="row">
			<button class="btn primary" type="submit" disabled={saving}>
				{saving ? 'Saving…' : 'Save settings'}
			</button>
		</div>
	</form>

	<div aria-live="polite">
		{#if feedback}
			<p class="notice {feedback.ok ? 'ok' : 'error'}" role={feedback.ok ? 'status' : 'alert'}>
				{feedback.message}
			</p>
		{/if}
	</div>
</section>
