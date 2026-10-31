<script lang="ts">
	/**
	 * @component ContextMenu
	 *
	 * Renderer of the app-wide right-click menu. Mounted **once** in the root layout
	 * (`routes/+layout.svelte`); all state lives in the {@link ContextMenu} controller
	 * (`context-menu.svelte.ts`), so this component only draws it and forwards input.
	 *
	 * ## Behaviour
	 * - Positioned `fixed` at the pointer and clamped into the viewport after measuring
	 *   ({@link placeMenu}).
	 * - Keyboard: ArrowUp/Down (wrapping), Home/End, Enter/Space (native button activation),
	 *   Escape (closes, focus returns to the previously focused element), Tab (closes),
	 *   type-ahead by first letter.
	 * - Closes on outside pointer-down, window blur, resize and scrolling.
	 * - Roles: `menu` / `menuitem` / `separator`; disabled items use `aria-disabled` and stay
	 *   focusable-by-skip (never activatable).
	 *
	 * @prop {ContextMenu} menu - Controller instance created by the layout.
	 */
	import type { ContextMenu } from '../context-menu.svelte.js';
	import { isAction, placeMenu } from '../context-menu.js';

	let { menu }: { menu: ContextMenu } = $props();

	let element = $state<HTMLElement>();

	/**
	 * Measures the freshly rendered menu, clamps it into the viewport and focuses the active
	 * item. Re-runs when the anchor changes (right-click elsewhere while open).
	 */
	function place(node: HTMLElement) {
		const { x, y } = menu;
		const box = node.getBoundingClientRect();
		const { left, top } = placeMenu(x, y, box.width, box.height, innerWidth, innerHeight);
		node.style.left = `${left}px`;
		node.style.top = `${top}px`;
		node.style.visibility = 'visible';
	}

	// Roving focus: the active item holds real focus so screen readers announce it.
	$effect(() => {
		if (!menu.open || !element) return;
		const target = element.querySelector<HTMLElement>(`[data-index="${menu.activeIndex}"]`);
		(target ?? element).focus({ preventScroll: true });
	});

	// Scrolling anywhere would leave the menu detached from its target.
	$effect(() => {
		if (!menu.open) return;
		// Opening a menu often changes the layout (e.g. selecting a block reveals the inspector),
		// which can scroll containers; those settling scrolls must not dismiss the menu.
		const openedAt = performance.now();
		const close = () => {
			if (performance.now() - openedAt > 300) menu.close();
		};
		addEventListener('scroll', close, { capture: true, passive: true });
		return () => removeEventListener('scroll', close, { capture: true });
	});

	function handleKeydown(event: KeyboardEvent) {
		if (!menu.open) return;
		const handled = (action: () => void) => {
			event.preventDefault();
			event.stopPropagation();
			action();
		};
		switch (event.key) {
			case 'ArrowDown':
				return handled(() => menu.move(1));
			case 'ArrowUp':
				return handled(() => menu.move(-1));
			case 'Home':
				return handled(() => menu.jump('first'));
			case 'End':
				return handled(() => menu.jump('last'));
			case 'Escape':
				return handled(() => menu.close(true));
			case 'Tab':
				return menu.close(true);
			default:
				if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
					if (event.key !== ' ') handled(() => menu.typeAhead(event.key));
				}
		}
	}

	function handlePointerDown(event: PointerEvent) {
		if (menu.open && element && !element.contains(event.target as Node)) menu.close();
	}
</script>

<svelte:window
	onkeydowncapture={handleKeydown}
	onpointerdowncapture={handlePointerDown}
	onblur={() => menu.close()}
	onresize={() => menu.close()}
/>

{#if menu.open}
	<!-- Hidden until measured so the menu never flashes at an unclamped position. -->
	<div
		bind:this={element}
		class="context-menu"
		role="menu"
		tabindex="-1"
		aria-label="Context menu"
		style:visibility="hidden"
		oncontextmenu={(event) => event.preventDefault()}
		{@attach place}
	>
		{#each menu.entries as entry, index (index)}
			{#if isAction(entry)}
				<button
					type="button"
					role="menuitem"
					class="item"
					class:danger={entry.danger}
					class:active={menu.activeIndex === index}
					data-index={index}
					data-action={entry.id}
					aria-disabled={entry.disabled ? 'true' : undefined}
					tabindex={menu.activeIndex === index ? 0 : -1}
					onpointermove={() => menu.hover(index)}
					onclick={() => menu.activate(index)}
				>
					<span class="label">{entry.label}</span>
					{#if entry.shortcut}<kbd>{entry.shortcut}</kbd>{/if}
				</button>
			{:else}
				<div class="divider" role="separator"></div>
			{/if}
		{/each}
	</div>
{/if}

<style>
	.context-menu {
		position: fixed;
		z-index: 2000;
		min-width: 12rem;
		max-width: 20rem;
		padding: 0.3rem;
		border: 1px solid #e3e3ec;
		border-radius: 10px;
		background: #fff;
		box-shadow: 0 12px 34px rgb(34 34 56 / 0.2);
		color: #20233a;
		font:
			0.88rem/1.3 Inter,
			ui-sans-serif,
			system-ui,
			sans-serif;
		outline: none;
	}

	.item {
		display: flex;
		width: 100%;
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem;
		padding: 0.45rem 0.7rem;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.item.active {
		background: #efecff;
		color: #4b3fc4;
		outline: none;
	}

	.item.danger {
		color: #c0263a;
	}

	.item.danger.active {
		background: #fdecef;
		color: #a31c2e;
	}

	.item[aria-disabled='true'] {
		color: #b4b5c4;
		cursor: not-allowed;
	}

	.item[aria-disabled='true'].active {
		background: transparent;
	}

	kbd {
		color: #898ba0;
		font: inherit;
		font-size: 0.78rem;
	}

	.divider {
		height: 1px;
		margin: 0.3rem 0.4rem;
		background: #ececf2;
	}
</style>
