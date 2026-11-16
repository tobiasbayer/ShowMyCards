<!--
	The Cards page's scope dropdown: All cards, My collection, each location, or
	Unassigned. Picking one reruns the search in that scope.
-->
<script lang="ts">
	import type { StorageLocation } from '#lib';
	import { Check } from '@lucide/svelte';
	import Dropdown from '#lib/components/Dropdown.svelte';
	import { countOpen } from './live.svelte';
	import { locationName } from './owned';
	import type { Scope } from './view.svelte';

	let {
		value,
		locations,
		onChange
	}: {
		value: Scope;
		locations: StorageLocation[];
		onChange: (scope: Scope) => void;
	} = $props();

	function scopeName(scope: Scope): string {
		if (scope === 'catalog') return 'All cards';
		if (scope === 'all') return 'My collection';
		return locationName(locations, scope === 'unassigned' ? null : scope);
	}
</script>

{#snippet entry(scope: Scope, close: () => void)}
	<li>
		<button
			type="button"
			title={scopeName(scope)}
			onclick={() => {
				close();
				if (scope !== value) onChange(scope);
			}}>
			<span class="flex-1 truncate">{scopeName(scope)}</span>
			{#if scope === value}<Check class="size-3.5 shrink-0 opacity-60" />{/if}
		</button>
	</li>
{/snippet}

<Dropdown
	class="min-w-0 shrink"
	placement="dropdown-start"
	summaryClass="select select-sm w-auto max-w-72 border-base-300"
	menuClass="w-60 max-h-80"
	title="Where to search"
	label="Where to search: {scopeName(value)}"
	onOpenChange={countOpen}>
	{#snippet trigger()}
		<span class="label">In</span>
		<span class="truncate">{scopeName(value)}</span>
	{/snippet}
	{#snippet children(close)}
		{@render entry('catalog', close)}
		{@render entry('all', close)}
		<li class="menu-title">Locations</li>
		{#each locations as loc (loc.id)}
			{@render entry(loc.id, close)}
		{/each}
		{@render entry('unassigned', close)}
	{/snippet}
</Dropdown>
