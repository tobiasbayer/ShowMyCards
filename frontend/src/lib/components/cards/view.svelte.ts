// The Cards page's view: one list over All cards (Scryfall) and the collection,
// built from the server load, with the scope, language and sort the URL holds,
// the checked tiles, the open card and paging.

import { browser } from '$app/env';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { page } from '$app/state';
import { SvelteSet } from 'svelte/reactivity';
import { searchApi, type InventoryCard, type StorageLocation } from '#lib';
import type { Currency } from '#lib/stores/currency.svelte.ts';
import { catalogSearch } from './catalog';
import { errorMessage } from './format';
import { ANY_LANGUAGE, languageParam } from './language';
import { live } from './live.svelte';
import { effectiveStacks, matchesLocation, ownedCount } from './owned';
import { orderCurrency, sortParam, type PriceSort } from './sort';
import { idsBetween, type LocationFilter } from './stacks';

export type Source = 'collection' | 'catalog';

/** Data the server load hands to the Cards page (see routes/cards/+page.server.ts). */
export interface CardsPageData {
	source: Source;
	query: string;
	/** The language picked in the dropdown (`?lang=`, a code or `any`); null = the scope's default. */
	language: string | null;
	/** The price sort picked in the menu (`?sort=`); null = the scope's default order. */
	sort: PriceSort | null;
	collection: InventoryCard[];
	/** `total` is Scryfall's match count for the query, not just the loaded pages. */
	catalog: { cards: InventoryCard[]; hasMore: boolean; total: number };
	error: string | null;
	/** A search the backend couldn't run; `code` picks the hint (see QueryErrorResponse). */
	queryError: QueryError | null;
}

export interface QueryError {
	message: string;
	code: string;
}

const STEP = 60;

/** The page's view state: source, query, location filter, language, selection, paging. */
export class CardsView {
	source = $state<Source>('collection');
	query = $state('');
	location = $state<LocationFilter>('all');
	/** The language picked in the dropdown; null shows every language. */
	readonly pickedLanguage: string | null;
	/** The price sort picked in the menu; null keeps the scope's default order. */
	readonly pickedSort: PriceSort | null;
	selected = $state<InventoryCard | null>(null);

	catalog = $state.raw<InventoryCard[]>([]);
	catalogPage = $state(1);
	hasMore = $state(false);
	catalogTotal = $state(0);
	loadingMore = $state(false);
	/** Why the last "load more" failed; loading stops until Retry. */
	loadMoreError = $state<string | null>(null);
	error = $state<string | null>(null);
	queryError = $state<QueryError | null>(null);
	visibleCount = $state(STEP);

	readonly collection: InventoryCard[];
	readonly locations: StorageLocation[];

	constructor(data: CardsPageData, locations: StorageLocation[]) {
		this.source = data.source;
		this.query = data.query;
		this.pickedLanguage = data.language;
		this.pickedSort = data.sort;
		this.collection = data.collection;
		this.catalog = data.catalog.cards;
		this.hasMore = data.catalog.hasMore;
		this.catalogTotal = data.catalog.total;
		this.error = data.error;
		this.queryError = data.queryError;
		this.locations = locations;
		// Fresh server data supersedes what earlier writes re-read. Module state is
		// shared by every request on the server, so it is only ever written in the browser.
		if (browser) live.reset();
		const loc = page.url.searchParams.get('location');
		if (loc === 'unassigned') this.location = 'unassigned';
		else if (loc && /^\d+$/.test(loc)) this.location = Number(loc);
	}

	/** The language the results are in: the pick, else every language. */
	get language(): string {
		return this.pickedLanguage ?? ANY_LANGUAGE;
	}

	/**
	 * The currency the results are ordered by when they are ordered by price (picked
	 * or typed in the search that ran), else null. Tiles show their price only then.
	 */
	get priceCurrency(): Currency | null {
		return orderCurrency(this.query, this.pickedSort);
	}

	/**
	 * Copies of this printing (anywhere in the collection) free for deck building:
	 * the most that can go into another deck without leaving any deck short. What
	 * a write re-read wins over what the card was loaded with.
	 */
	freeForDecks(card: InventoryCard): number {
		const availability = live.availability[card.oracle_id] ?? card.deck;
		return availability.printings?.[card.id] ?? 0;
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
			: this.hasMore && !this.loadingMore && this.loadMoreError === null
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

	toggleCheck(card: InventoryCard, range = false) {
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
			const data = await searchApi.cards({
				...catalogSearch(this.query, this.pickedLanguage, this.pickedSort),
				page: next
			});
			this.catalog = [...this.catalog, ...(data.data ?? [])];
			this.catalogPage = next;
			this.hasMore = data.has_more;
			this.catalogTotal = data.total_cards;
		} catch (e) {
			this.loadMoreError = `Couldn't load more cards: ${errorMessage(e)}`;
		} finally {
			this.loadingMore = false;
		}
	}

	/** Clears a failed "load more" and tries again. */
	retryLoadMore() {
		this.loadMoreError = null;
		this.loadMore();
	}

	select(card: InventoryCard) {
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

	/** Switches between My collection and All cards (clearing any location) and reruns `query`. */
	setSource(source: Source, query: string) {
		this.query = query;
		this.navigate(source, 'all');
	}

	/** Applies a storage location filter in My collection and reruns `query`. */
	setLocation(location: LocationFilter, query: string) {
		this.query = query;
		this.navigate('collection', location);
	}

	/** Applies a language from the dropdown and reruns `query` in the current scope. */
	setLanguage(language: string, query: string) {
		this.query = query;
		this.navigate(this.source, undefined, language);
	}

	/** Applies a sort from the menu (null = the scope's default) and reruns `query`. */
	setSort(sort: PriceSort | null, query: string) {
		this.query = query;
		this.navigate(this.source, undefined, this.pickedLanguage, sort);
	}

	/**
	 * Every search, scope, language and sort change goes through the server load. A
	 * picked language and a picked sort carry over to the other view (both views
	 * default to Any language, and every view can sort by price).
	 */
	navigate(
		source: Source,
		location?: LocationFilter,
		language = this.pickedLanguage,
		sort = this.pickedSort
	) {
		const params = this.#params();
		params.set('source', source);
		if (location === 'all') params.delete('location');
		else if (location !== undefined) params.set('location', String(location));
		if (this.query) params.set('q', this.query);
		else params.delete('q');
		const lang = languageParam(language);
		if (lang) params.set('lang', lang);
		else params.delete('lang');
		const sortValue = sortParam(sort);
		if (sortValue) params.set('sort', sortValue);
		else params.delete('sort');
		goto(resolve(`/cards?${params}`), { reset: false });
	}
}
