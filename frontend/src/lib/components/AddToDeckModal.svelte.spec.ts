import { page } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { notifications, type DeckAvailability, type DeckCardUsage, type DeckSummary } from '$lib';
import AddToDeckModal from './AddToDeckModal.svelte';

function deck(id: number, name: string): DeckSummary {
	return {
		id,
		name,
		description: '',
		created_at: '',
		updated_at: '',
		total_items: 0,
		total_cards_demand: 0,
		aggregate_shortfall: 0,
		aggregate_over_committed: 0
	};
}

const sol = { oracle_id: 'sol', scryfall_id: 'cmm-1', name: 'Sol Ring', copies: 1 };

let fetchSpy: MockInstance<typeof fetch>;

interface CopyInfo {
	availability: DeckAvailability;
	usage: DeckCardUsage[];
}

/**
 * Route the deck list (via the /api proxy), the add endpoint and, when given,
 * the card's availability and deck usage to canned responses.
 */
function mockBackend(decks: DeckSummary[], copyInfo?: CopyInfo) {
	fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
		const url = String(input);
		if (url.endsWith('/api/decks')) {
			return new Response(JSON.stringify(decks), { status: 200 });
		}
		if (/\/decks\/\d+\/items$/.test(url)) {
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		if (copyInfo && /\/api\/inventory\/availability\/[^/]+$/.test(url)) {
			return new Response(JSON.stringify(copyInfo.availability), { status: 200 });
		}
		if (copyInfo && /\/api\/decks\/for-card\/[^/]+$/.test(url)) {
			return new Response(JSON.stringify(copyInfo.usage), { status: 200 });
		}
		return new Response('not found', { status: 404 });
	});
}

function usage(deckId: number, deckName: string): DeckCardUsage {
	return {
		deck_id: deckId,
		deck_name: deckName,
		zone: 'main',
		desired_quantity: 1,
		scryfall_id: '',
		treatment: ''
	};
}

function requested(fragment: string) {
	return fetchSpy.mock.calls.some(([input]) => String(input).includes(fragment));
}

function postedItems() {
	const call = fetchSpy.mock.calls.find(([input]) => /\/decks\/\d+\/items$/.test(String(input)));
	if (!call) return undefined;
	return { url: String(call[0]), body: JSON.parse(String(call[1]?.body)) };
}

describe('AddToDeckModal', () => {
	beforeEach(() => localStorage.clear());
	afterEach(() => vi.restoreAllMocks());

	it('adds a single card to the chosen deck and zone', async () => {
		mockBackend([deck(7, 'Mono Red'), deck(9, 'Elves')]);
		const onAdded = vi.fn();
		const onClose = vi.fn();
		render(AddToDeckModal, { open: true, cards: [sol], onAdded, onClose });

		await page.getByLabelText('Deck', { exact: true }).selectOptions('9');
		await page.getByRole('radio', { name: 'Side' }).click();
		await page.getByLabelText('Quantity').fill('2');
		await page.getByRole('button', { name: 'Add to deck' }).click();

		await vi.waitFor(() => expect(onAdded).toHaveBeenCalledWith('Elves'));
		expect(onClose).toHaveBeenCalled();
		expect(postedItems()).toEqual({
			url: '/decks/9/items',
			body: {
				items: [
					{ oracle_id: 'sol', scryfall_id: '', treatment: '', desired_quantity: 2, zone: 'side' }
				]
			}
		});
	});

	it('preselects the last deck used', async () => {
		localStorage.setItem('smc-last-deck-id', '9');
		mockBackend([deck(7, 'Mono Red'), deck(9, 'Elves')]);
		render(AddToDeckModal, { open: true, cards: [sol], onClose: vi.fn() });

		await expect.element(page.getByLabelText('Deck', { exact: true })).toHaveValue('9');
	});

	it('offers a copies toggle in bulk mode and adds one of each', async () => {
		mockBackend([deck(7, 'Mono Red')]);
		const onAdded = vi.fn();
		render(AddToDeckModal, {
			open: true,
			bulk: true,
			cards: [
				{ ...sol, copies: 3 },
				{ oracle_id: 'bolt', scryfall_id: 'm10-1', name: 'Lightning Bolt', copies: 4 }
			],
			onAdded,
			onClose: vi.fn()
		});

		await expect.element(page.getByText('2 cards · 7 copies selected')).toBeInTheDocument();
		await expect.element(page.getByRole('radio', { name: 'All selected (7)' })).toBeChecked();
		await page.getByRole('radio', { name: '1 of each' }).click();
		await page.getByRole('button', { name: 'Add to deck' }).click();

		await vi.waitFor(() => expect(onAdded).toHaveBeenCalledWith('Mono Red'));
		const posted = postedItems();
		expect(posted?.url).toBe('/decks/7/items');
		expect(
			posted?.body.items.map((i: { oracle_id: string; desired_quantity: number }) => [
				i.oracle_id,
				i.desired_quantity
			])
		).toEqual([
			['sol', 1],
			['bolt', 1]
		]);
	});

	it('prompts to create a deck when there are none', async () => {
		mockBackend([]);
		render(AddToDeckModal, { open: true, cards: [sol], onClose: vi.fn() });

		await expect.element(page.getByText('You have no decks yet')).toBeInTheDocument();
		await expect.element(page.getByPlaceholder('New deck name')).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Add to deck' })).toBeDisabled();
	});
});

