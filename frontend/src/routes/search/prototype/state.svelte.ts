// PROTOTYPE. Answers: "what should a unified, uncluttered Cards page
// (all cards + the collection, detail panel, Add popover) look like?"
// Writes go to the real backend through the /api proxy; what they return
// overrides the page's loaded data until the next server load.

import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { page } from '$app/state';
import { SvelteSet } from 'svelte/reactivity';
import {
	apiClient,
	inventoryApi,
	notifications,
	type DeckAvailability,
	type EnhancedCardResult,
	type Inventory,
	type SearchResponse,
	type StorageLocation
} from '$lib';
import {
	aggregateStacks,
	idsBetween,
	inLocation,
	pickRowToDecrement,
	rowsInLocation,
	rowsOfStack,
	type LocationFilter,
	type Stack
} from './stacks';

export type { LocationFilter, Stack } from './stacks';

export type Source = 'collection' | 'catalog';
/**
 * The scope dropdown: `catalog` is "All cards" (Scryfall); a LocationFilter is
 * the collection (`all` = every location, `unassigned`, or one location id).
 */
export type Scope = 'catalog' | LocationFilter;
/** Where an added copy goes: a location id, unassigned, or wherever the sorting rules say. */
export type Destination = number | 'unassigned' | 'auto';

/** Data the server load hands to the prototype (see ../+page.server.ts). */
export interface ProtoData {
	source: Source;
	query: string;
	collection: EnhancedCardResult[];
	/** `total` is Scryfall's match count for the query, not just the loaded pages. */
	catalog: { cards: EnhancedCardResult[]; hasMore: boolean; total: number };
	/** oracle_id -> copies owned / decked / free across all printings (from the backend). */
	availability: Record<string, DeckAvailability>;
	error: string | null;
	/** A search the backend couldn't run; `code` picks the hint (see QueryErrorResponse). */
	queryError: QueryError | null;
}

export interface QueryError {
	message: string;
	code: string;
}

/**
 * Server data re-read after this session's writes. It overrides the page's
 * loaded data; a new server load brings fresh data, so CardsView resets it.
 */
class Live {
	/** cardId -> the printing's inventory rows. */
	rows = $state<Record<string, Inventory[]>>({});
	/** oracleId -> copies owned / decked / free. */
	availability = $state<Record<string, DeckAvailability>>({});
	/** Cards that gained copies here, so My collection lists them before a reload. */
	owned = $state<Record<string, EnhancedCardResult>>({});
	/** cardIds with a write in flight. */
	busy = $state<Record<string, boolean>>({});

	reset() {
		this.rows = {};
		this.availability = {};
		this.owned = {};
		this.busy = {};
	}
}

export const live = new Live();

/** Open Add popovers; Esc closes a popover before it closes the detail panel. */
export const ui = $state({ openPopovers: 0 });

/** The printing's rows: re-read after a write, else as loaded. */
function currentRows(card: EnhancedCardResult): Inventory[] {
	return live.rows[card.id] ?? card.inventory.this_printing;
}

export function effectiveStacks(card: EnhancedCardResult): Stack[] {
	return aggregateStacks(currentRows(card));
}

interface Page<T> {
	data: T[] | null;
}

/** Re-reads one card's rows and its deck availability after a write. */
async function refresh(card: EnhancedCardResult) {
	const [rows, availability] = await Promise.all([
		apiClient.get<Page<Inventory>>(
			`/inventory?scryfall_id=${encodeURIComponent(card.id)}&page_size=100`
		),
		apiClient.get<DeckAvailability>(`/inventory/availability/${encodeURIComponent(card.oracle_id)}`)
	]);
	live.rows[card.id] = rows.data ?? [];
	live.availability[card.oracle_id] = availability;
	if (live.rows[card.id].some((r) => r.quantity > 0)) live.owned[card.id] = card;
}

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- write queue, not reactive state
const queues = new Map<string, Promise<unknown>>();

/**
 * Runs one write for a card after the previous one finished, so quick repeated
 * clicks can't race, then re-reads the card. Errors become a toast.
 */
