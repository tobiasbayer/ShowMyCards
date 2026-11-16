<script lang="ts">
	import CardsPage from '$lib/components/cards/CardsPage.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Cards - ShowMyCards</title>
</svelte:head>

<!-- Every search, scope, language and sort change is a new server load: start a fresh view. -->
{#key data.cards}
	<CardsPage
		data={data.cards}
		locations={data.storageLocations}
		settingsLanguage={data.defaultLanguage} />
{/key}
