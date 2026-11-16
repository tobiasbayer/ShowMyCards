<!--
	The Cards page's language dropdown: "Any language" plus the Scryfall
	languages. Disabled while the query names a language itself; that clause wins.
-->
<script lang="ts">
	import { Check } from '@lucide/svelte';
	import Dropdown from '$lib/components/Dropdown.svelte';
	import { ANY_LANGUAGE, LANGUAGE_OPTIONS, languageName } from './language';
	import { countOpen } from './live.svelte';

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

	const disabled = $derived(typedClause !== null);
</script>

<Dropdown
	class="shrink-0"
	summaryClass="select select-sm w-auto border-base-300"
	menuClass="w-56 max-h-72"
	{disabled}
	title={disabled ? `The language in your search (${typedClause}) applies` : 'Card language'}
	label="Card language: {languageName(value)}"
	onOpenChange={countOpen}>
	{#snippet trigger()}
		{languageName(value)}
	{/snippet}
	{#snippet children(close)}
		{#each LANGUAGE_OPTIONS as lang (lang.code)}
			<li>
				<button
					type="button"
					onclick={() => {
						close();
						if (lang.code !== value) onChange(lang.code);
					}}>
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
	{/snippet}
</Dropdown>
