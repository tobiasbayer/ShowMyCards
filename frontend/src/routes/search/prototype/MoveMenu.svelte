<!--
	PROTOTYPE. "Move stack" menu: the move icon opens a DaisyUI dropdown listing
	the other locations, the same <details class="dropdown"> pattern as
	DeckCardActions. Picking one moves the stack; Esc or a click outside cancels.
	The selection bar reuses it with a text label, opening upwards.
-->
<script lang="ts">
	import type { StorageLocation } from '$lib';
	import { ArrowRightLeft } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import { ui } from './state.svelte';

	let {
		locations,
		current,
		label,
		text,
		top = false,
		disabled = false,
		onMove
	}: {
		locations: StorageLocation[];
		/** Where the copies are now (null = unassigned); left out of the list. Undefined lists all. */
		current?: number | null;
		/** Accessible name of the button. */
		label: string;
		/** Visible text next to the icon; without it the button is icon-only. */
		text?: string;
		/** Open upwards, for a button at the bottom of the screen. */
		top?: boolean;
		disabled?: boolean;
		onMove: (to: number | null) => void;
	} = $props();

	let open = $state(false);
	let root = $state<HTMLDetailsElement>();

	// While open, Esc closes this menu instead of the detail panel. The counter is
	// written untracked: reading it here would re-run this effect on every write.
	$effect(() => {
		if (!open) return;
		untrack(() => ui.openPopovers++);
		return () => untrack(() => ui.openPopovers--);
	});

	function choose(to: number | null) {
		open = false;
		onMove(to);
	}

	function onKeydown(event: KeyboardEvent) {
		if (open && event.key === 'Escape') open = false;
	}

	function onPointerDown(event: PointerEvent) {
		if (open && root && !root.contains(event.target as Node)) open = false;
	}
</script>

<svelte:window onkeydown={onKeydown} onpointerdown={onPointerDown} />

<details
	class="dropdown {top ? 'dropdown-top dropdown-center' : 'dropdown-end'}"
	bind:open
	bind:this={root}>
	<summary
		class="btn btn-ghost {text ? 'btn-sm rounded-full' : 'btn-square btn-xs ml-1'} {disabled
			? 'btn-disabled'
			: ''}"
		title="Move"
		aria-label={label}>
		<ArrowRightLeft class={text ? 'size-4' : 'size-3.5'} />
		{#if text}<span class="hidden sm:inline">{text}</span>{/if}
	</summary>
	<ul
		class="dropdown-content menu menu-sm z-20 {top
			? 'mb-1'
			: 'mt-1'} max-h-72 w-60 flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-100 p-1 shadow-lg">
		<li class="menu-title">Move to</li>
		{#each locations as loc (loc.id)}
			{#if loc.id !== current}
				<li>
					<button type="button" title={loc.name} onclick={() => choose(loc.id)}>
						<span class="truncate">{loc.name}</span>
					</button>
				</li>
			{/if}
		{/each}
		{#if current !== null}
			<li><button type="button" onclick={() => choose(null)}>Unassigned</button></li>
		{/if}
	</ul>
</details>
