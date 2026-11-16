import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CardsHeader from './CardsHeader.svelte';
import { card, cardsView, row } from './test-fixtures';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	invalidate: vi.fn(),
	invalidateAll: vi.fn(),
	afterNavigate: vi.fn(),
	beforeNavigate: vi.fn(),
	onNavigate: vi.fn(),
	pushState: vi.fn(),
	replaceState: vi.fn()
}));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/cards') }, navigating: {} }));

afterEach(() => vi.restoreAllMocks());

describe('CardsHeader', () => {
	it('reruns the typed search in the scope picked', async () => {
		const view = cardsView();
		const setScope = vi.spyOn(view, 'setScope').mockImplementation(() => {});
		render(CardsHeader, { view });

		await page.getByRole('searchbox', { name: 'Search your cards' }).fill('t:dragon');
		await page.getByLabelText('Where to search: My collection').click();
		await page.getByRole('button', { name: 'Box B' }).click();

		expect(setScope).toHaveBeenCalledWith(2, 't:dragon');
	});

	it('disables the language menu while the search names a language', async () => {
		render(CardsHeader, { view: cardsView() });

		await page.getByRole('searchbox').fill('bolt l:ja');

		await expect
			.element(page.getByLabelText('Card language: Any language'))
			.toHaveAttribute('aria-disabled', 'true');
		await expect
			.element(page.getByTitle('The language in your search (l:ja) applies'))
			.toBeInTheDocument();
	});

	it("names the scope's default order in the sort menu", async () => {
		const { rerender } = render(CardsHeader, { view: cardsView() });
		await expect.element(page.getByLabelText('Sort order: Newest')).toBeInTheDocument();

		await rerender({ view: cardsView({ source: 'catalog', query: 'bolt' }) });
		await expect.element(page.getByLabelText('Sort order: Name')).toBeInTheDocument();
	});

	it('counts copies in the collection, with the printings in the tooltip', async () => {
		const bolt = card([row(1, 2), row(2, 1, 2)]);
		const other = card([row(3, 1)], {}, { id: 'bolt-2' });
		render(CardsHeader, { view: cardsView({ collection: [bolt, other] }) });

		await expect.element(page.getByTitle('4 copies in 2 printings')).toHaveTextContent('4 cards');
	});

	it('runs the search on Enter', async () => {
		const view = cardsView();
		const navigate = vi.spyOn(view, 'navigate').mockImplementation(() => {});
		render(CardsHeader, { view });

		await page.getByRole('searchbox').fill('c:r');
		await userEvent.keyboard('{Enter}');

		expect(view.query).toBe('c:r');
		expect(navigate).toHaveBeenCalledWith('collection');
	});
});
