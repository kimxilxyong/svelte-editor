<script lang="ts">
	/**
	 * @component WidgetStepper
	 * Flowbite `StepIndicator` showing progress through named steps.
	 *
	 * @prop {string} [items] - Step names, one per line. Defaults to Account / Profile / Done.
	 * @prop {number} [level=50] - Progress 0–100; mapped onto the current step (0 = first, 100 = last).
	 */
	import { StepIndicator } from 'flowbite-svelte';

	let { items = '', level = 50 }: { items?: string; level?: number } = $props();
	const steps = $derived(
		(items || 'Account\nProfile\nDone')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
	);
	const currentStep = $derived(
		Math.min(
			steps.length,
			Math.max(1, Math.round((Math.max(0, Math.min(100, level)) / 100) * (steps.length - 1)) + 1)
		)
	);
</script>

<div class="flex h-full w-full items-center overflow-hidden">
	<StepIndicator {steps} {currentStep} size="sm" hideLabel={false} />
</div>
