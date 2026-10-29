<script lang="ts">
	/**
	 * @component RoleBadge
	 *
	 * Small colored pill showing a user role (label from `roleInfo`, description as tooltip).
	 * Color is only a visual hint – the text always carries the meaning, so it is accessible
	 * without relying on color.
	 *
	 * @prop {Role} role - The role to display.
	 * @prop {boolean} [showDescription=false] - Append the one-line role description after the label.
	 *
	 * @example
	 * <RoleBadge role="admin" />
	 */
	import { roleInfo, type Role } from '../auth/roles.js';

	interface Props {
		role: Role;
		showDescription?: boolean;
	}

	let { role, showDescription = false }: Props = $props();

	const info = $derived(roleInfo[role]);
</script>

<span class="role-badge {role}" title={info.description}>
	{info.label}{#if showDescription}<span class="desc"> – {info.description}</span>{/if}
</span>

<style>
	.role-badge {
		display: inline-flex;
		align-items: center;
		padding: 0.12rem 0.55rem;
		border: 1px solid transparent;
		border-radius: 999px;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.01em;
		white-space: nowrap;
	}

	/* Contrast: every pair is at least 4.5:1. */
	.guest {
		border-color: #dcdde6;
		background: #f1f1f5;
		color: #4b4d63;
	}

	.user {
		border-color: #cfe0f5;
		background: #eaf3fe;
		color: #1f4f86;
	}

	.poweruser {
		border-color: #d9d4fb;
		background: #f4f2ff;
		color: #4a3cc0;
	}

	.admin {
		border-color: #f6cdd3;
		background: #fdecef;
		color: #a3243a;
	}

	.desc {
		font-weight: 400;
	}
</style>
