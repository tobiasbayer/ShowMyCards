<!--
	PROTOTYPE, throwaway. Page chrome for the Cards prototype: one search field,
	the Collection/Catalog switch, (Collection only) a location filter, and a
	result count.
-->
<script lang="ts">
	import { navigating } from '$app/state';
	import { Search } from '@lucide/svelte';
	import type { CardsView, LocationFilter, Source } from './state.svelte';

	let { view }: { view: CardsView } = $props();

	const sources: { key: Source; label: string }[] = [
		{ key: 'collection', label: 'Collection' },
		{ key: 'catalog', label: 'Catalog' }
	];

	function onInput(value: string) {
		if (view.source === 'collection') view.setQuery(value);
		else view.query = value;
	}

	function onSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (view.source === 'catalog' && view.query.trim()) view.navigate('catalog');
	}

	// Collection counts copies (as the storage overview does); Catalog shows Scryfall's total.
	const count = $derived(
		view.error
			? 0
			: view.source === 'collection'
				? view.collectionCopies
				: view.query.trim()
					? view.catalogTotal
					: 0
	);
	const printings = $derived(view.filteredCollection.length);

	function onLocation(value: string) {
		const filter: LocationFilter =
			value === 'all' || value === 'unassigned' ? value : Number(value);
		view.setLocation(filter);
	}
</script>

<div class="mb-6 flex flex-wrap items-center gap-3">
	<form class="min-w-64 max-w-2xl flex-1" onsubmit={onSubmit}>
		<label class="input w-full rounded-full border-base-300 bg-base-100">
			<Search class="size-4 opacity-40" />
			<input
				type="search"
				value={view.query}
				oninput={(e) => onInput(e.currentTarget.value)}
				placeholder={view.source === 'collection' ? 'Filter your cards' : 'Search all cards'}
				aria-label={view.source === 'collection' ? 'Filter your cards by name' : 'Search all cards'}
				autocomplete="off" />
			{#if navigating.to}
				<span class="loading loading-spinner loading-xs opacity-50"></span>
			{/if}
		</label>
	</form>

	<div role="tablist" aria-label="Card source" class="tabs tabs-box tabs-sm">
		{#each sources as s (s.key)}
			<button
				type="button"
				role="tab"
				aria-selected={view.source === s.key}
				class="tab {view.source === s.key ? 'tab-active' : ''}"
				onclick={() => view.source !== s.key && view.navigate(s.key)}>
				{s.label}
			</button>
		{/each}
	</div>

	{#if view.source === 'collection'}
		<select
			class="select select-sm w-auto border-base-300"
			aria-label="Location"
			value={String(view.location)}
			onchange={(e) => onLocation(e.currentTarget.value)}>
			<option value="all">All locations</option>
			{#each view.locations as loc (loc.id)}
				<option value={String(loc.id)}>{loc.name}</option>
			{/each}
			<option value="unassigned">Unassigned</option>
		</select>
	{/if}

	{#if count > 0}
		<span
			class="ml-auto text-sm text-base-content/50 tabular-nums"
			aria-live="polite"
			title={view.source === 'collection'
				? `${count} ${count === 1 ? 'copy' : 'copies'} in ${printings} ${printings === 1 ? 'printing' : 'printings'}`
				: undefined}>
			{count.toLocaleString('en-US')}
			{count === 1 ? 'card' : 'cards'}
		</span>
	{/if}
</div>
