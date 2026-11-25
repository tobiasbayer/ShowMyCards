import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Inventory, InventoryCard } from '#lib';
import Page from './+page.svelte';
import type { PageData } from './$types';

// #lib re-exports and Kit's runtime import refreshAll and afterNavigate from this module.
vi.mock('$app/navigation', () => ({ refreshAll: vi.fn(), afterNavigate: vi.fn() }));

function inventoryItem(id: number, overrides: Partial<Inventory> = {}): Inventory {
	return {
		id,
		created_at: '2026-10-08T10:00:00Z',
		updated_at: '2026-10-08T10:00:00Z',
		scryfall_id: 'printing-1',
		oracle_id: 'oracle-1',
		treatment: 'nonfoil',
		quantity: 1,
		...overrides
	};
}

function inventoryCard(
	id: string,
	items: Inventory[],
	overrides: Partial<InventoryCard> = {}
): InventoryCard {
	return {
		id,
		oracle_id: 'oracle-1',
		name: 'Lightning Bolt',
		set_name: 'Alpha',
		collector_number: '161',
		language: 'en',
		color_identity: ['R'],
		finishes: ['nonfoil', 'foil'],
		prices: { usd: '5.00', usd_foil: '10.00' },
		inventory: {
			this_printing: items,
			other_printings: [],
			total_quantity: items.reduce((total, item) => total + item.quantity, 0)
		},
		deck: { owned: 0, decked: 0, free: 0 },
		...overrides
	};
}

function makeLocation(
	id: number,
	name: string,
	sortOrder: number,
	storageType: 'Box' | 'Binder' = 'Box'
): NonNullable<Inventory['storage_location']> {
	return {
		BaseModel: {
			id,
			created_at: '2026-10-08T10:00:00Z',
			updated_at: '2026-10-08T10:00:00Z'
		},
		name,
		storage_type: storageType,
		sort_order: sortOrder
	};
}

function makeData(
	items: Inventory[],
	options: { card?: Partial<InventoryCard>; otherPrintings?: InventoryCard[] } = {}
): PageData {
	return {
		card: inventoryCard('card-1', items, options.card),
		otherPrintings: options.otherPrintings ?? [],
		deckUsage: []
	} as PageData;
}

describe('/cards/[id]/+page.svelte', () => {
	it('orders storage location badges by sort_order and omits unassigned rows', async () => {
		const items = [
			inventoryItem(1, { storage_location_id: undefined, quantity: 1 }),
			inventoryItem(2, {
				storage_location_id: 1,
				storage_location: makeLocation(1, 'Third Box', 30, 'Box'),
				treatment: 'nonfoil',
				quantity: 2
			}),
			inventoryItem(3, {
				storage_location_id: 2,
				storage_location: makeLocation(2, 'First Binder', 10, 'Binder'),
				treatment: 'foil',
				quantity: 1
			}),
			inventoryItem(4, {
				storage_location_id: 3,
				storage_location: makeLocation(3, 'Second Box', 20, 'Box'),
				treatment: 'nonfoil',
				quantity: 3
			})
		];

		await render(Page, { data: makeData(items) });

		const badges = page.getByRole('list', { name: 'Storage locations' }).getByRole('listitem');
		expect(badges.elements().map((el) => el.textContent?.trim())).toEqual([
			'First Binder (1x foil)',
			'Second Box (3x nonfoil)',
			'Third Box (2x nonfoil)'
		]);
	});

	it('breaks sort_order ties by locationId then treatment, consolidating duplicate rows', async () => {
		const loc5 = makeLocation(5, 'Box Five', 10);
		const loc2 = makeLocation(2, 'Box Two', 10);

		const items = [
			inventoryItem(1, {
				storage_location_id: 5,
				storage_location: loc5,
				treatment: 'nonfoil',
				quantity: 1
			}),
			inventoryItem(2, {
				storage_location_id: 2,
				storage_location: loc2,
				treatment: 'nonfoil',
				quantity: 2
			}),
			inventoryItem(3, {
				storage_location_id: 2,
				storage_location: loc2,
				treatment: '',
				quantity: 1
			}),
			inventoryItem(4, {
				storage_location_id: 2,
				storage_location: loc2,
				treatment: 'foil',
				quantity: 1
			})
		];

		await render(Page, { data: makeData(items) });

		const badges = page.getByRole('list', { name: 'Storage locations' }).getByRole('listitem');
		expect(badges.elements().map((el) => el.textContent?.trim())).toEqual([
			'Box Two (1x foil)',
			'Box Two (3x nonfoil)',
			'Box Five (1x nonfoil)'
		]);
	});

	it('renders clickable links for owned non-English printings with a language badge', async () => {
		const japaneseOwned = inventoryCard(
			'ja-1',
			[inventoryItem(10, { scryfall_id: 'ja-1', quantity: 2 })],
			{
				set_name: 'Born of the Gods',
				language: 'ja',
				printed_name: 'オレスコスの王、ブリマーズ'
			}
		);
		const englishUnowned = inventoryCard('en-2', [], {
			set_name: 'Masters 25',
			language: 'en'
		});

		await render(Page, {
			data: makeData([], { otherPrintings: [japaneseOwned, englishUnowned] })
		});

		const jaLink = page.getByRole('link', { name: /Born of the Gods/ });
		await expect.element(jaLink).toHaveAttribute('href', '/cards/ja-1');
		await expect.element(jaLink.getByText('2 owned')).toBeInTheDocument();
		await expect.element(jaLink.getByText('ja')).toBeInTheDocument();

		const enLink = page.getByRole('link', { name: /Masters 25/ });
		await expect.element(enLink).toHaveAttribute('href', '/cards/en-2');
		await expect.element(enLink.getByText('en')).not.toBeInTheDocument();
	});
});
