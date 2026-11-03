<script lang="ts">
	/**
	 * @component CompositeSource
	 * Renders a composite's native source override without falling back to generated blocks.
	 * The context lookup and widget overrides are read by synchronous `prepareComposite` inside
	 * `$derived.by`: source, project definitions, nested generated blocks and widget changes
	 * therefore invalidate the immutable graph/source snapshot before asynchronous compilation.
	 * `compileComposite` owns dependency loading and strict compilation; this component keeps
	 * no registry and never evaluates source itself. SSR displays a pending placeholder only.
	 * Snapshot identity guards evaluation after dependency loading, so superseded work never
	 * executes old module scripts or injects old styles. Promise identity keys both the await
	 * block and render boundary, discarding stale results
	 * and resetting failed mounts when a new snapshot is compiled. Preparation/compile failures
	 * and mount/render failures remain visible rather than showing an older or generated version.
	 *
	 * @prop {RuntimeComposite} composite - Required, non-bindable definition. The runtime's
	 *   An empty source is still an active override. Native source controls its own props/state;
	 *   no block `onchange` or `onlink` callbacks are forwarded.
	 * @prop {number} [depth=0] - Non-bindable nesting level, validated by the runtime (including
	 *   cycles and the maximum depth). Generated child geometry belongs to the runtime: pixel
	 *   positions/sizes become percentages of their composite's declared width/height.
	 */
	import { browser } from '$app/env';
	import { onDestroy } from 'svelte';
	import { useComposites } from '../composite-context.js';
	import {
		compileComposite,
		prepareComposite,
		type RuntimeComposite
	} from '../composite-runtime.js';
	import { widgetRuntime, type WidgetComponent } from '../widget-runtime.svelte.js';

	let { composite, depth = 0 }: { composite: RuntimeComposite; depth?: number } = $props();

	const lookupComposite = useComposites();
	/** Destroyed generations must not read inert deriveds or evaluate obsolete module scripts. */
	let alive = true;
	onDestroy(() => {
		alive = false;
	});

	/** All reactive graph reads must happen before compilation crosses an async boundary. */
	const preparation = $derived.by(() => {
		if (!browser) return undefined;
		try {
			const plan = prepareComposite(composite, lookupComposite, depth, widgetRuntime.components);
			return { plan };
		} catch (error) {
			return { error };
		}
	});

	/** Snapshot identity is checked again after async loading, before strict module evaluation. */
	const compilation = $derived.by((): Promise<WidgetComponent> | undefined => {
		const snapshot = preparation;
		if (!snapshot) return undefined;
		if (snapshot.plan)
			return compileComposite(snapshot.plan, () => alive && preparation === snapshot);
		// Route synchronous preparation errors through the same visible await failure branch.
		return Promise.reject(snapshot.error);
	});

	/**
	 * Formats thrown compiler/runtime values as text, never HTML.
	 * @param error - An Error or arbitrary thrown value.
	 * @returns User-visible failure details.
	 */
	function errorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}
</script>

{#if compilation}
	{#key compilation}
		{#await compilation}
			<p role="status">Compiling composite…</p>
		{:then Component}
			<svelte:boundary>
				<Component />

				{#snippet failed(error)}
					<p role="alert">Composite rendering failed: {errorMessage(error)}</p>
				{/snippet}
			</svelte:boundary>
		{:catch error}
			<p role="alert">Composite source failed: {errorMessage(error)}</p>
		{/await}
	{/key}
{:else}
	<p role="status">Composite source will render in the browser.</p>
{/if}
