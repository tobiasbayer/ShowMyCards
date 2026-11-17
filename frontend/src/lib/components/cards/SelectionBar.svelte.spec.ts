import { page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SelectionBar from './SelectionBar.svelte';
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

describe('SelectionBar', () => {
	it('offers only Add to deck for cards you own no copies of', async () => {
		const unowned = card();
		const view = cardsView({
			source: 'catalog',
			query: 'bolt',
			catalog: { cards: [unowned], hasMore: false, total: 1 }
		});
		view.toggleCheck(unowned);
		await render(SelectionBar, { view });

		await expect
			.element(page.getByRole('button', { name: 'Add selected cards to a deck' }))
			.toBeEnabled();
		await expect
			.element(page.getByRole('button', { name: 'Re-sort selected copies with the sorting rules' }))
			.toBeDisabled();
		await expect
			.element(page.getByRole('button', { name: 'Delete selected copies' }))
			.toBeDisabled();
		await expect
			.element(page.getByLabelText('Move selected copies'))
			.toHaveAttribute('aria-disabled', 'true');
	});

	it('names the copies and the scope before deleting', async () => {
		const bolt = card([row(1, 2, 1), row(2, 3, 2)]);
		const view = cardsView({ collection: [bolt] });
		view.location = 1;
		view.toggleCheck(bolt);
		await render(SelectionBar, { view });

		await page.getByRole('button', { name: 'Delete selected copies' }).click();

		await expect
			.element(
				page.getByText("Delete 2 copies of Lightning Bolt from Box A? This can't be undone.")
			)
			.toBeInTheDocument();
	});

	it('counts the selection in printings and copies', async () => {
		const bolt = card([row(1, 2)]);
		const view = cardsView({ collection: [bolt] });
		view.toggleCheck(bolt);
		await render(SelectionBar, { view });

		await expect
			.element(page.getByTitle('1 printing · 2 copies'))
			.toMatchTextContent(/^1\s+selected$/);
	});
});
