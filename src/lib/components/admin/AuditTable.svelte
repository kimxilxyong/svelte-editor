<script lang="ts">
	/**
	 * @component AuditTable
	 *
	 * Read-only table of the newest audit-log entries (time, actor, action, target, detail).
	 * All values are rendered as text (Svelte escapes them), and the server already stripped
	 * control characters when writing the entries.
	 *
	 * @prop {AuditRow[]} entries - Entries, newest first.
	 *
	 * @example
	 * <AuditTable entries={data.audit} />
	 */
	import { formatTimestamp } from '../../admin/format.js';
	import type { AuditRow } from '../../admin/types.js';

	interface Props {
		entries: AuditRow[];
	}

	let { entries }: Props = $props();
</script>

{#if entries.length === 0}
	<p class="hint">No activity recorded yet.</p>
{:else}
	<div class="table-wrap">
		<table class="data">
			<caption class="sr-only">Most recent audit log entries</caption>
			<thead>
				<tr>
					<th scope="col">When</th>
					<th scope="col">Actor</th>
					<th scope="col">Action</th>
					<th scope="col">Target</th>
					<th scope="col">Detail</th>
				</tr>
			</thead>
			<tbody>
				{#each entries as entry (entry.id)}
					<tr>
						<td class="nowrap">
							<time datetime={entry.at}>{formatTimestamp(entry.at)}</time>
						</td>
						<td>{entry.actorLabel ?? '—'}</td>
						<td><code>{entry.action}</code></td>
						<td>{entry.target ?? '—'}</td>
						<td class="muted">{entry.detail ?? ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.nowrap {
		white-space: nowrap;
	}
</style>
