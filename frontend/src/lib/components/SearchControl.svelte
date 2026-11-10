<script lang="ts">
	import { SearchIcon } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	// PROTOTYPE branch: navbar search lands in the Cards page's "All cards" scope.
	// Only today's search page (`/search?variant=current`) keeps its POST action.
	const onCurrentSearch = $derived(
		page.url.pathname === '/search' && page.url.searchParams.get('variant') === 'current'
	);

	function onsubmit(event: SubmitEvent) {
		if (onCurrentSearch) return;
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		const q = new FormData(form).get('q')?.toString().trim() ?? '';
		const params = new URLSearchParams({ source: 'catalog', q });
		goto(resolve(`/search?${params}` as '/search'));
	}
</script>

<form method="POST" action="/search?/search" {onsubmit}>
	<label class="input">
		<SearchIcon />
		<input type="text" name="q" placeholder="Search" aria-label="Search cards" class="w-full" />
	</label>
</form>
