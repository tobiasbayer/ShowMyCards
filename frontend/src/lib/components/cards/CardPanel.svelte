<!--
	Detail panel: everything the tile leaves out. Copy and deck changes are saved.
	Sections: header (+prices), oracle text, your copies, in decks, other printings.
	Empty sections are hidden.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { currency, decksApi, getDisplayName, type DeckCardUsage, type InventoryCard } from '#lib';
	import AddToDeckModal from '#lib/components/AddToDeckModal.svelte';
	import { getTreatmentPrice } from '#lib/utils/card-prices.ts';
	import { Minus, Plus, X } from '@lucide/svelte';
	import AddPopover from './AddPopover.svelte';
	import MoveMenu from './MoveMenu.svelte';
	import { countOpen, live } from './live.svelte';
	import {
		compareLocationOrder,
		effectiveStacks,
		finishLabel,
		locationName,
		ownedCount
	} from './owned';
	import type { Stack } from './stacks';
	import type { CardsView } from './view.svelte';
	import { addCopy, moveStack, refreshCard, removeCopy } from './writes';
	import { languageName } from './language';
	import { loadPrintings } from './printings';
	import { parseOracleText } from '#lib/utils/oracle-text.ts';

	let { card, view }: { card: InventoryCard; view: CardsView } = $props();

	let decks = $state<DeckCardUsage[] | null>(null);
	let decksFailed = $state(false);
	let printings = $state<InventoryCard[] | null>(null);
	let printingsFailed = $state(false);
	let adding = $state(false);
	let deckModal = $state(false);
	const busy = $derived(live.busy[card.id] ?? false);
	/** Bumped when another card opens, so a late answer for the previous one is dropped. */
	let generation = 0;

	/** `keepShown` leaves the current list up while it reloads (after an add). */
	function fetchDecks(id: string, gen: number, keepShown = false) {
		if (!keepShown) decks = null;
		decksFailed = false;
		decksApi.forCard(id).then(
			(d) => {
				if (gen === generation) decks = d;
			},
			() => {
				if (gen === generation) decksFailed = true;
			}
		);
	}

	function fetchPrintings(of: InventoryCard, gen: number) {
		printings = null;
		printingsFailed = false;
		if (!of.oracle_id) {
			printings = [];
			return;
		}
		loadPrintings(of.oracle_id, of.language).then(
			(all) => {
				if (gen === generation) printings = all.filter((p) => p.id !== of.id);
			},
			() => {
				if (gen === generation) printingsFailed = true;
			}
		);
	}

	// While the Add-to-deck dialog is open, Esc closes it (the dialog handles Esc),
	// not the panel. Written untracked: the counter is read elsewhere.
	$effect(() => {
		if (!deckModal) return;
		untrack(() => countOpen(true));
		return () => untrack(() => countOpen(false));
	});

	// A newly opened card starts with its sections loading and nothing open.
	$effect(() => {
		const opened = card;
		untrack(() => {
			const gen = ++generation;
			adding = false;
			deckModal = false;
			fetchDecks(opened.id, gen);
			fetchPrintings(opened, gen);
		});
	});

	const stacks = $derived(
		effectiveStacks(card).sort(
			(a, b) =>
				a.finish.localeCompare(b.finish) ||
				compareLocationOrder(view.locations, a.locationId, b.locationId)
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
	const oracle = $derived(parseOracleText(card.printed_text || card.oracle_text));

	const key = (s: Stack) => `${s.finish}|${s.locationId}`;

	function addToDeck() {
		deckModal = true;
	}

	/** A deck now wants this card: re-read its decks and the deck badge's counts. */
	function onDeckAdded() {
		refreshCard(card);
		fetchDecks(card.id, generation, true);
	}
</script>

{#snippet header()}
	<div class="min-w-0 flex-1">
		<h2 class="text-lg font-semibold leading-snug" lang={card.printed_name ? card.language : 'en'}>
			{getDisplayName(card)}
		</h2>
		<p class="truncate text-sm text-base-content/60">
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
									>{:else}<span class={part.reminder ? 'italic text-base-content/60' : ''}
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
			{#if !adding}<p class="py-1 text-sm text-base-content/60">None yet</p>{/if}
		{:else}
			<ul class="divide-y divide-base-200">
				{#each stacks as s (key(s))}
					<li class="flex items-center gap-2 py-1.5 text-sm">
						<span class="w-16 shrink-0">{finishLabel(s.finish)}</span>
						<span class="min-w-0 flex-1 truncate text-base-content/60">
							{locationName(view.locations, s.locationId)}
						</span>
						<div class="flex shrink-0 items-center">
							<button
								type="button"
								class="btn btn-square btn-ghost btn-xs"
								aria-label="Remove one"
								disabled={busy}
								onclick={() => removeCopy(card, s)}>
								<Minus class="size-3.5" />
							</button>
							<span class="w-6 text-center font-medium tabular-nums">{s.quantity}</span>
							<button
								type="button"
								class="btn btn-square btn-ghost btn-xs"
								aria-label="Add one"
								disabled={busy}
								onclick={() => addCopy(card, s.finish, s.locationId ?? 'unassigned')}>
								<Plus class="size-3.5" />
							</button>
							<MoveMenu
								locations={view.locations}
								current={s.locationId}
								label="Move {finishLabel(s.finish)} copies from {locationName(
									view.locations,
									s.locationId
								)}"
								disabled={busy}
								onMove={(to) => moveStack(card, s, to)} />
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/snippet}

{#snippet loadFailed(what: string, retry: () => void)}
	<p class="py-1 text-sm text-base-content/60" role="alert">
		Couldn't load {what}.
		<button type="button" class="link link-hover" onclick={retry}>Retry</button>
	</p>
{/snippet}

{#snippet inDecks()}
	{#if decks || decksFailed}
		<section>
			<div class="mb-1 flex items-center">
				<h3 class="section-title">In decks</h3>
				<button type="button" class="btn btn-ghost btn-xs ml-auto" onclick={addToDeck}>
					<Plus class="size-3.5" /> Add to deck
				</button>
			</div>
			{#if decksFailed}
				{@render loadFailed('its decks', () => fetchDecks(card.id, generation))}
			{:else if decks && decks.length > 0}
				<ul class="divide-y divide-base-200">
					{#each decks as d (`${d.deck_id}-${d.zone}-${d.scryfall_id}-${d.treatment}`)}
						<li class="flex items-center gap-2 py-1.5 text-sm">
							<a
								href={resolve('/decks/[id]', { id: String(d.deck_id) })}
								class="link-hover min-w-0 flex-1 truncate"
								>{d.deck_name}{#if d.zone !== 'main'}<span class="text-base-content/60">
										· {d.zone}</span
									>{/if}</a>
							<span class="shrink-0 tabular-nums text-base-content/60">{d.desired_quantity}×</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
{/snippet}

{#snippet otherPrintings()}
	{#if printingsFailed}
		<section>
			<h3 class="section-title mb-1">Other printings</h3>
			{@render loadFailed('other printings', () => fetchPrintings(card, generation))}
		</section>
	{:else if printings === null}
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
					{@const diffLang = Boolean(p.language && p.language !== card.language)}
					<button
						type="button"
						class="relative w-14 shrink-0 transition hover:-translate-y-0.5"
						title="{p.set_name} · #{p.collector_number}{diffLang
							? ` · ${languageName(p.language)}`
							: ''}"
						onclick={() => view.select(p)}>
						{#if p.image_uri}
							<img
								src={p.image_uri}
								alt={diffLang ? `${p.set_name} (${languageName(p.language)})` : p.set_name}
								loading="lazy"
								class="aspect-[488/680] w-full rounded-[4.75%/3.4%] object-cover shadow-sm" />
						{/if}
						{#if n > 0}
							<span
								class="badge badge-primary badge-xs absolute -right-1.5 -top-1.5 rounded-full px-1 font-semibold tabular-nums"
								>{n}</span>
						{/if}
						{#if diffLang}
							<span
								class="badge badge-neutral badge-xs absolute bottom-1 left-1 rounded px-1 font-semibold uppercase"
								>{p.language}</span>
						{/if}
					</button>
				{/each}
			</div>
		</section>
	{/if}
{/snippet}

<div class="flex h-full flex-col">
	<div class="flex items-start gap-3 px-5 pt-5 pb-3">{@render header()}</div>
	<div class="flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 pb-8">
		{@render oracleText()}
		{@render copies()}
		{@render inDecks()}
		{@render otherPrintings()}
	</div>
</div>

{#if deckModal}
	<AddToDeckModal
		open
		cards={[
			{
				oracle_id: card.oracle_id,
				scryfall_id: card.id,
				name: getDisplayName(card),
				set_name: card.set_name,
				image_uri: card.image_uri,
				copies: 1
			}
		]}
		pinByDefault={ownedCount(card) > 0}
		onClose={() => (deckModal = false)}
		onAdded={onDeckAdded} />
{/if}

<style>
	.section-title {
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: color-mix(in oklab, var(--color-base-content) 60%, transparent);
	}
</style>
