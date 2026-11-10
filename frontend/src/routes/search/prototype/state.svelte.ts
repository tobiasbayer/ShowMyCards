// PROTOTYPE, throwaway. Answers: "what should a unified, uncluttered Cards page
// (Collection + Catalog, detail panel, Add popover) look like?"
// State lives in memory only; nothing here writes to the backend.

import { goto, replaceState } from '$app/navigation';
import { resolve } from '$app/paths';
import { page } from '$app/state';
import type {
	DeckAvailability,
	EnhancedCardResult,
	EvaluateResponse,
	SearchResponse,
	StorageLocation
} from '$lib';

export type Source = 'collection' | 'catalog';
export type LocationFilter = 'all' | 'unassigned' | number;

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
}

/** Copies of one printing, in one finish, at one location. */
export interface Stack {
	finish: string;
	locationId: number | null;
	quantity: number;
}

const stackKey = (finish: string, locationId: number | null) => `${finish}|${locationId ?? 'none'}`;

function parseStackKey(key: string): { finish: string; locationId: number | null } {
	const [finish, loc] = key.split('|');
	return { finish, locationId: loc === 'none' ? null : Number(loc) };
}

/**
 * In-memory changes layered over server data. Module-level so it survives
 * source and variant switches; a full page reload resets it.
 */
class Changes {
	/** cardId -> stackKey -> quantity delta */
	byCard = $state<Record<string, Record<string, number>>>({});
	/** Cards added in this session that the server collection doesn't know yet. */
	added = $state<Record<string, EnhancedCardResult>>({});
	/** oracleId -> net copies added across all printings (deck availability is per card, not printing). */
	byOracle = $state<Record<string, number>>({});

	adjust(card: EnhancedCardResult, finish: string, locationId: number | null, n: number) {
		const forCard = (this.byCard[card.id] ??= {});
		const key = stackKey(finish, locationId);
		forCard[key] = (forCard[key] ?? 0) + n;
		this.byOracle[card.oracle_id] = (this.byOracle[card.oracle_id] ?? 0) + n;
		if (n > 0 && !this.added[card.id]) this.added[card.id] = card;
	}

	move(
		card: EnhancedCardResult,
		finish: string,
		from: number | null,
		to: number | null,
		n: number
	) {
		this.adjust(card, finish, from, -n);
		this.adjust(card, finish, to, n);
	}
}

export const changes = new Changes();

/** Open Add popovers; Esc closes a popover before it closes the detail panel. */
export const ui = $state({ openPopovers: 0 });

/** Server stacks for this printing merged with in-memory changes. */
export function effectiveStacks(card: EnhancedCardResult): Stack[] {
	const totals: Record<string, number> = {};
	for (const row of card.inventory.this_printing) {
		const key = stackKey(row.treatment || 'nonfoil', row.storage_location_id ?? null);
		totals[key] = (totals[key] ?? 0) + row.quantity;
	}
	for (const [key, n] of Object.entries(changes.byCard[card.id] ?? {})) {
		totals[key] = (totals[key] ?? 0) + n;
	}
	return Object.entries(totals)
		.filter(([, quantity]) => quantity > 0)
		.map(([key, quantity]) => ({ ...parseStackKey(key), quantity }));
}

export function matchesLocation(stack: Stack, filter: LocationFilter): boolean {
	if (filter === 'all') return true;
	if (filter === 'unassigned') return stack.locationId === null;
	return stack.locationId === filter;
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

/**
 * Where the sorting rules would put this card. Uses the same evaluate call as
 * RuleTester, so rules on fields CardResult lacks may resolve differently from
 * the real auto-sort (which reads the full local card JSON).
 */
export function resolveAuto(card: EnhancedCardResult, finish: string): Promise<number | null> {
	const key = `${card.id}|${finish}`;
	let pending = autoCache.get(key);
	if (!pending) {
		pending = fetch('/api/sorting-rules/evaluate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ card_data: card, treatment: finish })
		})
			.then((r) => (r.ok ? (r.json() as Promise<EvaluateResponse>) : null))
			.then((res) => (res?.matched ? (res.storage_location?.id ?? null) : null))
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
		this.locations = locations;
		this.availability = proto.availability;
		const loc = page.url.searchParams.get('location');
		if (loc === 'unassigned') this.location = 'unassigned';
		else if (loc && /^\d+$/.test(loc)) this.location = Number(loc);
	}

	/**
	 * Copies of this card free for deck building, across all printings, like the
	 * backend's allocation. In-session adds and removals shift `free` one for one;
	 * this overstates it only when the card is already over-committed to decks.
	 */
	forDecks(card: EnhancedCardResult): DeckAvailability {
		const base = this.availability[card.oracle_id];
		const delta = changes.byOracle[card.oracle_id] ?? 0;
		const owned = Math.max(0, (base?.owned ?? 0) + delta);
		const free = Math.min(owned, Math.max(0, (base?.free ?? 0) + delta));
		return { owned, decked: owned - free, free };
	}

	/** Collection printings matching name + location, newest first; in-session adds on top. */
	filteredCollection = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local lookup in derived computation
		const known = new Set(this.collection.map((c) => c.id));
		const fresh = Object.values(changes.added).filter((c) => !known.has(c.id));
		const needle = this.query.trim().toLowerCase();
		return [...fresh.reverse(), ...this.collection].filter(
			(card) =>
				(!needle || `${card.name} ${card.printed_name ?? ''}`.toLowerCase().includes(needle)) &&
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

	/** Collection filters live and only mirrors the URL (no reload). */
	setQuery(q: string) {
		this.query = q;
		if (this.source !== 'collection') return;
		this.visibleCount = STEP;
		const params = this.#params();
		if (q) params.set('q', q);
		else params.delete('q');
		replaceState(resolve(searchPath(params) as '/search'), page.state);
	}

	setLocation(filter: LocationFilter) {
		this.location = filter;
		this.visibleCount = STEP;
		const params = this.#params();
		if (filter === 'all') params.delete('location');
		else params.set('location', String(filter));
		replaceState(resolve(searchPath(params) as '/search'), page.state);
	}

	/** Source switches and catalog searches go through the server load. */
	navigate(source: Source) {
		const params = this.#params();
		params.set('source', source);
		if (this.query) params.set('q', this.query);
		else params.delete('q');
		goto(resolve(searchPath(params) as '/search'), { keepFocus: true, noScroll: true });
	}
}