function enqueue<T>(card: EnhancedCardResult, write: () => Promise<T>): Promise<T | undefined> {
	const run = (queues.get(card.id) ?? Promise.resolve()).then(async () => {
		live.busy[card.id] = true;
		try {
			const result = await write();
			await refresh(card);
			return result;
		} catch (e) {
			notifications.error(`Couldn't save: ${e instanceof Error ? e.message : 'unknown error'}`);
			await refresh(card).catch(() => {});
			return undefined;
		} finally {
			live.busy[card.id] = false;
		}
	});
	queues.set(card.id, run);
	return run;
}

function decrementRow(row: Inventory) {
	return row.quantity > 1
		? apiClient.put<Inventory>(`/inventory/${row.id}`, { quantity: row.quantity - 1 })
		: apiClient.delete(`/inventory/${row.id}`);
}

/** Adds one copy; it joins an existing stack at the destination. Resolves to the saved row. */
export function addCopy(
	card: EnhancedCardResult,
	finish: string,
	destination: Destination
): Promise<Inventory | undefined> {
	return enqueue(card, () =>
		apiClient.post<Inventory>('/inventory', {
			scryfall_id: card.id,
			oracle_id: card.oracle_id,
			treatment: finish,
			quantity: 1,
			merge: true,
			...(destination === 'unassigned'
				? { unassigned: true }
				: destination === 'auto'
					? {}
					: { storage_location_id: destination })
		})
	);
}

/** Removes one copy from a stack. */
export function removeCopy(card: EnhancedCardResult, stack: Stack) {
	return enqueue(card, async () => {
		const row = pickRowToDecrement(currentRows(card), stack);
		if (row) await decrementRow(row);
	});
}

/** Takes back one copy from the row an add returned. */
export function undoAdd(card: EnhancedCardResult, added: Inventory) {
	return enqueue(card, async () => {
		const row = currentRows(card).find((r) => r.id === added.id);
		if (row && row.quantity > 0) await decrementRow(row);
	});
}

/** Moves every copy of a stack; the backend joins it with a stack already at the destination. */
export function moveStack(card: EnhancedCardResult, stack: Stack, to: number | null) {
	return enqueue(card, async () => {
		const rows = rowsOfStack(currentRows(card), stack);
		if (rows.length === 0 || to === stack.locationId) return;
		const quantity = rows.reduce((sum, r) => sum + r.quantity, 0);
		await apiClient.post(`/inventory/${rows[0].id}/split-move`, {
			quantity,
			...(to === null ? {} : { storage_location_id: to })
		});
	});
}

/** After adding a card to a deck, re-read its availability (the deck badge). */
export function refreshCard(card: EnhancedCardResult) {
	return enqueue(card, async () => {});
}

/** Ids per batch request: the backend's MaxBatchIDs (backend/api/constants.go). */
const BATCH_SIZE = 1000;
/** Cards re-read at once after a bulk write. */
const REFRESH_CONCURRENCY = 6;

function chunks<T>(items: T[]): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += BATCH_SIZE) out.push(items.slice(i, i + BATCH_SIZE));
	return out;
}

const copies = (n: number) => `${n} ${n === 1 ? 'copy' : 'copies'}`;
const sumQuantity = (rows: Inventory[]) => rows.reduce((sum, r) => sum + r.quantity, 0);

/** The card's rows holding copies in the scope: what a bulk action touches. */
export function scopeRows(card: EnhancedCardResult, filter: LocationFilter): Inventory[] {
	return rowsInLocation(currentRows(card), filter);
}

/** Re-reads cards a few at a time; a card that fails keeps what it showed. */
async function refreshAll(cards: EnhancedCardResult[]) {
	let next = 0;
	const worker = async () => {
		while (next < cards.length) await refresh(cards[next++]).catch(() => {});
	};
	await Promise.all(Array.from({ length: Math.min(REFRESH_CONCURRENCY, cards.length) }, worker));
}

/**
 * Runs one write over several cards once their queued single-card writes are
 * done, and makes later single-card writes wait for it. Afterwards it re-reads
 * every card, after a failure too, so what is shown matches the database.
 */
