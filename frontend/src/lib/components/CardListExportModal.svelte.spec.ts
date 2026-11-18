import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { CardListExport, CardListExportChoice } from '#lib/utils/card-list-export.ts';
import CardListExportModal from './CardListExportModal.svelte';

const all: CardListExport = {
	lines: [
		{ quantity: 1, name: 'Fire // Ice' },
		{ quantity: 4, name: 'Lightning Bolt' }
	],
	skipped: 0
};
const missing: CardListExport = { lines: [{ quantity: 2, name: 'Lightning Bolt' }], skipped: 0 };
const pinned: CardListExport = {
	lines: [
		{ quantity: 1, name: 'Dark Confidant', expansion: 'Modern Masters' },
		{ quantity: 2, name: 'Lightning Bolt' }
	],
	skipped: 0
};
const nothingMissing: CardListExport = { lines: [], skipped: 0 };

/** The deck and list pages' switch. */
function missingOrAll(missingCards: CardListExport, allCards = all): CardListExportChoice[] {
	return [
		{
			label: 'Only missing',
			export: missingCards,
			empty: 'Nothing missing: you have every card.'
		},
		{ label: 'All cards', export: allCards }
	];
}

function exported() {
	return page.getByRole('textbox', { name: 'Exported card list' });
}

describe('CardListExportModal', () => {
	afterEach(() => vi.restoreAllMocks());

	it('opens on the missing cards', async () => {
		await render(CardListExportModal, {
			open: true,
			onClose: () => {},
			choices: missingOrAll(missing)
		});

		await expect.element(page.getByRole('radio', { name: 'Only missing' })).toBeChecked();
		await expect.element(exported()).toHaveValue('2 Lightning Bolt');
		await expect.element(page.getByText('1 line · 2 cards.', { exact: false })).toBeVisible();
	});

	it('shows pinned expansions in Cardmarket syntax', async () => {
		await render(CardListExportModal, {
			open: true,
			onClose: () => {},
			choices: missingOrAll(pinned)
		});

		await expect
			.element(exported())
			.toHaveValue('1 Dark Confidant (Modern Masters)\n2 Lightning Bolt');
		await expect
			.element(page.getByText('Formatted for Cardmarket Wants lists', { exact: false }))
			.toBeVisible();
	});

	it('switches to every card', async () => {
		await render(CardListExportModal, {
			open: true,
			onClose: () => {},
			choices: missingOrAll(missing)
		});

		await page.getByRole('radio', { name: 'All cards' }).click();

		await expect.element(exported()).toHaveValue('1 Fire // Ice\n4 Lightning Bolt');
	});

	it('copies the shown text to the clipboard', async () => {
		const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
		await render(CardListExportModal, {
			open: true,
			onClose: () => {},
			choices: missingOrAll(missing)
		});

		await page.getByRole('button', { name: 'Copy' }).click();

		expect(writeText).toHaveBeenCalledWith('2 Lightning Bolt');
	});

	it('shows an empty state and disables Copy when nothing is missing', async () => {
		await render(CardListExportModal, {
			open: true,
			onClose: () => {},
			choices: missingOrAll(nothingMissing)
		});

		await expect.element(page.getByText('Nothing missing', { exact: false })).toBeVisible();
		await expect.element(exported()).not.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Copy' })).toBeDisabled();
	});

	it('says how many items were left out for missing card data', async () => {
		await render(CardListExportModal, {
			open: true,
			onClose: () => {},
			choices: missingOrAll({ ...missing, skipped: 2 })
		});

		await expect.element(page.getByText('2 items were left out', { exact: false })).toBeVisible();
	});

	it('reopens on the missing cards after closing', async () => {
		const onClose = vi.fn();
		const { rerender } = await render(CardListExportModal, {
			open: true,
			onClose,
			choices: missingOrAll(missing)
		});

		await page.getByRole('radio', { name: 'All cards' }).click();
		await userEvent.click(page.getByRole('button', { name: 'Close', exact: true }));
		expect(onClose).toHaveBeenCalled();

		await rerender({ open: false });
		await rerender({ open: true });

		await expect.element(page.getByRole('radio', { name: 'Only missing' })).toBeChecked();
		await expect.element(exported()).toHaveValue('2 Lightning Bolt');
	});

	it('hides the switch when there is only one choice', async () => {
		await render(CardListExportModal, {
			open: true,
			onClose: () => {},
			choices: [{ label: 'All cards', export: all }]
		});

		await expect.element(exported()).toHaveValue('1 Fire // Ice\n4 Lightning Bolt');
		await expect.element(page.getByRole('radio')).not.toBeInTheDocument();
	});

	it('mentions expansion fallbacks only when a line names an expansion', async () => {
		await render(CardListExportModal, {
			open: true,
			onClose: () => {},
			choices: missingOrAll(missing)
		});

		await expect.element(exported()).toBeVisible();
		await expect
			.element(page.getByText('Expansions Cardmarket names differently', { exact: false }))
			.not.toBeInTheDocument();
	});

	it('offers no Pin printings checkbox unless asked to', async () => {
		await render(CardListExportModal, {
			open: true,
			onClose: () => {},
			choices: missingOrAll(pinned)
		});

		await expect.element(exported()).toBeVisible();
		await expect.element(page.getByRole('checkbox')).not.toBeInTheDocument();
	});

	describe('for selected printings', () => {
		const printings: CardListExport = {
			lines: [
				{ quantity: 1, name: 'Lightning Bolt', expansion: 'Double Masters' },
				{ quantity: 2, name: 'Lightning Bolt', expansion: 'Magic 2011' }
			],
			skipped: 0
		};

		it('pins printings by default and merges them by name when unpinned', async () => {
			await render(CardListExportModal, {
				open: true,
				onClose: () => {},
				choices: [{ label: '1 of each', export: printings }],
				pinnable: true
			});

			const pin = page.getByRole('checkbox', { name: 'Pin printings' });
			await expect.element(pin).toBeChecked();
			await expect
				.element(exported())
				.toHaveValue('1 Lightning Bolt (Double Masters)\n2 Lightning Bolt (Magic 2011)');

			await pin.click();

			await expect.element(exported()).toHaveValue('3 Lightning Bolt');
			await expect
				.element(page.getByText('Expansions Cardmarket names differently', { exact: false }))
				.not.toBeInTheDocument();
		});

		it('reopens pinned after closing', async () => {
			const { rerender } = await render(CardListExportModal, {
				open: true,
				onClose: () => {},
				choices: [{ label: '1 of each', export: printings }],
				pinnable: true
			});

			await page.getByRole('checkbox', { name: 'Pin printings' }).click();
			await userEvent.click(page.getByRole('button', { name: 'Close', exact: true }));
			await rerender({ open: false });
			await rerender({ open: true });

			await expect.element(page.getByRole('checkbox', { name: 'Pin printings' })).toBeChecked();
		});
	});
});
