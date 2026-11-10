<!--
	PROTOTYPE, throwaway. Detail panel: everything the tile leaves out.
	Sections: header (+prices), oracle text, your copies, in decks, other printings.
	Empty sections are hidden.
-->
<script lang="ts" module>
	import type { EnhancedCardResult as Card } from '$lib';
	import { manaSymbolClasses } from '$lib/utils/mana';

	// Other printings cost one Scryfall request each (1 RPS); cache per oracle for the session.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- module-level cache, not reactive state
	const printingsCache = new Map<string, Promise<Card[]>>();

	type OraclePart =
		| { kind: 'text'; text: string; reminder: boolean }
		| { kind: 'symbol'; cls: string; label: string };

	// Mana costs never contain {T}/{Q}, so the shared helper maps them to classes the font lacks.
	function symbolClass(token: string): string {
		if (token === '{T}') return 'ms ms-tap ms-cost';
		if (token === '{Q}') return 'ms ms-untap ms-cost';
		return manaSymbolClasses(token)[0] ?? '';
	}

	/** Oracle text as faces → lines → parts, splitting out symbols and (reminder text). */
	function parseOracle(text: string | undefined): OraclePart[][][] {
		if (!text) return [];
		return text.split('\n//\n').map((face) =>
			face.split('\n').map((line) =>
				line
					.split(/(\([^)]*\))/)
					.filter(Boolean)
					.flatMap((chunk) => {
						const reminder = chunk.startsWith('(');
						return chunk
							.split(/(\{[^}]+\})/)
							.filter(Boolean)
							.map(
								(piece): OraclePart =>
									/^\{[^}]+\}$/.test(piece)
										? { kind: 'symbol', cls: symbolClass(piece), label: piece }
										: { kind: 'text', text: piece, reminder }
							);
					})
			)
		);
	}
</script>

<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		currency,
		getDisplayName,
		notifications,
		type DeckCardUsage,
		type EnhancedCardResult
	} from '$lib';
	import { getTreatmentPrice } from '$lib/utils/card-prices';
	import { ArrowRightLeft, Minus, Plus, X } from '@lucide/svelte';
	import AddPopover from './AddPopover.svelte';
	import {
		changes,
		effectiveStacks,
		finishLabel,
		locationName,
		ownedCount,
		type CardsView,
		type Stack
	} from './state.svelte';

	let { card, view }: { card: EnhancedCardResult; view: CardsView } = $props();

	let decks = $state<DeckCardUsage[] | null>(null);
	let printings = $state<EnhancedCardResult[] | null>(null);
	let adding = $state(false);
	let movingKey = $state<string | null>(null);

	function loadPrintings(oracleId: string): Promise<EnhancedCardResult[]> {
		let pending = printingsCache.get(oracleId);
		if (!pending) {
			const q = encodeURIComponent(`oracleid:${oracleId} unique:prints`);
			pending = fetch(`/api/search?q=${q}`)
				.then((r) => (r.ok ? r.json() : { data: [] }))
				.then((d: { data?: EnhancedCardResult[] }) => d.data ?? [])
				.catch(() => []);
			printingsCache.set(oracleId, pending);
		}
		return pending;
	}

	$effect(() => {
		const id = card.id;
		const oracleId = card.oracle_id;
		let cancelled = false;
		decks = null;
		printings = null;
		adding = false;
		movingKey = null;

		fetch(`/api/decks/for-card/${id}`)
			.then((r) => (r.ok ? (r.json() as Promise<DeckCardUsage[]>) : []))
			.catch(() => [])
			.then((d) => {
				if (!cancelled) decks = d;
			});

		if (oracleId) {
			loadPrintings(oracleId).then((all) => {
				if (!cancelled) printings = all.filter((p) => p.id !== id);
			});
		} else {
			printings = [];
		}
		return () => {
			cancelled = true;
		};
	});

	const stacks = $derived(
		effectiveStacks(card).sort(
			(a, b) =>
				a.finish.localeCompare(b.finish) ||
				locationName(view.locations, a.locationId).localeCompare(
					locationName(view.locations, b.locationId)
				)
		)
	);

	const prices = $derived(
		card.finishes
			.map((f) => {
				const raw = getTreatmentPrice(card.prices, f, currency.current);
				return raw ? `${finishLabel(f)} ${currency.symbol}${raw}` : null;
			})
			.filter(Boolean)
			.join(' · ')
	);

	// Show the card in its own language; fall back to English Oracle text when
	// Scryfall has no localized text for this printing.
	const textLang = $derived(card.printed_text ? card.language : 'en');
	const oracle = $derived(parseOracle(card.printed_text || card.oracle_text));

	const key = (s: Stack) => `${s.finish}|${s.locationId}`;

	function move(s: Stack, value: string) {
		movingKey = null;
		if (value === '') return;
		const to = value === 'unassigned' ? null : Number(value);
		if (to !== s.locationId) changes.move(card, s.finish, s.locationId, to, s.quantity);
	}

	function addToDeck() {
		notifications.info('Prototype: this would open “Add to deck”.');
	}
