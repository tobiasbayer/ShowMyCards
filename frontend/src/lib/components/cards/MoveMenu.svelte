<!--
	"Move stack" menu: the move icon opens a dropdown listing the other
	locations. Picking one moves the copies; Esc or a click outside cancels.
	The selection bar reuses it with a text label, opening upwards.
-->
<script lang="ts">
	import type { StorageLocation } from '#lib';
	import { ArrowRightLeft } from '@lucide/svelte';
	import Dropdown from '#lib/components/Dropdown.svelte';
	import { countOpen } from './live.svelte';

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
</script>

<Dropdown
	placement={top ? 'dropdown-top dropdown-center' : 'dropdown-end'}
	summaryClass="btn btn-ghost {text ? 'btn-sm rounded-full' : 'btn-square btn-xs ml-1'}"
	menuClass="w-60 max-h-72"
	{disabled}
	title="Move"
	{label}
	onOpenChange={countOpen}>
	{#snippet trigger()}
		<ArrowRightLeft class={text ? 'size-4' : 'size-3.5'} />
		{#if text}<span class="hidden sm:inline">{text}</span>{/if}
	{/snippet}
	{#snippet children(close)}
		<li class="menu-title">Move to</li>
		{#each locations as loc (loc.id)}
			{#if loc.id !== current}
				<li>
					<button
						type="button"
						title={loc.name}
						onclick={() => {
							close();
							onMove(loc.id);
						}}>
						<span class="truncate">{loc.name}</span>
					</button>
				</li>
			{/if}
		{/each}
		{#if current !== null}
			<li>
				<button
					type="button"
					onclick={() => {
						close();
						onMove(null);
					}}>
					Unassigned
				</button>
			</li>
		{/if}
	{/snippet}
</Dropdown>
