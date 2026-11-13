<!--
	PROTOTYPE. The advanced search builder: a popover under the search field that
	turns a few fields into Scryfall syntax (buildSearchQuery, shared with the old
	page's SearchBuilderModal). The built query replaces the search text. Collection
	scopes add a "Your copies" group (finish, quantity, free for decks); All cards
	leaves it out, since Scryfall rejects those keywords.
-->
<script module lang="ts">
	import type { Set as CardSet } from '$lib/types/models';
	import type { ColorMode, CompareOp, Finish } from '$lib/utils/search-builder';

	type NumericId = 'mv' | 'pow' | 'tou' | 'loy' | 'qty' | 'free';

	function emptyFields() {
		return {
			cardName: '',
			cardType: '',
			set: null as Pick<CardSet, 'code' | 'name'> | null,
			colors: [] as string[],
			colorMode: 'all' as ColorMode,
			finish: '' as Finish,
			numericValues: { mv: '', pow: '', tou: '', loy: '', qty: '', free: '' } as Record<
				NumericId,
				string
			>,
			numericOps: { mv: '=', pow: '=', tou: '=', loy: '=', qty: '=', free: '=' } as Record<
				NumericId,
				CompareOp
			>
		};
	}

	// Module level: every search rebuilds the header (VariantPush is keyed on the
	// server data), and the fields should stay filled until Clear.
	const fields = $state(emptyFields());
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import SetCombobox from '$lib/components/SetCombobox.svelte';
	import { buildSearchQuery } from '$lib/utils/search-builder';
	import { ui, type CardsView } from './state.svelte';

	let {
		view,
		root,
		onRun,
		onClose
	}: {
		view: CardsView;
		/** Clicks inside it (the search field and its toggle) don't close the popover. */
		root: HTMLElement | undefined;
		onRun: (query: string) => void;
		onClose: () => void;
	} = $props();

	const COLORS = [
		{ value: 'w', label: 'White' },
		{ value: 'u', label: 'Blue' },
		{ value: 'b', label: 'Black' },
		{ value: 'r', label: 'Red' },
		{ value: 'g', label: 'Green' },
		{ value: 'c', label: 'Colorless' }
	];

	const COLOR_MODES: { value: ColorMode; label: string; title: string }[] = [
		{ value: 'all', label: 'All', title: 'All selected colors, and possibly more' },
		{ value: 'any', label: 'Any', title: 'Any of the selected colors' },
		{ value: 'exactly', label: 'Exactly', title: 'Exactly these colors' }
	];

	const OPS: CompareOp[] = ['=', '>', '<'];

	type NumberField = { id: NumericId; label: string; title?: string };

	const CARD_NUMBERS: NumberField[] = [
		{ id: 'mv', label: 'Mana value' },
		{ id: 'pow', label: 'Power' },
		{ id: 'tou', label: 'Toughness' },
		{ id: 'loy', label: 'Loyalty' }
	];

	const COPY_NUMBERS: NumberField[] = [
		{ id: 'qty', label: 'Quantity', title: 'Copies of the printing in this scope' },
		{
			id: 'free',
			label: 'Free for decks',
			title: 'Copies of the printing no deck needs, as the deck badge counts them'
		}
	];

	const FINISHES: { value: Exclude<Finish, ''>; label: string }[] = [
		{ value: 'nonfoil', label: 'Nonfoil' },
		{ value: 'foil', label: 'Foil' },
		{ value: 'etched', label: 'Etched' }
	];

	const inCollection = $derived(view.source === 'collection');

	const query = $derived(
		buildSearchQuery(
			{
				cardName: fields.cardName,
				setCode: fields.set?.code ?? '',
				cardType: fields.cardType,
				colors: new Set(fields.colors),
				colorMode: fields.colorMode,
				numericValues: fields.numericValues,
				numericOps: fields.numericOps,
				finish: fields.finish
			},
			{ collection: inCollection }
		)
	);

	let nameInput = $state<HTMLInputElement>();

	onMount(() => {
		nameInput?.focus();
		// While open, Esc closes this popover instead of the detail panel (see AddPopover).
		ui.openPopovers++;
		return () => {
			ui.openPopovers--;
		};
	});

	/** Colorless excludes the colors, and a color excludes colorless. */
	function toggleColor(value: string) {
		if (fields.colors.includes(value)) {
			fields.colors = fields.colors.filter((c) => c !== value);
		} else if (value === 'c') {
			fields.colors = ['c'];
		} else {
			fields.colors = [...fields.colors.filter((c) => c !== 'c'), value];
		}
	}

	function toggleFinish(value: Exclude<Finish, ''>) {
		fields.finish = fields.finish === value ? '' : value;
	}

	function clear() {
		Object.assign(fields, emptyFields());
		nameInput?.focus();
	}

	function onSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (query) onRun(query);
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onClose();
	}

	function onPointerDown(event: PointerEvent) {
		if (root && !root.contains(event.target as Node)) onClose();
	}