</script>

{#snippet header()}
	<div class="min-w-0 flex-1">
		<h2 class="text-lg font-semibold leading-snug" lang={card.printed_name ? card.language : 'en'}>
			{getDisplayName(card)}
		</h2>
		<p class="truncate text-sm text-base-content/55">
			{card.set_name}{#if card.collector_number}&nbsp;· #{card.collector_number}{/if}
		</p>
		{#if prices}
			<p class="mt-1 text-sm tabular-nums text-base-content/80">{prices}</p>
		{/if}
	</div>
	<button
		type="button"
		class="btn btn-circle btn-ghost btn-sm -mr-1 -mt-1 shrink-0"
		aria-label="Close details"
		onclick={() => view.close()}>
		<X class="size-4" />
	</button>
{/snippet}

{#snippet oracleText()}
	{#if oracle.length > 0}
		<section class="space-y-3 text-sm leading-relaxed text-base-content/85" lang={textLang}>
			{#each oracle as face, f (f)}
				{#if f > 0}<hr class="border-base-300" />{/if}
				<div class="space-y-1.5">
					{#each face as line, l (l)}
						<p>
							{#each line as part, i (i)}{#if part.kind === 'symbol'}<i
										class="{part.cls} mx-px text-[0.85em]"
										role="img"
										aria-label={part.label}></i
									>{:else}<span class={part.reminder ? 'italic text-base-content/50' : ''}
										>{part.text}</span
									>{/if}{/each}
						</p>
					{/each}
				</div>
			{/each}
		</section>
	{/if}
{/snippet}

{#snippet copies()}
	<section>
		<div class="mb-1 flex items-center">
			<h3 class="section-title">Your copies</h3>
			{#if !adding}
				<button type="button" class="btn btn-ghost btn-xs ml-auto" onclick={() => (adding = true)}>
					<Plus class="size-3.5" /> Add
				</button>
			{/if}
		</div>
		{#if adding}
			<div class="mb-2">
				<AddPopover {card} {view} inline onClose={() => (adding = false)} />
			</div>
		{/if}
		{#if stacks.length === 0}
			{#if !adding}<p class="py-1 text-sm text-base-content/50">None yet</p>{/if}
		{:else}
			<ul class="divide-y divide-base-200">
				{#each stacks as s (key(s))}
					<li class="flex items-center gap-2 py-1.5 text-sm">
						<span class="w-16 shrink-0">{finishLabel(s.finish)}</span>
						{#if movingKey === key(s)}
							<!-- svelte-ignore a11y_autofocus -->
							<select
								class="select select-xs min-w-0 flex-1"
								aria-label="Move to"
								autofocus
								onchange={(e) => move(s, e.currentTarget.value)}
								onblur={() => (movingKey = null)}>
								<option value="">Move to…</option>
								{#each view.locations as loc (loc.id)}
									{#if loc.id !== s.locationId}<option value={String(loc.id)}>{loc.name}</option
										>{/if}
								{/each}
								{#if s.locationId !== null}<option value="unassigned">Unassigned</option>{/if}
							</select>
						{:else}
							<span class="min-w-0 flex-1 truncate text-base-content/60">
								{locationName(view.locations, s.locationId)}
							</span>
							<div class="flex shrink-0 items-center">
								<button
									type="button"
									class="btn btn-square btn-ghost btn-xs"
									aria-label="Remove one"
									onclick={() => changes.adjust(card, s.finish, s.locationId, -1)}>
									<Minus class="size-3.5" />
								</button>
								<span class="w-6 text-center font-medium tabular-nums">{s.quantity}</span>
								<button
									type="button"
									class="btn btn-square btn-ghost btn-xs"
									aria-label="Add one"
									onclick={() => changes.adjust(card, s.finish, s.locationId, 1)}>
									<Plus class="size-3.5" />
								</button>
								<button
									type="button"
									class="btn btn-square btn-ghost btn-xs ml-1"
									aria-label="Move"
									title="Move"
									onclick={() => (movingKey = key(s))}>
									<ArrowRightLeft class="size-3.5" />
								</button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/snippet}

{#snippet inDecks()}
	{#if decks && decks.length > 0}
		<section>
			<div class="mb-1 flex items-center">
				<h3 class="section-title">In decks</h3>
				<button type="button" class="btn btn-ghost btn-xs ml-auto" onclick={addToDeck}>
					<Plus class="size-3.5" /> Add to deck
				</button>
			</div>
			<ul class="divide-y divide-base-200">
				{#each decks as d (`${d.deck_id}-${d.zone}-${d.scryfall_id}-${d.treatment}`)}
					<li class="flex items-center gap-2 py-1.5 text-sm">
						<a
							href={resolve('/decks/[id]', { id: String(d.deck_id) })}
							class="link-hover min-w-0 flex-1 truncate">{d.deck_name}</a>
						<span class="shrink-0 tabular-nums text-base-content/60">{d.desired_quantity}×</span>
					</li>
				{/each}
			</ul>
		</section>
	{:else if decks}
		<button type="button" class="link link-hover text-sm text-base-content/50" onclick={addToDeck}
			>Add to deck</button>
	{/if}
{/snippet}

{#snippet otherPrintings()}
	{#if printings === null}
		<section>
			<h3 class="section-title mb-2">Other printings</h3>
			<div class="flex gap-2">
				{#each [0, 1, 2, 3] as i (i)}<div class="skeleton aspect-[488/680] w-14 shrink-0">
					</div>{/each}
			</div>
		</section>
	{:else if printings.length > 0}
		<section>
			<h3 class="section-title mb-2">Other printings</h3>
			<div class="-mx-1 flex gap-2 overflow-x-auto px-1 pt-1.5 pb-2">
				{#each printings as p (p.id)}
					{@const n = ownedCount(p)}
					<button
						type="button"
						class="relative w-14 shrink-0 transition hover:-translate-y-0.5"
						title="{p.set_name} · #{p.collector_number}"
						onclick={() => view.select(p)}>
						{#if p.image_uri}
							<img
								src={p.image_uri}
								alt={p.set_name}
								loading="lazy"
								class="aspect-[488/680] w-full rounded-[4.75%/3.4%] object-cover shadow-sm" />
						{/if}
						{#if n > 0}
							<span
								class="badge badge-primary badge-xs absolute -right-1.5 -top-1.5 rounded-full px-1 font-semibold tabular-nums"
								>{n}</span>
						{/if}
					</button>
				{/each}
			</div>
		</section>
	{/if}
{/snippet}

<div class="flex h-full flex-col">
	<div class="flex items-start gap-3 px-5 pt-5 pb-3">{@render header()}</div>
	<div class="flex-1 space-y-6 overflow-y-auto px-5 pb-8">
		{@render oracleText()}
		{@render copies()}
		{@render inDecks()}
		{@render otherPrintings()}
	</div>
</div>

<style>
	.section-title {
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
	}
</style>
