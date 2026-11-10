<script lang="ts">
	import { SearchIcon } from '@lucide/svelte';
	import { dev } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	// PROTOTYPE: inside the `?variant=` Cards prototype, navbar search lands in its
	// Catalog source instead of posting to today's search action.
	const protoVariant = $derived(
		dev && page.url.pathname === '/search' ? page.url.searchParams.get('variant') : null
	);

	function onsubmit(event: SubmitEvent) {
		if (!protoVariant) return;
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		const q = new FormData(form).get('q')?.toString().trim() ?? '';
		const params = new URLSearchParams({ variant: protoVariant, source: 'catalog', q });
		goto(resolve(`/search?${params}` as '/search'));
	}
</script>

<form method="POST" action="/search?/search" {onsubmit}>
	<label class="input">
		<SearchIcon />
		<input type="text" name="q" placeholder="Search" aria-label="Search cards" class="w-full" />
	</label>
</form>
