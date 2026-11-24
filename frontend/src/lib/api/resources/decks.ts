import { apiClient } from '../client';
import type {
	CreateDeckItemRequest,
	CreateDeckRequest,
	DeckCardUsage,
	DeckSummary,
	DeckZone
} from '#lib';

/** A deck as returned by create (BaseModel fields flattened at runtime). */
export interface CreatedDeck {
	id: number;
	name: string;
	description?: string;
}

/**
 * Decks API methods: reads and deck creation via the /api proxy, and adding
 * cards through the SvelteKit route `POST /decks/[id]/items`, which runs the
 * shared server-side upsert.
 */
export const decksApi = {
	/** List all decks with summary statistics. */
	list: () => apiClient.get<DeckSummary[]>('/decks'),

	/** Create a new deck. */
	create: (data: CreateDeckRequest) => apiClient.post<CreatedDeck>('/decks', data),

	/** Every deck item that uses a printing: any-printing items and items pinned to it. */
	forCard: (scryfallId: string) =>
		apiClient.get<DeckCardUsage[]>(`/decks/for-card/${encodeURIComponent(scryfallId)}`),

	/**
	 * Add cards to a deck; a card already in it gets its quantity raised. Throws
	 * with the route's message when that fails. Resolves to the zones the server
	 * stored the cards in: tokens and other extras always go to "other", whatever
	 * zone was asked for. Empty when the route doesn't say.
	 */
	addItems: async (deckId: number, items: CreateDeckItemRequest[]): Promise<DeckZone[]> => {
		const response = await fetch(`/decks/${deckId}/items`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ items })
		});
		const body = (await response.json().catch(() => ({}))) as {
			error?: string;
			zones?: unknown;
		};
		if (!response.ok) {
			throw new Error(body.error ?? 'Failed to add to deck');
		}
		return Array.isArray(body.zones) ? (body.zones as DeckZone[]) : [];
	}
};
