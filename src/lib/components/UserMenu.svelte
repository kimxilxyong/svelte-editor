<script lang="ts">
	/**
	 * @component UserMenu
	 *
	 * Account control at the right end of the unified top navigation (`AppNav`).
	 *
	 * - Signed in → a `<details>` dropdown with the user's name, role badge, email, a link to
	 *   `/account` and a **Sign out** button. Sign out is a plain `POST /logout` form, so it works
	 *   without JavaScript. The dropdown closes after every navigation.
	 * - Anonymous → a "Sign in" link.
	 *
	 * The user comes from the root layout data (`page.data.user`, see `+layout.server.ts`), so the
	 * component has no props. This is presentation only; the server hook enforces access.
	 *
	 * @example
	 * <UserMenu />
	 */
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { roleInfo } from '../auth/roles.js';
	import type { SessionUser } from '../auth/types.js';

	/** Signed-in user from `+layout.server.ts` (`null` when anonymous). */
	const user = $derived<SessionUser | null>(page.data.user ?? null);

	let menuOpen = $state(false);
	afterNavigate(() => {
		menuOpen = false;
	});
</script>

{#if user}
	<details class="user-menu" bind:open={menuOpen}>
		<summary aria-label="User menu for {user.name}">
			<span class="avatar" aria-hidden="true">{user.name.charAt(0).toUpperCase()}</span>
			<span class="user-name">{user.name}</span>
		</summary>
		<div class="menu">
			<p class="who">
				<strong>{user.name}</strong>
				<span class="role-badge role-{user.role}">{roleInfo[user.role].label}</span>
			</p>
			{#if user.email}<p class="email">{user.email}</p>{/if}
			<a href={resolve('/account')}>Account</a>
			<form method="POST" action={resolve('/logout')}>
				<button type="submit">Sign out</button>
			</form>
		</div>
	</details>
{:else}
	<a class="sign-in" href={resolve('/login')}>Sign in</a>
{/if}

<style>
	.sign-in {
		display: inline-flex;
		align-items: center;
		min-height: 30px;
		padding: 0 0.85rem;
		border: 1px solid var(--purple, #6b5ce7);
		border-radius: 999px;
		color: var(--purple, #6b5ce7);
		font-weight: 700;
		text-decoration: none;
	}

	.sign-in:hover {
		background: #eeeaff;
	}

	.user-menu {
		position: relative;
	}

	.user-menu summary {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.15rem 0.6rem 0.15rem 0.2rem;
		border: 1px solid var(--line, #e9e9f0);
		border-radius: 999px;
		background: #fff;
		color: var(--ink, #20233a);
		font-weight: 700;
		list-style: none;
		cursor: pointer;
	}

	.user-menu summary::-webkit-details-marker {
		display: none;
	}

	.user-menu summary:hover,
	.user-menu[open] summary {
		border-color: var(--purple, #6b5ce7);
	}

	.user-menu summary:focus-visible {
		outline: 2px solid var(--purple, #6b5ce7);
		outline-offset: 2px;
	}

	.avatar {
		display: grid;
		width: 1.7rem;
		height: 1.7rem;
		place-items: center;
		border-radius: 50%;
		background: var(--purple, #6b5ce7);
		color: #fff;
		font-size: 0.78rem;
	}

	.user-name {
		max-width: 9rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.menu {
		position: absolute;
		z-index: 20;
		top: calc(100% + 0.3rem);
		right: 0;
		display: flex;
		min-width: 13rem;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.6rem;
		border: 1px solid var(--line, #e9e9f0);
		border-radius: 12px;
		background: #fff;
		box-shadow: 0 10px 30px rgb(32 35 58 / 14%);
	}

	.menu p {
		margin: 0;
		padding: 0 0.4rem;
	}

	.who {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.2rem 0.5rem;
	}

	.email {
		overflow: hidden;
		color: #898ba0;
		font-size: 0.72rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.role-badge {
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: #f4f2ff;
		color: #6b5ce7;
		font-size: 0.68rem;
		font-weight: 700;
	}

	.role-badge.role-admin {
		background: #fdecef;
		color: #d6334a;
	}

	.role-badge.role-guest {
		background: #f1f1f5;
		color: #898ba0;
	}

	.menu a,
	.menu button {
		display: block;
		width: 100%;
		box-sizing: border-box;
		padding: 0.45rem 0.4rem;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--ink, #20233a);
		font: inherit;
		font-weight: 600;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
	}

	.menu a:hover,
	.menu button:hover {
		background: #f4f2ff;
		color: #6b5ce7;
	}

	.menu form {
		margin: 0;
	}
</style>
