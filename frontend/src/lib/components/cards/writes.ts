// The Cards page's writes. Single-card actions run one after another per card,
// bulk actions wait for those; afterwards the cards are re-read into `live`,
// which overrides the loaded data until the next server load.

import {
	inventoryApi,
	notifications,
	type EnhancedCardResult,
	type Inventory,
	type InventoryCard,
	type StorageLocation
} from '#lib';
import { errorMessage, plural } from './format';
import { live } from './live.svelte';
import { currentRows, locationName, scopeRows } from './owned';
import { pickRowToDecrement, rowsOfStack, type LocationFilter, type Stack } from './stacks';

/** Where an added copy goes: a location id, unassigned, or wherever the sorting rules say. */
export type Destination = number | 'unassigned' | 'auto';

/** Rows re-read per printing: far more than one printing's stacks ever need. */
const ROWS_PER_PRINTING = 100;

/** Re-reads one card's rows and its deck availability after a write. */
async function refresh(card: InventoryCard) {
	const [rows, availability] = await Promise.all([
		inventoryApi.list({ scryfall_id: card.id, page_size: ROWS_PER_PRINTING }),
		inventoryApi.availability(card.oracle_id)
	]);
	live.rows[card.id] = rows.data ?? [];
	live.availability[card.oracle_id] = availability;
	if (live.rows[card.id].some((r) => r.quantity > 0)) live.owned[card.id] = card;
}

const queues = new Map<string, Promise<unknown>>();

const copies = (n: number) => plural(n, 'copy', 'copies');
const sumQuantity = (rows: Inventory[]) => rows.reduce((sum, r) => sum + r.quantity, 0);

/**
 * Runs one write for a card after the previous one finished, so quick repeated
 * clicks can't race, then re-reads the card. A failed save is a toast and the
 * card is re-read to show what the database holds; a failed re-read after a
 * save is a warning, since the card then shows what it showed before.
 */
function enqueue<T>(card: InventoryCard, write: () => Promise<T>): Promise<T | undefined> {
	const run = (queues.get(card.id) ?? Promise.resolve()).then(async () => {
		live.busy[card.id] = true;
		try {
			let result: T;
			try {
				result = await write();
			} catch (e) {
				notifications.error(`Couldn't save: ${errorMessage(e)}`);
				// Best effort: the save error was already reported.
				await refresh(card).catch(() => undefined);
				return undefined;
			}
			try {
				await refresh(card);
			} catch (e) {
				notifications.warning(`Saved, but couldn't reload the card: ${errorMessage(e)}`);
			}
			return result;
		} finally {
			live.busy[card.id] = false;
		}
	});
	queues.set(card.id, run);
	return run;
}

function decrementRow(row: Inventory) {
	return row.quantity > 1
		? inventoryApi.update(row.id, { quantity: row.quantity - 1 })
		: inventoryApi.delete(row.id);
}

/** Adds one copy; it joins an existing stack at the destination. Resolves to the saved row. */
export function addCopy(
	card: InventoryCard,
	finish: string,
	destination: Destination
): Promise<Inventory | undefined> {
	return enqueue(card, () =>
		inventoryApi.create({
			scryfall_id: card.id,
			oracle_id: card.oracle_id,
			treatment: finish,
			quantity: 1,
			merge: true,
			...(destination === 'unassigned'
				? { unassigned: true }
				: destination === 'auto'
					? {}
					: { storage_location_id: destination })
		})
	);
}

/** Removes one copy from a stack. */
export function removeCopy(card: InventoryCard, stack: Stack) {
	return enqueue(card, async () => {
		const row = pickRowToDecrement(currentRows(card), stack);
		if (row) await decrementRow(row);
	});
}

/** Takes back one copy from the row an add returned. */
export function undoAdd(card: InventoryCard, added: Inventory) {
	return enqueue(card, async () => {
		const row = currentRows(card).find((r) => r.id === added.id);
		if (row && row.quantity > 0) await decrementRow(row);
	});
}

/** Moves every copy of a stack; the backend joins it with a stack already at the destination. */
export function moveStack(card: InventoryCard, stack: Stack, to: number | null) {
	return enqueue(card, async () => {
		const rows = rowsOfStack(currentRows(card), stack);
		if (rows.length === 0 || to === stack.locationId) return;
		await inventoryApi.splitMove(rows[0].id, sumQuantity(rows), to ?? undefined);
	});
}

/** After adding a card to a deck, re-read its availability (the deck badge). */
export function refreshCard(card: InventoryCard) {
	return enqueue(card, async () => {});
}

/** Ids per batch request: the backend's MaxBatchIDs (backend/api/constants.go). */
const BATCH_SIZE = 1000;
/** Cards re-read at once after a bulk write. */
const REFRESH_CONCURRENCY = 6;

function chunks<T>(items: T[]): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += BATCH_SIZE) out.push(items.slice(i, i + BATCH_SIZE));
	return out;
}

