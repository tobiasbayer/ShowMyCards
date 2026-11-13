<!--
	PROTOTYPE. The Cards page's sort menu: the scope's default order, or by price
	either way. The same <details class="dropdown"> pattern as LanguageMenu.
	A price pick takes the currency preference at the moment it is picked.
	Disabled while the query has its own `order:`; that clause wins.
-->
<script lang="ts">
	import { ArrowDownUp, Check } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import { currency } from '$lib/stores/currency.svelte';
	import { sortParam, type PriceSort } from './sort';
	import { ui } from './state.svelte';

	let {
		value,
		defaultLabel,
		typedClause = null,
		onChange
	}: {
		/** The picked price sort; null is the scope's default order. */
		value: PriceSort | null;
		/** What the default order is called in this scope ("Newest", "Name"). */
		defaultLabel: string;
		/** An order clause typed in the search (e.g. `order:cmc`); it disables the menu. */
		typedClause?: string | null;
		onChange: (sort: PriceSort | null) => void;
	} = $props();

	type Entry = { direction: PriceSort['direction'] | null; label: string };
	const entries = $derived<Entry[]>([
		{ direction: null, label: defaultLabel },
		{ direction: 'desc', label: 'Price: highest first' },
		{ direction: 'asc', label: 'Price: lowest first' }
	]);

	let open = $state(false);
	let root = $state<HTMLDetailsElement>();
	const disabled = $derived(typedClause !== null);
	const current = $derived(
		entries.find((e) => e.direction === (value?.direction ?? null)) ?? entries[0]
	);
	const label = $derived(disabled ? typedClause : current.label);

	// A typed clause closes the menu: picking now would have no effect.
	$effect(() => {
		if (disabled) open = false;
	});

	// While open, Esc closes this menu instead of the detail panel (see MoveMenu).
	$effect(() => {
		if (!open) return;
		untrack(() => ui.openPopovers++);
		return () => untrack(() => ui.openPopovers--);
	});

	function choose(direction: Entry['direction']) {
		open = false;
		const next = direction ? { currency: currency.current, direction } : null;
		// Picking the same direction again switches it to the current currency.
		if (sortParam(next) !== sortParam(value)) onChange(next);
	}

	function onKeydown(event: KeyboardEvent) {
		if (open && event.key === 'Escape') open = false;
	}

	function onPointerDown(event: PointerEvent) {
		if (open && root && !root.contains(event.target as Node)) open = false;
	}
</script>

<svelte:window onkeydown={onKeydown} onpointerdown={onPointerDown} />

<!-- See LanguageMenu for why the tooltip sits on the wrapper and the summary has no tabindex. -->
<div
	class="shrink-0"
	title={disabled ? `The order in your search (${typedClause}) applies` : 'Sort order'}>
	<details class="dropdown dropdown-end" bind:open bind:this={root}>
		<summary
			class="select select-sm w-auto gap-1.5 border-base-300 {disabled
				? 'pointer-events-none opacity-50'
				: ''}"
			aria-label="Sort order: {label}"
			aria-disabled={disabled}
			tabindex={disabled ? -1 : undefined}>
			<ArrowDownUp class="size-3.5 opacity-50" aria-hidden="true" />
			{label}
		</summary>
		<ul
			class="dropdown-content menu menu-sm z-20 mt-1 w-52 flex-nowrap rounded-box border border-base-300 bg-base-100 p-1 shadow-lg">
			{#each entries as entry (entry.direction)}
				<li>
					<button type="button" onclick={() => choose(entry.direction)}>
						<span class="flex-1">{entry.label}</span>
						{#if entry === current}<Check class="size-3.5 opacity-60" />{/if}
					</button>
				</li>
			{/each}
		</ul>
	</details>
</div>
