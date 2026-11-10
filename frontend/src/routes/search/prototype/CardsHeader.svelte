<!--
	PROTOTYPE, throwaway. Page chrome for the Cards prototype: one search field
	(applied on Enter), one scope dropdown (All cards, My collection, a location,
	Unassigned) and a result count.
-->
<script lang="ts">
	import { navigating } from '$app/state';
	import { untrack } from 'svelte';
	import { Search } from '@lucide/svelte';
	import type { CardsView, Scope } from './state.svelte';

	let { view }: { view: CardsView } = $props();

	// What is typed applies on Enter or on a scope change; `view.query` is what ran.
	// Seeded once: the header is recreated with each view (see VariantPush).
	let draft = $state(untrack(() => view.query));

	// Every scope searches on the server: Scryfall for All cards, the local engine otherwise.
	function onSubmit(event: SubmitEvent) {
		event.preventDefault();
		view.query = draft;
		view.navigate(view.source);
	}

	function onScope(value: string) {
		const scope: Scope =
			value === 'catalog' || value === 'all' || value === 'unassigned' ? value : Number(value);
		view.setScope(scope, draft);
	}

	const inCollection = $derived(view.scope !== 'catalog');

	// Collection counts copies (as the storage overview does); All cards shows Scryfall's total.
	const count = $derived(
		view.error || view.queryError
			? 0
			: inCollection
				? view.collectionCopies
				: view.query.trim()
					? view.catalogTotal
					: 0
	);
	const printings = $derived(view.filteredCollection.length);
</script>

<div class="mb-6 flex flex-wrap items-center gap-3">
	<form class="min-w-64 max-w-2xl flex-1" onsubmit={onSubmit}>
		<label class="input w-full rounded-full border-base-300 bg-base-100">
			<Search class="size-4 opacity-40" />
			<input
				type="search"
				bind:value={draft}
				placeholder={inCollection ? 'Search your cards (Scryfall syntax)' : 'Search all cards'}
				aria-label={inCollection ? 'Search your cards' : 'Search all cards'}
				autocomplete="off" />
			{#if navigating.to}
				<span class="loading loading-spinner loading-xs opacity-50"></span>
			{/if}
		</label>
	</form>

	<label class="select select-sm w-auto max-w-72 border-base-300">
		<span class="label">In</span>
		<select
			aria-label="Where to search"
			value={String(view.scope)}
			onchange={(e) => onScope(e.currentTarget.value)}>
			<option value="catalog">All cards</option>
			<option value="all">My collection</option>
			<optgroup label="Locations">
				{#each view.locations as loc (loc.id)}
					<option value={String(loc.id)}>{loc.name}</option>
				{/each}
				<option value="unassigned">Unassigned</option>
			</optgroup>
		</select>
	</label>

	{#if count > 0}
		<span
			class="ml-auto text-sm text-base-content/50 tabular-nums"
			aria-live="polite"
			title={inCollection
				? `${count} ${count === 1 ? 'copy' : 'copies'} in ${printings} ${printings === 1 ? 'printing' : 'printings'}`
				: undefined}>
			{count.toLocaleString('en-US')}
			{count === 1 ? 'card' : 'cards'}
		</span>
	{/if}
</div>