</script>

<svelte:window onkeydown={onKeydown} onpointerdown={onPointerDown} />

{#snippet segment(active: boolean, label: string, onclick: () => void, title?: string)}
	<button
		type="button"
		class="btn join-item btn-xs font-normal {active
			? 'btn-neutral'
			: 'border-base-300 bg-base-100'}"
		aria-pressed={active}
		{title}
		{onclick}>
		{label}
	</button>
{/snippet}

{#snippet numberField(field: NumberField)}
	<div title={field.title}>
		<label class="mb-1 block text-xs text-base-content/60" for="sb-{field.id}">
			{field.label}
		</label>
		<div class="flex items-center gap-1.5">
			<div class="join" role="group" aria-label="{field.label} comparison">
				{#each OPS as op (op)}
					{@render segment(
						fields.numericOps[field.id] === op,
						op,
						() => (fields.numericOps[field.id] = op),
						undefined
					)}
				{/each}
			</div>
			<input
				id="sb-{field.id}"
				type="number"
				step="1"
				min="0"
				class="input input-xs w-16 border-base-300"
				value={fields.numericValues[field.id]}
				oninput={(e) => (fields.numericValues[field.id] = e.currentTarget.value)} />
		</div>
	</div>
{/snippet}

<form
	class="absolute top-full left-0 z-30 mt-2 w-[30rem] max-w-[calc(100vw-2rem)] space-y-4 rounded-box border border-base-300 bg-base-100 p-4 shadow-lg"
	aria-label="Advanced search"
	onsubmit={onSubmit}>
	<div class="grid grid-cols-[4.5rem_1fr] items-center gap-x-3 gap-y-2">
		<label class="text-sm text-base-content/60" for="sb-name">Name</label>
		<input
			id="sb-name"
			type="text"
			class="input input-sm w-full border-base-300"
			placeholder="e.g. Lightning Bolt"
			autocomplete="off"
			bind:this={nameInput}
			bind:value={fields.cardName} />

		<label class="text-sm text-base-content/60" for="sb-set">Set</label>
		<div class="[&_.input]:input-sm [&_.input]:w-full [&_.select]:select-sm">
			<SetCombobox id="sb-set" bind:selected={fields.set} />
		</div>

		<label class="text-sm text-base-content/60" for="sb-type">Type</label>
		<input
			id="sb-type"
			type="text"
			class="input input-sm w-full border-base-300"
			placeholder="e.g. Creature, Legendary Dragon"
			autocomplete="off"
			bind:value={fields.cardType} />

		<span class="text-sm text-base-content/60">Colors</span>
		<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
			<div class="flex gap-1" role="group" aria-label="Colors">
				{#each COLORS as color (color.value)}
					{@const on = fields.colors.includes(color.value)}
					<button
						type="button"
						class="btn btn-circle btn-ghost btn-sm text-base {on
							? 'ring-2 ring-primary ring-offset-1 ring-offset-base-100'
							: 'opacity-40 hover:opacity-80'}"
						aria-pressed={on}
						aria-label={color.label}
						title={color.label}
						onclick={() => toggleColor(color.value)}>
						<i class="ms ms-{color.value} ms-cost" aria-hidden="true"></i>
					</button>
				{/each}
			</div>
			{#if fields.colors.length > 0}
				<div class="join" role="group" aria-label="Color match">
					{#each COLOR_MODES as mode (mode.value)}
						{@render segment(
							fields.colorMode === mode.value,
							mode.label,
							() => (fields.colorMode = mode.value),
							mode.title
						)}
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<div class="grid grid-cols-2 gap-x-4 gap-y-3">
		{#each CARD_NUMBERS as field (field.id)}
			{@render numberField(field)}
		{/each}
	</div>

	{#if inCollection}
		<div class="space-y-3 border-t border-base-300 pt-3">
			<div class="text-xs font-medium tracking-wide text-base-content/50 uppercase">
				Your copies
			</div>
			<div>
				<span class="mb-1 block text-xs text-base-content/60">Finish</span>
				<div class="join" role="group" aria-label="Finish">
					{#each FINISHES as finish (finish.value)}
						{@render segment(
							fields.finish === finish.value,
							finish.label,
							() => toggleFinish(finish.value),
							undefined
						)}
					{/each}
				</div>
			</div>
			<div class="grid grid-cols-2 gap-x-4 gap-y-3">
				{#each COPY_NUMBERS as field (field.id)}
					{@render numberField(field)}
				{/each}
			</div>
		</div>
	{/if}

	<div class="flex justify-end gap-2">
		<button type="button" class="btn btn-ghost btn-sm" onclick={clear}>Clear</button>
		<button type="submit" class="btn btn-primary btn-sm" disabled={!query}>Search</button>
	</div>
</form>
