<script lang="ts">
	import './layout.css';
	import '#lib/styles/mana.css';
	import favicon from '#lib/assets/favicon.svg';
	import Navbar from '#lib/components/Navbar.svelte';
	import Navigation from '#lib/components/Navigation.svelte';
	import { NotificationContainer, Banners } from '#lib';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<!-- Sits above all app chrome so banners are visible on every route, including the dashboard. -->
<Banners />

<div class="drawer lg:drawer-open">
	<input id="drawer" type="checkbox" class="drawer-toggle" />
	<div class="drawer-content">
		<Navbar />
		<div class="p-4">
			{@render children()}
		</div>
	</div>

	<Navigation />
</div>

<!-- Global notification container -->
<NotificationContainer />
