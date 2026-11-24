<!--
	The Cards page's storage location dropdown (shown in My collection):
	All locations, each storage location, or Unassigned. Picking one reruns the
	search in that location.
-->
<script lang="ts">
	import type { StorageLocation } from '#lib';
	import { Check } from '@lucide/svelte';
	import Dropdown from '#lib/components/Dropdown.svelte';
	import { countOpen } from './live.svelte';
	import { locationName } from './owned';
	import type { LocationFilter } from './stacks';

	let {
		value,
		locations,
		onChange
	}: {
		value: LocationFilter;
		locations: StorageLocation[];
		onChange: (location: LocationFilter) => void;
	} = $props();

	function locationLabel(location: LocationFilter): string {
		if (location === 'all') return 'All locations';
		return locationName(locations, location === 'unassigned' ? null : location);
	}
</script>

{#snippet entry(location: LocationFilter, close: () => void)}
	<li>
		<button
			type="button"
			title={locationLabel(location)}
			onclick={() => {
				close();
				if (location !== value) onChange(location);
			}}>
			<span class="flex-1 truncate">{locationLabel(location)}</span>
			{#if location === value}<Check class="size-3.5 shrink-0 opacity-60" />{/if}
		</button>
	</li>
{/snippet}

<Dropdown
	class="min-w-0 shrink"
	placement="dropdown-start"
	summaryClass="select select-sm w-auto max-w-72 border-base-300"
	menuClass="w-60 max-h-80"
	title="Storage location"
	label="Storage location: {locationLabel(value)}"
	onOpenChange={countOpen}>
	{#snippet trigger()}
		<span class="label">In</span>
		<span class="truncate">{locationLabel(value)}</span>
	{/snippet}
	{#snippet children(close)}
		{@render entry('all', close)}
		<li aria-hidden="true" class="pointer-events-none">
			<hr class="my-1 border-base-300 p-0" />
		</li>
		{#each locations as loc (loc.id)}
			{@render entry(loc.id, close)}
		{/each}
		{@render entry('unassigned', close)}
	{/snippet}
</Dropdown>
