import { apiClient } from '../client';
import type { DeckAvailability, Inventory, StorageLocation } from '$lib';
import type {
	BatchMoveRequest,
	CreateInventoryRequest,
	BatchMoveResponse,
	BatchDeleteRequest,
	BatchDeleteResponse,
	ResortRequest,
	ResortResponse,
	SplitMoveRequest,
	SplitMoveResponse
} from '$lib/types/api';

/**
 * Where the sorting rules would put a new copy (the backend's AutoLocationResponse,
 * whose generated type leaves the location untyped); null when no rule matches.
 */
export interface AutoLocation {
	storage_location: StorageLocation | null;
}

/**
 * Request type for updating inventory
 */
export interface UpdateInventoryRequest {
	treatment?: string;
	quantity?: number;
	storage_location_id?: number;
	clear_storage?: boolean;
}

/**
 * Query parameters for listing inventory
 */
export interface ListInventoryParams {
	scryfall_id?: string;
	storage_location_id?: string | number; // Can be "null" for unassigned
	page_size?: number;
}

/**
 * A page of inventory rows (the backend's utils.PaginatedResponse)
 */
export interface PaginatedInventoryResponse {
	data: Inventory[] | null;
	page: number;
	page_size: number;
	total_items: number;
	total_pages: number;
}

/**
 * Inventory API methods
 *
 * Provides type-safe access to inventory endpoints.
 *
 * @example
 * ```ts
 * import { inventoryApi } from '$lib/api';
 *
 * // List all inventory items
 * const items = await inventoryApi.list();
 *
 * // Get unassigned items
 * const unassigned = await inventoryApi.list({ storage_location_id: 'null' });
 *
 * // Create inventory
 * const item = await inventoryApi.create({
 *   scryfall_id: 'abc123',
 *   treatment: 'Foil',
 *   quantity: 1
 * });
 * ```
 */
export const inventoryApi = {
	/**
	 * List inventory items with optional filters
	 */
	list: (params?: ListInventoryParams) => {
		const searchParams = new URLSearchParams();
		if (params?.scryfall_id) searchParams.set('scryfall_id', params.scryfall_id);
		if (params?.storage_location_id !== undefined)
			searchParams.set('storage_location_id', String(params.storage_location_id));
		if (params?.page_size) searchParams.set('page_size', String(params.page_size));

		const query = searchParams.toString();
		return apiClient.get<PaginatedInventoryResponse>(`/inventory${query ? `?${query}` : ''}`);
	},

	/**
	 * Get a single inventory item by ID
	 */
	get: (id: number) => apiClient.get<Inventory>(`/inventory/${id}`),

	/**
	 * Owned, decked and free copies of a card across all its printings, as seen by
	 * the deck allocation service.
	 */
	availability: (oracleId: string) =>
		apiClient.get<DeckAvailability>(`/inventory/availability/${encodeURIComponent(oracleId)}`),

	/**
	 * Where the sorting rules would put a new copy of a printing in a finish: the
	 * same code the backend runs when it auto-sorts one.
	 */
	autoLocation: (scryfallId: string, treatment: string) =>
		apiClient.get<AutoLocation>(
			`/inventory/auto-location?${new URLSearchParams({ scryfall_id: scryfallId, treatment })}`
		),

	/**
	 * Create a new inventory item. With `merge`, the copies join an existing stack
	 * at the resolved location (the response is that stack).
	 */
	create: (data: CreateInventoryRequest) => apiClient.post<Inventory>('/inventory', data),

	/**
	 * Update an inventory item
	 */
	update: (id: number, data: UpdateInventoryRequest) =>
		apiClient.put<Inventory>(`/inventory/${id}`, data),

	/**
	 * Delete an inventory item
	 */
	delete: (id: number) => apiClient.delete<void>(`/inventory/${id}`),

	/**
	 * Move multiple inventory items to a new storage location
	 */
	batchMove: (ids: number[], storageLocationId?: number) =>
		apiClient.post<BatchMoveResponse>('/inventory/batch/move', {
			ids,
			storage_location_id: storageLocationId
		} as BatchMoveRequest),

	/**
	 * Move a partial quantity of a single inventory stack to another storage location.
	 * Omit storageLocationId to move the copies to the unassigned pool.
	 */
	splitMove: (id: number, quantity: number, storageLocationId?: number) =>
		apiClient.post<SplitMoveResponse>(`/inventory/${id}/split-move`, {
			quantity,
			storage_location_id: storageLocationId
		} as SplitMoveRequest),

	/**
	 * Delete multiple inventory items
	 */
	batchDelete: (ids: number[]) =>
		apiClient.delete<BatchDeleteResponse>('/inventory/batch', { ids } as BatchDeleteRequest),

	/**
	 * Re-evaluate inventory items against sorting rules
	 * If no ids provided, re-evaluates all items
	 */
	resort: (ids?: number[]) =>
		apiClient.post<ResortResponse>('/inventory/resort', { ids } as ResortRequest)
};
