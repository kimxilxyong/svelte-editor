<script lang="ts">
	/**
	 * @component ContextMenuHarness
	 *
	 * Test-only wrapper: provides a real {@link ContextMenu} controller exactly like the root
	 * layout does and exposes two targets – a nested "row" inside a "list" – so specs can verify
	 * the most-specific-menu-wins rule, the native-menu escape hatches and the keyboard handling.
	 *
	 * @prop {string[]} [log] - Receives the id of each executed action.
	 */
	import ContextMenuView from '../ContextMenu.svelte';
	import { ContextMenu, provideContextMenu } from '../../context-menu.svelte.js';

	let { log = [] }: { log?: string[] } = $props();

	const menu = new ContextMenu();
	provideContextMenu(menu);
</script>

<div
	data-testid="list"
	style="padding: 40px"
	{@attach menu.attach([
		{ id: 'add', label: 'Add', run: () => log.push('add') },
		{ id: 'save', label: 'Save', disabled: true, run: () => log.push('save') }
	])}
>
	list
	<button
		type="button"
		data-testid="row"
		{@attach menu.attach(() => [
			{ id: 'edit', label: 'Edit', run: () => log.push('edit') },
			{ separator: true },
			{ id: 'delete', label: 'Delete', danger: true, run: () => log.push('delete') }
		])}
	>
		row
	</button>
	<input data-testid="field" />
	<span data-testid="empty" {@attach menu.attach(() => [false, { separator: true }])}> empty </span>
</div>

<ContextMenuView {menu} />
