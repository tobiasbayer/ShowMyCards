import type { RuntimeStorageLocation as StorageLocation } from '#lib/types/runtime.ts';
import type { CardPrices } from '#lib/types/api.ts';

// Re-export for convenience
export type { StorageLocation };

/**
 * View modes supported by the collection
 */
export type ViewMode = 'grid' | 'table';

/**
 * Source type discriminator for DisplayableCard
 */
export type CardSourceType = 'inventory' | 'search' | 'list';

/**
 * Common interface for displayable card items
 * Normalizes different data sources (inventory, search, list) into a single format
 */
export interface DisplayableCard {
	/** Unique identifier for the item (inventory.id, listItem.id, scryfall_id) */
	id: string | number;
	/** Scryfall ID for card image and details */
	scryfallId: string;
	/** Oracle ID for grouping printings */
	oracleId: string;
	/** Card name */
	name: string;
	/** Set name */
	setName?: string;
	/** Set code */
	setCode?: string;
	/** Collector number */
	collectorNumber?: string;
	/** Card rarity */
	rarity?: string;
	/** Card image URL */
	imageUri?: string;
	/** Card treatment (foil, nonfoil, etched) */
	treatment: string;
	/** Available finishes for this card */
	finishes: string[];
	/** Frame effects for treatment display */
	frameEffects?: string[];
	/** Quantity (meaning varies by context) */
	quantity: number;
	/** Secondary quantity (for lists: desired vs collected) */
	secondaryQuantity?: number;
	/** Price information */
	prices?: CardPrices;
	/** Storage location (for inventory items) */
	storageLocation?: StorageLocation;
	/** Raw source data for context-specific rendering */
	_source: unknown;
	/** Source type discriminator */
	_sourceType: CardSourceType;
}

/**
 * Context type for child components
 */
export interface CardCollectionContext {
	viewMode: ViewMode;
	selectable: boolean;
	storageLocations: StorageLocation[];
	onItemRemove?: (itemId: string | number) => void;
}
