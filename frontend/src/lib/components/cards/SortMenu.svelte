<!--
	The Cards page's sort menu: the scope's default order, or by price either way.
	A price pick takes the currency preference at the moment it is picked.
	Disabled while the query has its own `order:`; that clause wins.
-->
<script lang="ts">
	import { ArrowDownUp, Check } from '@lucide/svelte';
	import Dropdown from '#lib/components/Dropdown.svelte';
	import { currency } from '#lib/stores/currency.svelte.ts';
	import { sortParam, type PriceSort } from './sort';
	import { countOpen } from './live.svelte';

	let {
		value,
		defaultLabel,
		typedClause = null,
		onChange
	}: {
		/** The picked price sort; null is the scope's default order. */
		value: PriceSort | null;
		/** What the default order is called in this scope ("Newest", "Name"). */
		defaultLabel: string;
		/** An order clause typed in the search (e.g. `order:cmc`); it disables the menu. */
		typedClause?: string | null;
		onChange: (sort: PriceSort | null) => void;
	} = $props();

	type Entry = { direction: PriceSort['direction'] | null; label: string };
	const entries = $derived<Entry[]>([
		{ direction: null, label: defaultLabel },
		{ direction: 'desc', label: 'Price: highest first' },
		{ direction: 'asc', label: 'Price: lowest first' }
	]);

	const disabled = $derived(typedClause !== null);
	const current = $derived(
		entries.find((e) => e.direction === (value?.direction ?? null)) ?? entries[0]
	);
	const label = $derived(disabled ? typedClause : current.label);

	function choose(direction: Entry['direction']) {
		const next = direction ? { currency: currency.current, direction } : null;
		// Picking the same direction again switches it to the current currency.
		if (sortParam(next) !== sortParam(value)) onChange(next);
	}
</script>

<Dropdown
	class="shrink-0"
	summaryClass="select select-sm w-auto gap-1.5 border-base-300"
	menuClass="w-52"
	{disabled}
	title={disabled ? `The order in your search (${typedClause}) applies` : 'Sort order'}
	label="Sort order: {label}"
	onOpenChange={countOpen}>
	{#snippet trigger()}
		<ArrowDownUp class="size-3.5 opacity-60" aria-hidden="true" />
		{label}
	{/snippet}
	{#snippet children(close)}
		{#each entries as entry (entry.direction)}
			<li>
				<button
					type="button"
					onclick={() => {
						close();
						choose(entry.direction);
					}}>
					<span class="flex-1">{entry.label}</span>
					{#if entry === current}<Check class="size-3.5 opacity-60" />{/if}
				</button>
			</li>
		{/each}
	{/snippet}
</Dropdown>
