<!--
	PROTOTYPE, throwaway. Page chrome for the Cards prototype: one search field
	(applied on Enter) with the advanced search builder behind its sliders icon,
	one scope dropdown (All cards, My collection, a location, Unassigned), a
	language dropdown and a result count.
-->
<script lang="ts">
	import { navigating } from '$app/state';
	import { untrack } from 'svelte';
	import { Search, SlidersHorizontal } from '@lucide/svelte';
	import { typedLanguageClause } from '$lib/utils/language-clause';
	import LanguageMenu from './LanguageMenu.svelte';
	import SearchBuilder from './SearchBuilder.svelte';
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

	let building = $state(false);
	let searchRoot = $state<HTMLElement>();

	/** The builder's query replaces the typed one and runs like Enter. */
	function runBuilt(query: string) {
		building = false;
		draft = query;
		view.query = query;
		view.navigate(view.source);
	}

	function onScope(value: string) {
		const scope: Scope =
			value === 'catalog' || value === 'all' || value === 'unassigned' ? value : Number(value);
		view.setScope(scope, draft);
	}

	const inCollection = $derived(view.scope !== 'catalog');
	// A language typed in the search wins over the dropdown (on the backend too).
	const typedClause = $derived(typedLanguageClause(draft));

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
	<div class="relative min-w-64 max-w-2xl flex-1" bind:this={searchRoot}>
		<form class="relative" onsubmit={onSubmit}>
			<label class="input w-full rounded-full border-base-300 bg-base-100 pr-10">
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
			<!-- Outside the label: a label may hold only the control it names. -->
			<button
				type="button"
				class="btn btn-circle btn-ghost btn-xs absolute top-1/2 right-2.5 -translate-y-1/2 {building
					? 'text-primary'
					: 'opacity-50 hover:opacity-100'}"
				title="Advanced search"
				aria-label="Advanced search"
				aria-expanded={building}
				onclick={() => (building = !building)}>
				<SlidersHorizontal class="size-4" />
			</button>
		</form>
		{#if building}
			<SearchBuilder {view} root={searchRoot} onRun={runBuilt} onClose={() => (building = false)} />
		{/if}
	</div>

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

	<LanguageMenu
		value={view.language}
		{typedClause}
		onChange={(language) => view.setLanguage(language, draft)} />

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
