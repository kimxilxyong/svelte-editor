<script lang="ts">
	/**
	 * @component CodeEditorAppendHarness
	 * Test-only binding host: exposes the mounted API and renders the bound document
	 * so browser tests verify normal update-listener propagation, not just editor state.
	 * No route, server or database access is involved.
	 *
	 * @prop {(api: CodeEditorApi) => void} ready - Required, non-bindable mounted API receiver.
	 * @prop {(value: string) => void} onchange - Required, non-bindable edit observer.
	 */
	import CodeEditor, { type CodeEditorApi } from '../CodeEditor.svelte';

	let {
		ready,
		onchange
	}: {
		ready: (api: CodeEditorApi) => void;
		onchange: (value: string) => void;
	} = $props();
	let value = $state('/* original */');
	/** Publishes the real browser API when the editor attachment creates it. */
	function publishApi(api: CodeEditorApi | undefined) {
		if (api) ready(api);
	}
</script>

<CodeEditor
	bind:value
	bind:api={() => undefined, publishApi}
	language="css"
	ariaLabel="Append test CSS"
	{onchange}
/>
<output data-testid="bound-value">{value}</output>
