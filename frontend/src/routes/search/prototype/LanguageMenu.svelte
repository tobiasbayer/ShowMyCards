<!--
	PROTOTYPE. The Cards page's language dropdown: "Any language" plus the
	Scryfall languages, the same <details class="dropdown"> pattern as MoveMenu.
	Disabled while the query names a language itself; that clause wins.
-->
<script lang="ts">
	import { Check } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import { ANY_LANGUAGE, LANGUAGE_OPTIONS, languageName } from './language';
	import { ui } from './state.svelte';

	let {
		value,
		typedClause = null,
		onChange
	}: {
		/** The language the results are in (a code or `any`). */
		value: string;
		/** A language clause typed in the search (e.g. `l:ja`); it disables the menu. */
		typedClause?: string | null;
		onChange: (language: string) => void;
	} = $props();

	let open = $state(false);
	let root = $state<HTMLDetailsElement>();
	const disabled = $derived(typedClause !== null);

	// A typed clause closes the menu: picking now would have no effect.
	$effect(() => {
		if (disabled) open = false;
	});

	// While open, Esc closes this menu instead of the detail panel (see MoveMenu).
	$effect(() => {
		if (!open) return;
		untrack(() => ui.openPopovers++);
		return () => untrack(() => ui.openPopovers--);
	});

	function choose(code: string) {
		open = false;
		if (code !== value) onChange(code);
	}

	function onKeydown(event: KeyboardEvent) {
		if (open && event.key === 'Escape') open = false;
	}

	function onPointerDown(event: PointerEvent) {
		if (open && root && !root.contains(event.target as Node)) open = false;
	}
</script>

<svelte:window onkeydown={onKeydown} onpointerdown={onPointerDown} />

<!--
	The tooltip sits on the wrapper: a disabled summary takes no pointer events.
	No tabindex on an enabled summary (it is focusable anyway): DaisyUI's
	`.dropdown:focus-within > [tabindex]:first-child` turns off its pointer events
	on focus, which swallows the click that should open the menu.
-->
<div
	class="shrink-0"
	title={disabled ? `The language in your search (${typedClause}) applies` : 'Card language'}>
	<details class="dropdown dropdown-end" bind:open bind:this={root}>
		<summary
			class="select select-sm w-auto border-base-300 {disabled
				? 'pointer-events-none opacity-50'
				: ''}"
			aria-label="Card language: {languageName(value)}"
			aria-disabled={disabled}
			tabindex={disabled ? -1 : undefined}>
			{languageName(value)}
		</summary>
		<ul
			class="dropdown-content menu menu-sm z-20 mt-1 max-h-72 w-56 flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-100 p-1 shadow-lg">
			{#each LANGUAGE_OPTIONS as lang (lang.code)}
				<li>
					<button type="button" onclick={() => choose(lang.code)}>
						<span class="flex-1">{lang.name}</span>
						{#if lang.code === value}<Check class="size-3.5 opacity-60" />{/if}
					</button>
				</li>
				{#if lang.code === ANY_LANGUAGE}
					<li aria-hidden="true" class="pointer-events-none">
						<hr class="my-1 p-0 border-base-300" />
					</li>
				{/if}
			{/each}
		</ul>
	</details>
</div>
