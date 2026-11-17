import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CardTile from './CardTile.svelte';
import { card, cardsView, row } from './test-fixtures';

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

describe('CardTile', () => {
	it('shows the copies owned and those free for decks, per printing', async () => {
		const bolt = card([row(1, 2, 1), row(2, 1, 2)], {
			owned: 3,
			free: 2,
			printings: { 'bolt-1': 2 }
		});
		await render(CardTile, { card: bolt, view: cardsView({ collection: [bolt] }) });

		await expect
			.element(page.getByRole('img', { name: '3 copies in your collection' }))
			.toHaveTextContent('3');
		await expect
			.element(page.getByRole('img', { name: 'Free for deck building (this printing): 2' }))
			.toBeInTheDocument();
	});

	it('counts only the copies in a location scope, and caps the free count by them', async () => {
		const bolt = card([row(1, 2, 1), row(2, 1, 2)], {
			owned: 3,
			free: 3,
			printings: { 'bolt-1': 3 }
		});
		const view = cardsView({ collection: [bolt] });
		view.location = 2;
		await render(CardTile, { card: bolt, view });

		await expect.element(page.getByRole('img', { name: '1 copy in Box B' })).toBeInTheDocument();
		await expect
			.element(page.getByRole('img', { name: 'Free for deck building (this printing): 1' }))
			.toBeInTheDocument();
	});

	it('marks a card in All cards whose other printing you own', async () => {
		const bolt = card(
			[],
			{},
			{
				inventory: {
					this_printing: [],
					other_printings: [row(5, 1, 1, 'nonfoil', 'bolt-2')],
					total_quantity: 1
				}
			}
		);
		await render(CardTile, { card: bolt, view: cardsView({ source: 'catalog', query: 'bolt' }) });

		await expect
			.element(page.getByRole('img', { name: 'You own another printing of this card' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('img', { name: /Free for deck building/ }))
			.not.toBeInTheDocument();
	});

	it('shows the price only while the results are ordered by price', async () => {
		const bolt = card();
		const { rerender } = await render(CardTile, {
			card: bolt,
			view: cardsView({
				source: 'catalog',
				query: 'bolt',
				sort: { currency: 'usd', direction: 'desc' }
			})
		});

		await expect.element(page.getByText('$1.50')).toBeInTheDocument();

		await rerender({ card: bolt, view: cardsView({ source: 'catalog', query: 'bolt' }) });
		await expect.element(page.getByText('$1.50')).not.toBeInTheDocument();
	});

	it('shows a dash when the order is by a price the card lacks', async () => {
		const bolt = card([], {}, { prices: {} });
		await render(CardTile, {
			card: bolt,
			view: cardsView({
				source: 'catalog',
				query: 'bolt',
				sort: { currency: 'eur', direction: 'asc' }
			})
		});

		await expect.element(page.getByTitle('No price known')).toHaveTextContent('—');
	});

	it('opens the panel on click, and toggles the check instead while selecting', async () => {
		const bolt = card([row(1, 1)]);
		const view = cardsView({ collection: [bolt] });
		await render(CardTile, { card: bolt, view });

		await page.getByRole('button', { name: 'Show details for Lightning Bolt' }).click();
		expect(view.selected?.id).toBe('bolt-1');

		await page.getByRole('checkbox', { name: 'Select Lightning Bolt' }).click();
		expect(view.checked.has('bolt-1')).toBe(true);
		await expect
			.element(page.getByRole('button', { name: 'Add Lightning Bolt to collection' }))
			.not.toBeInTheDocument();

		await page.getByRole('button', { name: 'Select Lightning Bolt' }).click();
		expect(view.checked.has('bolt-1')).toBe(false);
	});
});
