<!--
	PROTOTYPE. Compact Add popover: one destination line showing the resolved
	location, one button per finish below it (each click saves one copy), and a
	running tally with undo.
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { EnhancedCardResult, Inventory } from '$lib';
	import { getAvailableTreatments } from '$lib';
	import { Check, ChevronDown, MapPin, Plus } from '@lucide/svelte';
	import {
		addCopy,
		existingLocation,
		finishLabel,
		live,
		locationName,
		resolveAuto,
		ui,
		undoAdd,
		type CardsView,
		type Destination
	} from './state.svelte';

	let {
		card,
		view,
		onClose,
		inline = false
	}: {
		card: EnhancedCardResult;
		view: CardsView;
		onClose: () => void;
		inline?: boolean;
	} = $props();

	type Choice = 'existing' | 'auto' | 'unassigned' | number;

	const finishes = $derived(
		getAvailableTreatments(card.finishes, card.frame_effects ?? [], card.promo_types ?? [])
	);
	// Snapshot at open: adding copies must not move the default under the user.
	const existing = untrack(() => existingLocation(card));

	let activeFinish = $state(untrack(() => card.finishes[0] ?? 'nonfoil'));
	let destination = $state<Choice>(existing !== undefined ? 'existing' : 'auto');
	let auto = $state<Record<string, number | null | undefined>>({});
	let picking = $state(false);
	/** Rows the adds saved to, newest last; Undo takes a copy back from the last. */
	let added = $state<Inventory[]>([]);
	const busy = $derived(live.busy[card.id] ?? false);
	let root = $state<HTMLElement>();

	onMount(() => {
		ui.openPopovers++;
		for (const f of card.finishes) {
			resolveAuto(card, f).then((id) => (auto[f] = id));
		}
		return () => {
			ui.openPopovers--;
		};
	});

	/** `undefined` while the rules are still resolving. */
	function target(finish: string): number | null | undefined {
		if (destination === 'existing') return existing;
		if (destination === 'auto') return auto[finish];
		if (destination === 'unassigned') return null;
		return destination;
	}

	const current = $derived(target(activeFinish));
	const qualifier = $derived(
		destination === 'existing' ? 'next to your copies' : destination === 'auto' ? 'by rules' : ''
	);

	async function add(finish: string) {
		activeFinish = finish;
		// Auto lets the backend run the sorting rules itself; the line shows its preview.
		const to: Destination =
			destination === 'existing'
				? (existing ?? 'unassigned') // "next to your copies" may be the unassigned stack
				: destination;
		const row = await addCopy(card, finish, to);
		if (row) added = [...added, row];
	}

	function undo() {
		const last = added.at(-1);
		if (!last) return;
		added = added.slice(0, -1);
		undoAdd(card, last);
	}

	function choose(d: Choice) {
		destination = d;
		picking = false;
	}

	const tally = $derived.by(() => {
		if (added.length === 0) return '';
		const kinds = new Set(added.map((a) => a.treatment));
		const last = added.at(-1)!;
		const what =
			kinds.size === 1
				? `${added.length}× ${finishLabel(last.treatment)}`
				: `${added.length} copies`;
		// Name the saved location only when it isn't the one the line shows.
		const savedTo = last.storage_location_id ?? null;
		return savedTo === current
			? `Added ${what}`
			: `Added ${what} · ${locationName(view.locations, savedTo)}`;
	});

	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		if (picking) picking = false;
		else onClose();
	}

	function onPointerDown(event: PointerEvent) {
		if (!inline && root && !root.contains(event.target as Node)) onClose();
	}
</script>

<svelte:window onkeydown={onKeydown} onpointerdown={onPointerDown} />

<div
	bind:this={root}
	role="dialog"
	aria-label="Add {card.name}"
	class="rounded-box bg-base-100/95 p-2 text-sm backdrop-blur {inline
		? 'border border-base-300'
		: 'shadow-xl ring-1 ring-base-content/10'}">
	{#if picking}
		<ul class="max-h-56 overflow-y-auto">
			{#if existing !== undefined}
				<li>
					<button type="button" class="dest" onclick={() => choose('existing')}>
						<span class="truncate">Next to your copies</span>
						<span class="dest-hint">{locationName(view.locations, existing)}</span>
					</button>
				</li>
			{/if}
			<li>
				<button type="button" class="dest" onclick={() => choose('auto')}>
					<span class="truncate">Auto (rules)</span>
					<span class="dest-hint">
						{auto[activeFinish] === undefined
							? '…'
							: locationName(view.locations, auto[activeFinish]!)}
					</span>
				</button>
			</li>
			<li class="my-1 border-t border-base-300"></li>
			{#each view.locations as loc (loc.id)}
				<li>
					<button type="button" class="dest" onclick={() => choose(loc.id)}>
						<span class="truncate">{loc.name}</span>
						{#if destination === loc.id}<Check class="size-3.5 shrink-0" />{/if}
					</button>
				</li>
			{/each}
			<li>
				<button type="button" class="dest" onclick={() => choose('unassigned')}>
					<span class="truncate">Unassigned</span>
					{#if destination === 'unassigned'}<Check class="size-3.5 shrink-0" />{/if}
				</button>
			</li>
		</ul>
	{:else}
		<button
			type="button"
			class="flex w-full items-center gap-1.5 rounded-field px-1.5 py-1 text-left text-xs hover:bg-base-200"
			onclick={() => (picking = true)}>
			<MapPin class="size-3.5 shrink-0 opacity-50" />
			<span class="max-w-[75%] shrink-0 truncate font-medium">
				{current === undefined ? 'Resolving…' : locationName(view.locations, current)}
			</span>
			{#if qualifier}<span class="min-w-0 truncate text-base-content/40">· {qualifier}</span>{/if}
			<ChevronDown class="ml-auto size-3.5 shrink-0 opacity-50" />
		</button>

		<div class="mt-1.5 flex flex-wrap gap-1">
			{#each finishes as f (f.key)}
				<button
					type="button"
					class="btn btn-sm min-w-0 flex-1 gap-1 px-2 {f.key === activeFinish && added.length
						? 'btn-primary'
						: 'btn-soft'}"
					title="Add one {f.name}"
					disabled={busy}
					onmouseenter={() => (activeFinish = f.key)}
					onfocus={() => (activeFinish = f.key)}
					onclick={() => add(f.key)}>
					<Plus class="size-3.5 shrink-0" />
					<span class="truncate">{finishLabel(f.key)}</span>
				</button>
			{/each}
		</div>

		{#if tally}
			<div class="mt-1 flex items-center gap-2 px-1.5 text-xs text-base-content/60">
				<span class="truncate">{tally}</span>
				<button
					type="button"
					class="link ml-auto shrink-0 link-hover"
					disabled={busy}
					onclick={undo}>Undo</button>
			</div>
		{/if}
	{/if}
</div>

<style>
	.dest {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 0.5rem;
		border-radius: var(--radius-field);
		padding: 0.375rem 0.5rem;
		text-align: left;
	}
	.dest:hover {
		background: var(--color-base-200);
	}
	.dest-hint {
		margin-left: auto;
		flex-shrink: 0;
		max-width: 50%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
	}
</style>
