<!--
	The Cards page's header: one search field (applied on Enter) with the advanced
	search builder behind its sliders icon, the scope dropdown (All cards, My
	collection, a location, Unassigned), the language dropdown, the sort menu and
	the result count.
-->
<script lang="ts">
	import { navigating } from '$app/state';
	import { untrack } from 'svelte';
	import { Search, SlidersHorizontal } from '@lucide/svelte';
	import { typedLanguageClause } from '$lib/utils/language-clause';
	import LanguageMenu from './LanguageMenu.svelte';
	import { plural } from './format';
	import ScopeMenu from './ScopeMenu.svelte';
	import SearchBuilder from './SearchBuilder.svelte';
	import SortMenu from './SortMenu.svelte';
	import { typedOrderClause } from './sort';
	import type { CardsView } from './view.svelte';

	let { view }: { view: CardsView } = $props();

	// What is typed applies on Enter or on a scope change; `view.query` is what ran.
	// Seeded once: the header is recreated with each view (see CardsPage).
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

	const inCollection = $derived(view.scope !== 'catalog');
	// A language typed in the search wins over the dropdown (on the backend too).
	const typedClause = $derived(typedLanguageClause(draft));
	// Likewise a typed order: wins over the sort menu.
	const typedOrder = $derived(typedOrderClause(draft));

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

	<ScopeMenu
		value={view.scope}
		locations={view.locations}
		onChange={(scope) => view.setScope(scope, draft)} />

	<LanguageMenu
		value={view.language}
		{typedClause}
		onChange={(language) => view.setLanguage(language, draft)} />

	<SortMenu
		value={view.pickedSort}
		defaultLabel={inCollection ? 'Newest' : 'Name'}
		typedClause={typedOrder}
		onChange={(sort) => view.setSort(sort, draft)} />

	{#if count > 0}
		<span
			class="ml-auto text-sm text-base-content/60 tabular-nums"
			aria-live="polite"
			title={inCollection
				? `${plural(count, 'copy', 'copies')} in ${plural(printings, 'printing', 'printings')}`
				: undefined}>
			{count.toLocaleString('en-US')}
			{count === 1 ? 'card' : 'cards'}
		</span>
	{/if}
</div>