describe('AddToDeckModal shared-copy notice', () => {
	beforeEach(() => {
		localStorage.clear();
		notifications.clear();
	});
	afterEach(() => vi.restoreAllMocks());

	// One copy owned and already wanted by Mono Red (deck 7).
	const oneCopyInMonoRed: CopyInfo = {
		availability: { owned: 1, decked: 1, free: 0 },
		usage: [usage(7, 'Mono Red')]
	};
	const decks = [deck(7, 'Mono Red'), deck(9, 'Elves')];
	const notice = /You own 1 copy and 1 is already in Mono Red\./;

	it('warns when the only owned copy is already wanted by another deck', async () => {
		mockBackend(decks, oneCopyInMonoRed);
		render(AddToDeckModal, { open: true, cards: [sol], onClose: vi.fn() });

		await page.getByLabelText('Deck', { exact: true }).selectOptions('9');

		await expect.element(page.getByText(notice)).toBeInTheDocument();
	});

	it('does not warn when the chosen deck is the one that holds the card', async () => {
		mockBackend(decks, oneCopyInMonoRed);
		render(AddToDeckModal, { open: true, cards: [sol], onClose: vi.fn() });

		await page.getByLabelText('Deck', { exact: true }).selectOptions('9');
		await expect.element(page.getByText(notice)).toBeInTheDocument();

		await page.getByLabelText('Deck', { exact: true }).selectOptions('7');
		await expect.element(page.getByText(notice)).not.toBeInTheDocument();
	});

	it('does not warn for the maybe board, which commits no copies', async () => {
		mockBackend(decks, oneCopyInMonoRed);
		render(AddToDeckModal, { open: true, cards: [sol], onClose: vi.fn() });

		await page.getByLabelText('Deck', { exact: true }).selectOptions('9');
		await expect.element(page.getByText(notice)).toBeInTheDocument();

		await page.getByRole('radio', { name: 'Maybe' }).click();
		await expect.element(page.getByText(notice)).not.toBeInTheDocument();

		await page.getByRole('radio', { name: 'Main' }).click();
		await expect.element(page.getByText(notice)).toBeInTheDocument();
	});

	it('does not warn for a card the user does not own', async () => {
		mockBackend(decks, {
			availability: { owned: 0, decked: 0, free: 0 },
			usage: [usage(7, 'Mono Red')]
		});
		render(AddToDeckModal, { open: true, cards: [sol], onClose: vi.fn() });

		await page.getByLabelText('Deck', { exact: true }).selectOptions('9');
		await vi.waitFor(() => expect(requested('/for-card/')).toBe(true));

		await expect.element(page.getByText(/already in/)).not.toBeInTheDocument();
	});

	it('does not look anything up in bulk mode', async () => {
		mockBackend(decks, oneCopyInMonoRed);
		render(AddToDeckModal, {
			open: true,
			bulk: true,
			cards: [{ ...sol, copies: 3 }],
			onClose: vi.fn()
		});

		await expect.element(page.getByText('1 card · 3 copies selected')).toBeInTheDocument();
		expect(requested('/inventory/availability/')).toBe(false);
		expect(requested('/for-card/')).toBe(false);
	});

	it('still adds the card, with a warning toast naming the other deck', async () => {
		mockBackend(decks, oneCopyInMonoRed);
		const onAdded = vi.fn();
		render(AddToDeckModal, { open: true, cards: [sol], onAdded, onClose: vi.fn() });

		await page.getByLabelText('Deck', { exact: true }).selectOptions('9');
		await expect.element(page.getByText(notice)).toBeInTheDocument();
		await page.getByRole('button', { name: 'Add to deck' }).click();

		await vi.waitFor(() => expect(onAdded).toHaveBeenCalledWith('Elves'));
		const toast = notifications.notifications.at(-1);
		expect(toast?.type).toBe('warning');
		expect(toast?.message).toContain('Added Sol Ring to Elves (Main)');
		expect(toast?.message).toContain('also wanted by Mono Red');
	});

	it('shows a plain success toast when nothing is shared', async () => {
		mockBackend(decks, {
			availability: { owned: 2, decked: 1, free: 1 },
			usage: [usage(7, 'Mono Red')]
		});
		const onAdded = vi.fn();
		render(AddToDeckModal, { open: true, cards: [sol], onAdded, onClose: vi.fn() });

		await page.getByLabelText('Deck', { exact: true }).selectOptions('9');
		await vi.waitFor(() => expect(requested('/for-card/')).toBe(true));
		await page.getByRole('button', { name: 'Add to deck' }).click();

		await vi.waitFor(() => expect(onAdded).toHaveBeenCalledWith('Elves'));
		expect(notifications.notifications.at(-1)?.type).toBe('success');
	});
});
