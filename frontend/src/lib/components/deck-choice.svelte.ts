// The deck that cards are added to in the Add to deck dialog: one picked from
// the list, or a new deck being named, which is created when the cards are added.

import { decksApi, notifications, type DeckSummary } from '#lib';

// Remember the last deck used so repeat adds are a single click. Per-viewer
// convenience only, so storage failures (private mode etc.) are ignored.
const LAST_DECK_KEY = 'smc-last-deck-id';

function readLastDeck(): string {
	try {
		return localStorage.getItem(LAST_DECK_KEY) ?? '';
	} catch {
		return '';
	}
}

function rememberLastDeck(id: string) {
	try {
		localStorage.setItem(LAST_DECK_KEY, id);
	} catch {
		// ignore
	}
}

export class DeckChoice {
	decks = $state<DeckSummary[]>([]);
	loadState = $state<'loading' | 'ready' | 'error'>('loading');
	/** The picked deck's id; kept while "New" is open, for Cancel. */
	deckId = $state('');
	/** "New" is open: the deck being named is the target, never the picked one. */
	creating = $state(false);
	newName = $state('');
	/** The new deck is being created. */
	saving = $state(false);

	selected = $derived(this.decks.find((d) => String(d.id) === this.deckId));
	/** There is a deck to add to: a picked one, or a name for a new one. */
	hasTarget = $derived(this.creating ? !!this.newName.trim() && !this.saving : !!this.selected);
	/** The target deck's id; null for a deck still being named (it has no items yet). */
	targetId = $derived(this.creating ? null : this.selected?.id);

	/** Loads the decks and preselects the last one used, or the only one. */
	async load() {
		this.loadState = 'loading';
		try {
			this.decks = await decksApi.list();
			const last = readLastDeck();
			if (this.decks.some((d) => String(d.id) === last)) this.deckId = last;
			else if (this.decks.length === 1) this.deckId = String(this.decks[0].id);
			this.creating = this.decks.length === 0;
			this.loadState = 'ready';
		} catch {
			this.loadState = 'error';
		}
	}

	/** Creates the deck being named and picks it. Resolves to it, or undefined when that failed. */
	async create(): Promise<DeckSummary | undefined> {
		const name = this.newName.trim();
		if (!name || this.saving) return undefined;
		this.saving = true;
		try {
			const created = await decksApi.create({ name, description: '' });
			const summary: DeckSummary = {
				id: created.id,
				name: created.name,
				description: created.description ?? '',
				created_at: '',
				updated_at: '',
				total_items: 0,
				total_cards_demand: 0,
				aggregate_shortfall: 0,
				aggregate_over_committed: 0
			};
			this.decks = [summary, ...this.decks];
			this.deckId = String(created.id);
			this.creating = false;
			this.newName = '';
			return summary;
		} catch (e) {
			notifications.error(e instanceof Error ? e.message : 'Failed to create deck');
			return undefined;
		} finally {
			this.saving = false;
		}
	}

	/** The deck to add to: the picked one, or the one being named, created now. */
	target(): Promise<DeckSummary | undefined> {
		return this.creating ? this.create() : Promise.resolve(this.selected);
	}

	/** Preselects this deck next time. */
	remember(deck: DeckSummary) {
		rememberLastDeck(String(deck.id));
	}
}
