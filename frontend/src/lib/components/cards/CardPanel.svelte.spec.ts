import { page } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { DeckCardUsage } from '#lib';
import CardPanel from './CardPanel.svelte';
import { live } from './live.svelte';
import { card, cardsView, fakeBackend, row, type FakeBackend } from './test-fixtures';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	invalidate: vi.fn(),
	refreshAll: vi.fn(),
	afterNavigate: vi.fn(),
	beforeNavigate: vi.fn(),
	onNavigate: vi.fn(),
	pushState: vi.fn(),
	replaceState: vi.fn()
}));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/cards') }, navigating: {} }));

const inBurn: DeckCardUsage = {
	deck_id: 3,
	deck_name: 'Burn',
	zone: 'main',
	desired_quantity: 4,
	scryfall_id: '',
	treatment: ''
};

let backend: FakeBackend;

beforeEach(() => {
	live.reset();
	backend = fakeBackend();
});

afterEach(() => vi.restoreAllMocks());

describe('CardPanel', () => {
	it('lists your copies, the decks and the other printings', async () => {
		backend.decks = [inBurn];
		backend.search = [
			card(),
			card([], {}, { id: 'bolt-2', set_name: 'Alpha', collector_number: '161' })
		];
		const bolt = card([row(1, 2, 1, 'foil')]);
		await render(CardPanel, { card: bolt, view: cardsView({ collection: [bolt] }) });

		await expect.element(page.getByText('Box A')).toBeInTheDocument();
		await expect.element(page.getByRole('link', { name: 'Burn' })).toBeInTheDocument();
		// The opened printing isn't among the others.
		await expect.element(page.getByTitle('Alpha · #161')).toBeInTheDocument();
		await expect.element(page.getByTitle('Magic 2011 · #149')).not.toBeInTheDocument();
	});

	it('hides sections with nothing in them', async () => {
		// Its own card: other printings are cached per card for the session.
		const opt = card([], {}, { id: 'opt-1', oracle_id: 'opt', name: 'Opt' });
		await render(CardPanel, { card: opt, view: cardsView() });

		await expect.element(page.getByText('None yet')).toBeInTheDocument();
		// No deck wants it: "In decks" is just the link to add it to one.
		await expect.element(page.getByRole('button', { name: 'Add to deck' })).toBeInTheDocument();
		await vi.waitFor(() =>
			expect(backend.requests().some((r) => r.startsWith('GET /api/search'))).toBe(true)
		);
		await expect.element(page.getByText('Other printings')).not.toBeInTheDocument();
	});

	it('tells a failed load from an empty one, and retries', async () => {
		backend.failing = ['GET /api/decks/for-card/'];
		backend.decks = [inBurn];
		await render(CardPanel, { card: card(), view: cardsView() });

		await expect.element(page.getByText(/Couldn't load its decks\./)).toBeInTheDocument();

		backend.failing = [];
		await page.getByRole('button', { name: 'Retry' }).click();
		await expect.element(page.getByRole('link', { name: 'Burn' })).toBeInTheDocument();
	});

	it('shows the card text in its own language', async () => {
		const german = card(
			[],
			{},
			{
				language: 'de',
				printed_name: 'Blitzschlag',
				oracle_text: 'Lightning Bolt deals 3 damage to any target.',
				printed_text: 'Der Blitzschlag fügt einem Ziel deiner Wahl 3 Schadenspunkte zu.'
			}
		);
		await render(CardPanel, { card: german, view: cardsView() });

		await expect.element(page.getByRole('heading', { name: 'Blitzschlag' })).toBeInTheDocument();
		await expect.element(page.getByText(/3 Schadenspunkte/)).toBeInTheDocument();
		await expect.element(page.getByText(/deals 3 damage/)).not.toBeInTheDocument();
	});
});
