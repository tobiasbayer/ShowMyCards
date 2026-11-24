import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CardsHeader from './CardsHeader.svelte';
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

afterEach(() => vi.restoreAllMocks());

describe('CardsHeader', () => {
	it('reruns the typed search in the storage location picked', async () => {
		const view = cardsView();
		const setLocation = vi.spyOn(view, 'setLocation').mockImplementation(() => {});
		await render(CardsHeader, { view });

		await page.getByRole('searchbox', { name: 'Search your collection' }).fill('t:dragon');
		await page.getByLabelText('Storage location: All locations').click();
		await page.getByRole('button', { name: 'Box B' }).click();

		expect(setLocation).toHaveBeenCalledWith(2, 't:dragon');
	});

	it('switches between My collection and All cards while keeping the typed search', async () => {
		const view = cardsView();
		const setSource = vi.spyOn(view, 'setSource').mockImplementation(() => {});
		await render(CardsHeader, { view });

		await page.getByRole('searchbox', { name: 'Search your collection' }).fill('sol ring');
		await page.getByRole('tab', { name: 'My collection' }).click();
		expect(setSource).not.toHaveBeenCalled();

		await page.getByRole('tab', { name: 'All cards' }).click();
		expect(setSource).toHaveBeenCalledWith('catalog', 'sol ring');
	});

	it('hides the location menu and updates the search box in All cards', async () => {
		const { rerender } = await render(CardsHeader, { view: cardsView() });
		await expect.element(page.getByLabelText('Storage location: All locations')).toBeVisible();
		await expect
			.element(page.getByRole('tab', { name: 'My collection' }))
			.toHaveAttribute('aria-selected', 'true');

		await rerender({ view: cardsView({ source: 'catalog' }) });
		await expect
			.element(page.getByLabelText('Storage location: All locations'))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByRole('tab', { name: 'All cards' }))
			.toHaveAttribute('aria-selected', 'true');
		await expect
			.element(page.getByRole('searchbox', { name: 'Search all cards on Scryfall' }))
			.toBeVisible();
	});

	it('disables the language menu while the search names a language', async () => {
		await render(CardsHeader, { view: cardsView() });

		await page.getByRole('searchbox').fill('bolt l:ja');

		await expect
			.element(page.getByLabelText('Card language: Any language'))
			.toHaveAttribute('aria-disabled', 'true');
		await expect
			.element(page.getByTitle('The language in your search (l:ja) applies'))
			.toBeInTheDocument();
	});

	it("names the scope's default order in the sort menu", async () => {
		const { rerender } = await render(CardsHeader, { view: cardsView() });
		await expect.element(page.getByLabelText('Sort order: Newest')).toBeInTheDocument();

		await rerender({ view: cardsView({ source: 'catalog', query: 'bolt' }) });
		await expect.element(page.getByLabelText('Sort order: Name')).toBeInTheDocument();
	});

	it('counts copies in the collection, with the printings in the tooltip', async () => {
		const bolt = card([row(1, 2), row(2, 1, 2)]);
		const other = card([row(3, 1)], {}, { id: 'bolt-2' });
		await render(CardsHeader, { view: cardsView({ collection: [bolt, other] }) });

		await expect.element(page.getByTitle('4 copies in 2 printings')).toHaveTextContent('4 cards');
	});

	it('runs the search on Enter', async () => {
		const view = cardsView();
		const navigate = vi.spyOn(view, 'navigate').mockImplementation(() => {});
		await render(CardsHeader, { view });

		await page.getByRole('searchbox').fill('c:r');
		await userEvent.keyboard('{Enter}');

		expect(view.query).toBe('c:r');
		expect(navigate).toHaveBeenCalledWith('collection');
	});
});
