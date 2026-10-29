<script lang="ts">
	/**
	 * @component ProvidersCard
	 *
	 * Read-only status of every sign-in method. Password and wallet sign-in are built in and
	 * always available; GitHub, Google and LinkedIn are enabled by server environment variables
	 * (the secrets themselves are never sent to the browser – only whether both are set).
	 *
	 * @prop {ProviderRow[]} providers - OAuth providers with status, callback URL and variable names.
	 *
	 * @example
	 * <ProvidersCard providers={data.providers} />
	 */
	import type { ProviderRow } from '../../admin/types.js';

	interface Props {
		providers: ProviderRow[];
	}

	let { providers }: Props = $props();
</script>

<section class="card" aria-labelledby="providers-title">
	<div class="card-head">
		<div>
			<p class="eyebrow">Sign-in</p>
			<h2 id="providers-title">Sign-in providers</h2>
		</div>
	</div>

	<div class="table-wrap">
		<table class="data">
			<caption class="sr-only">Available sign-in methods and their configuration</caption>
			<thead>
				<tr>
					<th scope="col">Method</th>
					<th scope="col">Status</th>
					<th scope="col">Setup</th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<th scope="row">Email &amp; password</th>
					<td><span class="pill ok">Always available</span></td>
					<td class="muted">Built in (Argon2id hashed).</td>
				</tr>
				<tr>
					<th scope="row">Crypto wallet</th>
					<td><span class="pill ok">Always available</span></td>
					<td class="muted">Sign-In with Ethereum (EIP-4361); no configuration needed.</td>
				</tr>
				{#each providers as provider (provider.id)}
					<tr>
						<th scope="row">{provider.label}</th>
						<td>
							<span class="pill {provider.configured ? 'ok' : 'warn'}">
								{provider.configured ? 'Configured' : 'Not configured'}
							</span>
						</td>
						<td>
							<div>Callback URL: <code>{provider.callbackUrl}</code></div>
							<div class="muted">
								Set <code>{provider.envVars[0]}</code> and <code>{provider.envVars[1]}</code>, then
								restart the server.
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="hint">
		The callback URL is derived from the address you used to open this page; register exactly this
		URL at the provider.
	</p>
</section>
