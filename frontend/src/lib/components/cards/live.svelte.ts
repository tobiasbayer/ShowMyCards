// Server data the Cards page re-read after its own writes, and the count of
// open menus and dialogs. Shared by the view, the write actions and the components.

import type { DeckAvailability, Inventory, InventoryCard } from '$lib';

/**
 * Server data re-read after this session's writes. It overrides the page's
 * loaded data; a new server load brings fresh data, so CardsView resets it.
 */
class Live {
	/** cardId -> the printing's inventory rows. */
	rows = $state<Record<string, Inventory[]>>({});
	/** oracleId -> copies owned / decked / free, and free per printing. */
	availability = $state<Record<string, DeckAvailability>>({});
	/** Cards that gained copies here, so My collection lists them before a reload. */
	owned = $state<Record<string, InventoryCard>>({});
	/** cardIds with a write in flight. */
	busy = $state<Record<string, boolean>>({});

	reset() {
		this.rows = {};
		this.availability = {};
		this.owned = {};
		this.busy = {};
	}
}

export const live = new Live();

/**
 * Open menus, popovers and dialogs: Esc closes them before it clears the
 * selection or closes the detail panel.
 */
export const ui = $state({ openPopovers: 0 });

/** Counts a menu while it is open; pass it as a Dropdown's `onOpenChange`. */
export function countOpen(open: boolean) {
	ui.openPopovers += open ? 1 : -1;
}
