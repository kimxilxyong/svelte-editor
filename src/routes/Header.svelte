<script lang="ts">
	/**
	 * @component Header
	 *
	 * Global site header: logo, the main navigation and the **user menu**.
	 *
	 * - Navigation links are filtered with the central access policy (`canAccess`), so users only see
	 *   what their role may open; "Admin" appears for admins only. (Convenience only – the server
	 *   hook enforces access.)
	 * - The user menu (right side) reads the user from the root layout data (`page.data.user`):
	 *   signed in → a `<details>` dropdown with name, role badge, a link to `/account` and a
	 *   **Sign out** button that submits `POST /logout` (a plain form, works without JavaScript);
	 *   anonymous → a "Sign in" link. The dropdown closes after every navigation.
	 *
	 * No props: everything comes from `$app/state`.
	 */
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import github from '#lib/images/github.svg';
	import logo from '#lib/images/svelte-logo.svg';
	import { canAccess } from '../lib/auth/access.js';
	import { roleInfo } from '../lib/auth/roles.js';
	import type { SessionUser } from '../lib/auth/types.js';

	/** Signed-in user from `+layout.server.ts` (`null` when anonymous). */
	const user = $derived<SessionUser | null>(page.data.user ?? null);
	const role = $derived(user?.role ?? null);

	let menuOpen = $state(false);
	afterNavigate(() => {
		menuOpen = false;
	});
</script>

<header>
	<div class="side">
		<div class="corner">
			<a href="https://svelte.dev/docs/kit">
				<img src={logo} alt="SvelteKit" />
			</a>
		</div>
	</div>

	<nav>
		<svg viewBox="0 0 2 3" aria-hidden="true">
			<path d="M0,0 L1,2 C1.5,3 1.5,3 2,3 L2,0 Z" />
		</svg>
		<ul>
			{#if canAccess(role, '/')}
				<li aria-current={page.url.pathname === '/' ? 'page' : undefined}>
					<a href={resolve('/')}>Home</a>
				</li>
			{/if}
			{#if canAccess(role, '/editor')}
				<li aria-current={page.url.pathname === '/editor' ? 'page' : undefined}>
					<a href={resolve('/editor')}>Editor</a>
				</li>
			{/if}
			{#if canAccess(role, '/component-editor')}
				<li aria-current={page.url.pathname === '/component-editor' ? 'page' : undefined}>
					<a href={resolve('/component-editor')}>Components</a>
				</li>
			{/if}
			{#if canAccess(role, '/admin')}
				<li aria-current={page.url.pathname.startsWith('/admin') ? 'page' : undefined}>
					<a href={resolve('/admin')}>Admin</a>
				</li>
			{/if}
			<li aria-current={page.url.pathname === '/about' ? 'page' : undefined}>
				<a href={resolve('/about')}>About</a>
			</li>
		</ul>
		<svg viewBox="0 0 2 3" aria-hidden="true">
			<path d="M0,0 L0,3 C0.5,3 0.5,3 1,2 L2,0 Z" />
		</svg>
	</nav>

	<div class="side right">
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
		<div class="corner">
			<a href="https://github.com/sveltejs/kit">
				<img src={github} alt="GitHub" />
			</a>
		</div>
	</div>
</header>

<style>
	header {
		display: flex;
		justify-content: space-between;
	}

	/* Equal-width flexible sides keep the centre navigation centred whatever the right side holds. */
	.side {
		display: flex;
		flex: 1;
		align-items: center;
	}

	.side.right {
		justify-content: flex-end;
		gap: 0.4rem;
	}

	.corner {
		width: 3em;
		height: 3em;
	}

	.corner a {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
	}

	.corner img {
		width: 2em;
		height: 2em;
		object-fit: contain;
	}

	nav {
		display: flex;
		justify-content: center;
		--background: rgba(255, 255, 255, 0.7);
	}

	svg {
		width: 2em;
		height: 3em;
		display: block;
	}

	path {
		fill: var(--background);
	}

	ul {
		position: relative;
		padding: 0;
		margin: 0;
		height: 3em;
		display: flex;
		justify-content: center;
		align-items: center;
		list-style: none;
		background: var(--background);
		background-size: contain;
	}

	li {
		position: relative;
		height: 100%;
	}

	li[aria-current='page']::before {
		--size: 6px;
		content: '';
		width: 0;
		height: 0;
		position: absolute;
		top: 0;
		left: calc(50% - var(--size));
		border: var(--size) solid transparent;
		border-top: var(--size) solid var(--color-theme-1);
	}

	nav a {
		display: flex;
		height: 100%;
		align-items: center;
		padding: 0 0.5rem;
		color: var(--color-text);
		font-weight: 700;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		text-decoration: none;
		transition: color 0.2s linear;
	}

	a:hover {
		color: var(--color-theme-1);
	}

	/* ---- user menu ---- */
	.sign-in {
		padding: 0.35rem 0.8rem;
		border: 1px solid var(--color-theme-1);
		border-radius: 999px;
		font-size: 0.8rem;
		font-weight: 700;
	}

	.user-menu {
		position: relative;
		font-size: 0.8rem;
	}

	.user-menu summary {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.2rem 0.6rem 0.2rem 0.25rem;
		border-radius: 999px;
		color: var(--color-text);
		font-weight: 700;
		list-style: none;
		cursor: pointer;
	}

	.user-menu summary::-webkit-details-marker {
		display: none;
	}

	.user-menu summary:hover,
	.user-menu[open] summary {
		background: rgba(255, 255, 255, 0.7);
	}

	.avatar {
		display: grid;
		width: 1.9rem;
		height: 1.9rem;
		place-items: center;
		border-radius: 50%;
		background: var(--color-theme-2);
		color: #fff;
		font-size: 0.8rem;
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
		border: 1px solid #e9e9f0;
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
		color: var(--color-text);
		font: inherit;
		font-weight: 600;
		text-align: left;
		cursor: pointer;
	}

	.menu a:hover,
	.menu button:hover {
		background: #f4f2ff;
		color: #6b5ce7;
		text-decoration: none;
	}

	.menu form {
		margin: 0;
	}
</style>
