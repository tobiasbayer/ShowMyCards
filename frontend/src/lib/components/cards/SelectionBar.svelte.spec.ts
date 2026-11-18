import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SelectionBar from './SelectionBar.svelte';
import { ui } from './live.svelte';
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

	it('exports the copies in scope with their expansion, or 1 of each', async () => {
		const bolt = card([row(1, 2, 1), row(2, 3, 2)]);
		const fireIce = card(
			[row(3, 1, 1, 'foil', 'fire-1')],
			{},
			{
				id: 'fire-1',
				oracle_id: 'fire',
				name: 'Fire // Ice',
				printed_name: 'Feuer // Eis',
				set_name: 'Apocalypse'
			}
		);
		const view = cardsView({ collection: [bolt, fireIce] });
		view.location = 1;
		view.checkAll();
		await render(SelectionBar, { view });

		await page.getByRole('button', { name: 'Export selected cards' }).click();

		const exported = page.getByRole('textbox', { name: 'Exported card list' });
		await expect.element(page.getByRole('radio', { name: 'All selected (3)' })).toBeChecked();
		await expect.element(page.getByRole('checkbox', { name: 'Pin printings' })).toBeChecked();
		await expect
			.element(exported)
			.toHaveValue('1 Fire // Ice (Apocalypse)\n2 Lightning Bolt (Magic 2011)');

		await page.getByRole('radio', { name: '1 of each' }).click();

		await expect
			.element(exported)
			.toHaveValue('1 Fire // Ice (Apocalypse)\n1 Lightning Bolt (Magic 2011)');
	});

	it('exports 1 of each in All cards, unowned cards included', async () => {
		const unowned = card();
		const view = cardsView({
			source: 'catalog',
			query: 'bolt',
			catalog: { cards: [unowned], hasMore: false, total: 1 }
		});
		view.toggleCheck(unowned);
		await render(SelectionBar, { view });

		await page.getByRole('button', { name: 'Export selected cards' }).click();

		await expect
			.element(page.getByRole('textbox', { name: 'Exported card list' }))
			.toHaveValue('1 Lightning Bolt (Magic 2011)');
		await expect.element(page.getByRole('radio')).not.toBeInTheDocument();
	});

	it('closes the export dialog on Esc, which the page then leaves to the dialog', async () => {
		const bolt = card([row(1, 2)]);
		const view = cardsView({ collection: [bolt] });
		view.toggleCheck(bolt);
		const before = ui.openPopovers;
		await render(SelectionBar, { view });

		await page.getByRole('button', { name: 'Export selected cards' }).click();
		const exported = page.getByRole('textbox', { name: 'Exported card list' });
		await expect.element(exported).toBeVisible();
		// The page clears the selection on Esc only while no popover is open.
		await expect.poll(() => ui.openPopovers).toBe(before + 1);

		await userEvent.keyboard('{Escape}');

		await expect.element(exported).not.toBeInTheDocument();
		await expect.poll(() => ui.openPopovers).toBe(before);
		expect(view.selecting).toBe(true);
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