function bulk<T>(cards: EnhancedCardResult[], write: () => Promise<T>): Promise<T | undefined> {
	const run = Promise.all(cards.map((c) => queues.get(c.id))).then(async () => {
		for (const c of cards) live.busy[c.id] = true;
		try {
			return await write();
		} catch (e) {
			notifications.error(`Couldn't save: ${e instanceof Error ? e.message : 'unknown error'}`);
			return undefined;
		} finally {
			await refreshAll(cards);
			for (const c of cards) live.busy[c.id] = false;
		}
	});
	for (const c of cards) queues.set(c.id, run);
	return run;
}

/**
 * Moves the cards' copies in the scope to a location (null = unassigned).
 * Resolves to true once copies moved.
 */
export function moveCopies(
	cards: EnhancedCardResult[],
	filter: LocationFilter,
	to: number | null,
	locations: StorageLocation[]
) {
	return bulk(cards, async () => {
		const rows = cards
			.flatMap((c) => scopeRows(c, filter))
			.filter((r) => (r.storage_location_id ?? null) !== to);
		const where = locationName(locations, to);
		if (rows.length === 0) {
			notifications.info(`Already in ${where}`);
			return false;
		}
		for (const ids of chunks(rows.map((r) => r.id))) {
			await inventoryApi.batchMove(ids, to ?? undefined);
		}
		notifications.success(`Moved ${copies(sumQuantity(rows))} to ${where}`);
		return true;
	});
}

/** Deletes the cards' copies in the scope. Resolves to true once copies are deleted. */
export function deleteCopies(cards: EnhancedCardResult[], filter: LocationFilter) {
	return bulk(cards, async () => {
		const rows = cards.flatMap((c) => scopeRows(c, filter));
		if (rows.length === 0) return false;
		for (const ids of chunks(rows.map((r) => r.id))) await inventoryApi.batchDelete(ids);
		notifications.success(`Deleted ${copies(sumQuantity(rows))}`);
		return true;
	});
}

/**
 * Lets the sorting rules place the cards' copies in the scope again.
 * Resolves to true once the rules ran.
 */
export async function resortCopies(
	cards: EnhancedCardResult[],
	filter: LocationFilter
): Promise<boolean> {
	let before: Inventory[] = [];
	const errors = await bulk(cards, async () => {
		before = cards.flatMap((c) => scopeRows(c, filter));
		// Never send an empty list: the backend re-sorts the whole collection then.
		if (before.length === 0) return undefined;
		let failed = 0;
		for (const ids of chunks(before.map((r) => r.id))) {
			failed += (await inventoryApi.resort(ids)).errors;
		}
		return failed;
	});
	if (errors === undefined) return false;

	// Re-sort keeps row ids, so the rows re-read by bulk() show which copies moved.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local lookup, not state
	const now = new Map(cards.flatMap((c) => currentRows(c)).map((r) => [r.id, r]));
	const moved = sumQuantity(
		before.filter(
			(r) => (now.get(r.id)?.storage_location_id ?? null) !== (r.storage_location_id ?? null)
		)
	);
	const result = moved === 0 ? 'Already sorted' : `Sorting rules moved ${copies(moved)}`;
	if (errors > 0) notifications.warning(`${result}; ${errors} couldn't be sorted`);
	else notifications.success(result);
	return true;
}

/** After adding cards to a deck, re-read them (the deck badges). */
export function refreshCards(cards: EnhancedCardResult[]) {
	return bulk(cards, async () => {});
}

export function matchesLocation(stack: Pick<Stack, 'locationId'>, filter: LocationFilter): boolean {
	return inLocation(stack.locationId, filter);
}

export function ownedCount(card: EnhancedCardResult, filter: LocationFilter = 'all'): number {
	return effectiveStacks(card)
		.filter((s) => matchesLocation(s, filter))
		.reduce((sum, s) => sum + s.quantity, 0);
}

export function ownsOtherPrinting(card: EnhancedCardResult): boolean {
	return card.inventory.other_printings.some((row) => row.quantity > 0);
}