/**
 * Re-reads cards a few at a time; a card that fails keeps what it showed.
 * Resolves to the number of cards that couldn't be re-read.
 */
async function refreshAll(cards: InventoryCard[]): Promise<number> {
	let next = 0;
	let failed = 0;
	const worker = async () => {
		while (next < cards.length) {
			await refresh(cards[next++]).catch(() => failed++);
		}
	};
	await Promise.all(Array.from({ length: Math.min(REFRESH_CONCURRENCY, cards.length) }, worker));
	return failed;
}

/**
 * Runs one write over several cards once their queued single-card writes are
 * done, and makes later single-card writes wait for it. Afterwards it re-reads
 * every card, after a failure too, so what is shown matches the database.
 */
function bulk<T>(cards: InventoryCard[], write: () => Promise<T>): Promise<T | undefined> {
	const run = Promise.all(cards.map((c) => queues.get(c.id))).then(async () => {
		for (const c of cards) live.busy[c.id] = true;
		try {
			return await write();
		} catch (e) {
			notifications.error(`Couldn't save: ${errorMessage(e)}`);
			return undefined;
		} finally {
			const failed = await refreshAll(cards);
			if (failed > 0) {
				notifications.warning(
					`Couldn't reload ${plural(failed, 'card', 'cards')}; reload the page to see their copies`
				);
			}
			for (const c of cards) live.busy[c.id] = false;
		}
	});
	for (const c of cards) queues.set(c.id, run);
	return run;
}

/**
 * Moves the cards' copies in the scope to a location (null = unassigned).
 * Resolves to true once copies moved.
 */
export function moveCopies(
	cards: InventoryCard[],
	filter: LocationFilter,
	to: number | null,
	locations: StorageLocation[]
) {
	return bulk(cards, async () => {
		const rows = cards
			.flatMap((c) => scopeRows(c, filter))
			.filter((r) => (r.storage_location_id ?? null) !== to);
		const where = locationName(locations, to);
		if (rows.length === 0) {
			notifications.info(`Already in ${where}`);
			return false;
		}
		for (const ids of chunks(rows.map((r) => r.id))) {
			await inventoryApi.batchMove(ids, to ?? undefined);
		}
		notifications.success(`Moved ${copies(sumQuantity(rows))} to ${where}`);
		return true;
	});
}

/** Deletes the cards' copies in the scope. Resolves to true once copies are deleted. */
export function deleteCopies(cards: InventoryCard[], filter: LocationFilter) {
	return bulk(cards, async () => {
		const rows = cards.flatMap((c) => scopeRows(c, filter));
		if (rows.length === 0) return false;
		for (const ids of chunks(rows.map((r) => r.id))) await inventoryApi.batchDelete(ids);
		notifications.success(`Deleted ${copies(sumQuantity(rows))}`);
		return true;
	});
}

/**
 * Lets the sorting rules place the cards' copies in the scope again.
 * Resolves to true once the rules ran.
 */
export async function resortCopies(
	cards: InventoryCard[],
	filter: LocationFilter
): Promise<boolean> {
	let before: Inventory[] = [];
	const errors = await bulk(cards, async () => {
		before = cards.flatMap((c) => scopeRows(c, filter));
		// Never send an empty list: the backend re-sorts the whole collection then.
		if (before.length === 0) return undefined;
		let failed = 0;
		for (const ids of chunks(before.map((r) => r.id))) {
			failed += (await inventoryApi.resort(ids)).errors;
		}
		return failed;
	});
	if (errors === undefined) return false;

	// Re-sort keeps row ids, so the rows re-read by bulk() show which copies moved.
	const now = new Map(cards.flatMap((c) => currentRows(c)).map((r) => [r.id, r]));
	const moved = sumQuantity(
		before.filter(
			(r) => (now.get(r.id)?.storage_location_id ?? null) !== (r.storage_location_id ?? null)
		)
	);
	const result = moved === 0 ? 'Already sorted' : `Sorting rules moved ${copies(moved)}`;
	if (errors > 0) notifications.warning(`${result}; ${errors} couldn't be sorted`);
	else notifications.success(result);
	return true;
}

/** After adding cards to a deck, re-read them (the deck badges). */
export function refreshCards(cards: InventoryCard[]) {
	return bulk(cards, async () => {});
}

const autoCache = new Map<string, Promise<number | null>>();

/**
 * Where the sorting rules would put this card (null = unassigned), from the same
 * code the backend runs when it auto-sorts a new copy, so the preview matches the
 * real outcome. Rejects when the preview can't be loaded; a failure isn't cached.
 */
export function resolveAuto(card: EnhancedCardResult, finish: string): Promise<number | null> {
	const key = `${card.id}|${finish}`;
	let pending = autoCache.get(key);
	if (!pending) {
		pending = inventoryApi
			.autoLocation(card.id, finish)
			.then((res) => res.storage_location?.id ?? null);
		pending.catch(() => autoCache.delete(key));
		autoCache.set(key, pending);
	}
	return pending;
}
