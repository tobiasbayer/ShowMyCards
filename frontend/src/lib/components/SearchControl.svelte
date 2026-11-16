<script lang="ts">
	import { SearchIcon } from '@lucide/svelte';
	import { resolve } from '$app/paths';
</script>

<!--
	Navbar search: lands in the Cards page's "All cards" scope. A GET form, so the
	SvelteKit router handles it like a link (and it works without JavaScript).
-->
<form method="GET" action={resolve('/cards')}>
	<input type="hidden" name="source" value="catalog" />
	<label class="input">
		<SearchIcon />
		<input type="text" name="q" placeholder="Search" aria-label="Search cards" class="w-full" />
	</label>
</form>