/**
 * Where "next to existing copies" points: the location holding the most copies
 * of this printing, else of any other printing. `undefined` when nothing is owned.
 */
export function existingLocation(card: EnhancedCardResult): number | null | undefined {
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local tally in a pure function
	const tally = new Map<number | null, number>();
	const own = effectiveStacks(card);
	if (own.length > 0) {
		for (const s of own) tally.set(s.locationId, (tally.get(s.locationId) ?? 0) + s.quantity);
	} else {
		for (const row of card.inventory.other_printings) {
			const id = row.storage_location_id ?? null;
			tally.set(id, (tally.get(id) ?? 0) + row.quantity);
		}
	}
	let best: number | null | undefined;
	let bestCount = 0;
	for (const [id, count] of tally) {
		if (count > bestCount) {
			best = id;
			bestCount = count;
		}
	}
	return best;
}

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- module-level cache, not reactive state
const autoCache = new Map<string, Promise<number | null>>();

/** Mirrors the backend's AutoLocationResponse (its generated type leaves the location untyped). */
interface AutoLocation {
	storage_location: StorageLocation | null;
}

/**
 * Where the sorting rules would put this card, from the same code the backend
 * runs when it auto-sorts a new copy, so the preview matches the real outcome.
 */
export function resolveAuto(card: EnhancedCardResult, finish: string): Promise<number | null> {
	const key = `${card.id}|${finish}`;
	let pending = autoCache.get(key);
	if (!pending) {
		const query = `scryfall_id=${encodeURIComponent(card.id)}&treatment=${encodeURIComponent(finish)}`;
		pending = apiClient
			.get<AutoLocation>(`/inventory/auto-location?${query}`)
			.then((res) => res.storage_location?.id ?? null)
			.catch(() => null);
		autoCache.set(key, pending);
	}
	return pending;
}

export function locationName(locations: StorageLocation[], id: number | null): string {
	if (id === null) return 'Unassigned';
	return locations.find((l) => l.id === id)?.name ?? `Location ${id}`;
}

export function finishLabel(finish: string): string {
	return finish.charAt(0).toUpperCase() + finish.slice(1);
}

const STEP = 60;

function searchPath(params: URLSearchParams): string {
	const query = params.toString();
	return `/search${query ? `?${query}` : ''}`;
}

/** Per-variant view state: source, query, location filter, selection, paging. */
export class CardsView {
	source = $state<Source>('collection');
	query = $state('');
	location = $state<LocationFilter>('all');
	selected = $state<EnhancedCardResult | null>(null);

	catalog = $state.raw<EnhancedCardResult[]>([]);
	catalogPage = $state(1);
	hasMore = $state(false);
	catalogTotal = $state(0);
	loadingMore = $state(false);
	error = $state<string | null>(null);
	queryError = $state<QueryError | null>(null);
	visibleCount = $state(STEP);

	readonly collection: EnhancedCardResult[];
	readonly locations: StorageLocation[];
	readonly availability: Record<string, DeckAvailability>;

	constructor(proto: ProtoData, locations: StorageLocation[]) {
		this.source = proto.source;
		this.query = proto.query;
		this.collection = proto.collection;
		this.catalog = proto.catalog.cards;
		this.hasMore = proto.catalog.hasMore;
		this.catalogTotal = proto.catalog.total;
		this.error = proto.error;
		this.queryError = proto.queryError;
		this.locations = locations;
		this.availability = proto.availability;
		// Fresh server data supersedes what earlier writes re-read.
		live.reset();
		const loc = page.url.searchParams.get('location');
		if (loc === 'unassigned') this.location = 'unassigned';
		else if (loc && /^\d+$/.test(loc)) this.location = Number(loc);
	}

	/** Copies of this card (all printings) owned, committed to decks, and free for deck building. */
	forDecks(card: EnhancedCardResult): DeckAvailability {
		return (
			live.availability[card.oracle_id] ??
			this.availability[card.oracle_id] ?? { owned: 0, decked: 0, free: 0 }
		);
	}

