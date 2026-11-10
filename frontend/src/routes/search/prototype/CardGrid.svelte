<!--
	PROTOTYPE, throwaway. Infinite-scrolling grid of minimal card tiles.
	Columns reflow by available width, so tiles keep a readable size when the
	side panel narrows the grid: 4 columns at 1440px, fewer while the panel is open.
-->
<script lang="ts">
	import { navigating } from '$app/state';
	import CardTile from './CardTile.svelte';
	import type { CardsView } from './state.svelte';

	let { view }: { view: CardsView } = $props();

	let sentinel = $state<HTMLElement>();

	// Re-observe whenever the list grows so a still-visible sentinel keeps loading.
	$effect(() => {
		void view.cards.length;
		if (!sentinel) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) view.loadMore();
			},
			{ rootMargin: '600px' }
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	});
</script>

{#if view.error}
	<p class="py-16 text-center text-sm text-error">{view.error}</p>
{:else if view.source === 'catalog' && !view.query.trim()}
	<div class="py-24 text-center">
		<p class="text-lg font-medium">Search all cards</p>
		<p class="mt-1 text-sm text-base-content/50">
			Scryfall syntax works, e.g. <code>t:dragon c:r</code>
		</p>
	</div>
{:else if view.cards.length === 0}
	<p class="py-24 text-center text-sm text-base-content/50">No cards match</p>
{:else}
	<!-- 16.5rem min width gives 4 columns at 1440px with the sidebar collapsed or expanded. -->
	<div
		class="grid grid-cols-2 gap-x-4 gap-y-6 transition-opacity sm:grid-cols-[repeat(auto-fill,minmax(16.5rem,1fr))]
			{navigating.to ? 'opacity-50' : ''}">
		{#each view.cards as card (card.id)}
			<CardTile {card} {view} />
		{/each}
	</div>
	<div bind:this={sentinel} class="flex h-16 items-center justify-center">
		{#if view.loadingMore}
			<span class="loading loading-dots loading-sm opacity-40"></span>
		{/if}
	</div>
{/if}