	/**
	 * Collection printings in the server's order (the backend already applied the
	 * query and scope); cards owned since load on top. The location check keeps a
	 * card that was just moved out of the shown location from lingering.
	 */
	filteredCollection = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local lookup in derived computation
		const known = new Set(this.collection.map((c) => c.id));
		const fresh = Object.values(live.owned).filter((c) => !known.has(c.id));
		return [...fresh.reverse(), ...this.collection].filter((card) =>
			effectiveStacks(card).some((s) => matchesLocation(s, this.location))
		);
	});

	/**
	 * Copies matching the current name and location filter, the same unit the
	 * storage overview uses for a location's card count.
	 */
	collectionCopies = $derived(
		this.filteredCollection.reduce((sum, card) => sum + ownedCount(card, this.location), 0)
	);

	cards = $derived(
		this.source === 'collection'
			? this.filteredCollection.slice(0, this.visibleCount)
			: this.catalog
	);

	canLoadMore = $derived(
		this.source === 'collection'
			? this.visibleCount < this.filteredCollection.length
			: this.hasMore && !this.loadingMore
	);

	/** Every match: all of the collection's, or the loaded All cards pages. */
	results = $derived(this.source === 'collection' ? this.filteredCollection : this.catalog);

	/**
	 * Ids of the tiles checked for a bulk action. The view is rebuilt on every
	 * server load, so a new search or scope starts with nothing checked.
	 */
	checked = new SvelteSet<string>();
	/** The last tile toggled; Shift-click checks the range from it. */
	#anchor: string | null = null;

	checkedCards = $derived(this.results.filter((card) => this.checked.has(card.id)));
	/** While anything is checked, a click on a tile toggles it instead of opening the panel. */
	selecting = $derived(this.checkedCards.length > 0);

	toggleCheck(card: EnhancedCardResult, range = false) {
		const on = !this.checked.has(card.id);
		const ids =
			range && this.#anchor
				? idsBetween(
						this.cards.map((c) => c.id),
						this.#anchor,
						card.id
					)
				: [card.id];
		for (const id of ids) {
			if (on) this.checked.add(id);
			else this.checked.delete(id);
		}
		this.#anchor = card.id;
	}

	checkAll() {
		for (const card of this.results) this.checked.add(card.id);
	}

	clearChecks() {
		this.checked.clear();
		this.#anchor = null;
	}

	async loadMore() {
		if (!this.canLoadMore) return;
		if (this.source === 'collection') {
			this.visibleCount += STEP;
			return;
		}
		this.loadingMore = true;
		try {
			const next = this.catalogPage + 1;
			const res = await fetch(`/api/search?q=${encodeURIComponent(this.query)}&page=${next}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as SearchResponse;
			this.catalog = [...this.catalog, ...(data.data ?? [])];
			this.catalogPage = next;
			this.hasMore = data.has_more;
			this.catalogTotal = data.total_cards;
		} catch {
			this.hasMore = false;
		} finally {
			this.loadingMore = false;
		}
	}

	select(card: EnhancedCardResult) {
		this.selected = card;
	}

	close() {
		this.selected = null;
	}

	#params(): URLSearchParams {
		// window.location, not page.url: shallow replaceState doesn't update page.url.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- one-off URL builder, not state
		return new URLSearchParams(window.location.search);
	}

	scope = $derived<Scope>(this.source === 'catalog' ? 'catalog' : this.location);

	/** Applies a scope from the dropdown and reruns `query` in it. */
	setScope(scope: Scope, query: string) {
		this.query = query;
		if (scope === 'catalog') this.navigate('catalog', 'all');
		else this.navigate('collection', scope);
	}

	/** Every search and scope change goes through the server load. */
	navigate(source: Source, location?: LocationFilter) {
		const params = this.#params();
		params.set('source', source);
		if (location === 'all') params.delete('location');
		else if (location !== undefined) params.set('location', String(location));
		if (this.query) params.set('q', this.query);
		else params.delete('q');
		goto(resolve(searchPath(params) as '/search'), { keepFocus: true, noScroll: true });
	}
}
