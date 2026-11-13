package api

import (
	"errors"
	"log/slog"
	"runtime"
	"strconv"
	"sync"
	"time"

	"backend/cardquery"
	"backend/models"
	"backend/utils"

	"github.com/gofiber/fiber/v3"
	"gorm.io/gorm"
)

// CollectionSearchResponse lists every owned printing that matches a
// collection search, each once, with all of its inventory rows. There is no
// paging: a personal collection is small enough to return in one response.
// tygo:export
type CollectionSearchResponse struct {
	Data       []InventoryCard `json:"data"`
	TotalCards int             `json:"total_cards"`
}

// QueryErrorResponse explains why a search can't run: invalid syntax, an
// unknown or unsupported keyword, or (in All cards) a collection-only keyword.
// Code is one of "syntax", "unsupported", "unknown_keyword", "invalid_value"
// or "collection_only".
// tygo:export
type QueryErrorResponse struct {
	Error   string `json:"error"`
	Code    string `json:"code"`
	Keyword string `json:"keyword,omitempty"`
}

// cardsChunkSize bounds the IDs per card lookup, well below SQLite's
// variable limit.
const cardsChunkSize = 500

// SearchCollection evaluates a Scryfall-syntax query locally over the owned
// printings.
//
// Query params:
//   - q: the search; empty matches every owned printing.
//   - storage_location_id: a location ID, "null" for unassigned copies, or
//     absent for the whole collection. A printing is in scope when it has
//     copies there; finish: and qty count only those copies, but the result
//     carries all of the printing's rows.
//
// Results are newest first unless the query has order:.
func (h *InventoryHandler) SearchCollection(c fiber.Ctx) error {
	start := time.Now()
	q := c.Query("q")

	query, err := cardquery.Parse(q)
	if err != nil {
		var qerr *cardquery.Error
		if errors.As(err, &qerr) {
			return c.Status(fiber.StatusBadRequest).JSON(QueryErrorResponse{
				Error:   qerr.Message,
				Code:    qerr.Code,
				Keyword: qerr.Keyword,
			})
		}
		return utils.LogAndReturnError(c, fiber.StatusInternalServerError,
			"Failed to read the search", "query parse failed", err)
	}

	inScope, err := inventoryScope(c.Query("storage_location_id"))
	if err != nil {
		return utils.ReturnError(c, fiber.StatusBadRequest, err.Error())
	}

	ctx := c.RequestCtx()
	db := h.db.WithContext(ctx)

	var rows []models.Inventory
	if err := db.Preload("StorageLocation").Order("created_at DESC").Find(&rows).Error; err != nil {
		return utils.LogAndReturnError(c, fiber.StatusInternalServerError,
			"Failed to fetch inventory items", "database query failed", err)
	}

	// Group rows by printing, keeping the printings that have copies in scope.
	rowsByPrinting := make(map[string][]models.Inventory)
	var ids []string
	for _, row := range rows {
		rowsByPrinting[row.ScryfallID] = append(rowsByPrinting[row.ScryfallID], row)
	}
	seen := make(map[string]bool)
	for _, row := range rows {
		if inScope(row) && !seen[row.ScryfallID] {
			seen[row.ScryfallID] = true
			ids = append(ids, row.ScryfallID)
		}
	}

	cards, err := getCardsChunked(db, ids)
	if err != nil {
		return utils.LogAndReturnError(c, fiber.StatusInternalServerError,
			"Failed to fetch card data", "cards query failed", err)
	}

	availability, err := h.allocation.ComputeAvailability(ctx)
	if err != nil {
		return utils.LogAndReturnError(c, fiber.StatusInternalServerError,
			"Failed to compute deck availability", "allocation service failed", err)
	}

	// Decoding JSON dominates the cost, so it runs on every core.
	decoded := make([]*cardquery.Printing, len(ids))
	parallelFor(len(ids), func(i int) {
		id := ids[i]
		card, found := cards[id]
		if !found {
			return
		}
		qc, err := cardquery.Decode([]byte(card.RawJSON))
		if err != nil {
			slog.Warn("failed to decode card for search", "scryfall_id", id, "error", err)
			return
		}
		// The stored keys are authoritative for joining with the inventory.
		qc.ID, qc.OracleID = card.ScryfallID, card.OracleID
		p := &cardquery.Printing{Card: qc}
		for _, row := range rowsByPrinting[id] {
			if !inScope(row) {
				continue
			}
			p.Quantity += row.Quantity
			p.Finishes = append(p.Finishes, row.Treatment)
			if row.CreatedAt.After(p.AddedAt) {
				p.AddedAt = row.CreatedAt
			}
		}
		// Like the tile's deck badge: this printing's free copies, at most the copies in scope.
		p.Free = min(availability.PrintingFree(card.OracleID, id), p.Quantity)
		decoded[i] = p
	})
	printings := make([]*cardquery.Printing, 0, len(ids))
	for _, p := range decoded {
		if p != nil {
			printings = append(printings, p)
		}
	}
	fillEnglishPrices(db, printings)

	matches := make([]*cardquery.Printing, 0, len(printings))
	for _, p := range printings {
		if query.Match(p) {
			matches = append(matches, p)
		}
	}
	query.Sort(matches)

	built := make([]*InventoryCard, len(matches))
	parallelFor(len(matches), func(i int) {
		p := matches[i]
		card := cards[p.ID]
		scryfallCard, err := card.ToScryfallCard()
		if err != nil {
			slog.Warn("failed to unmarshal card", "scryfall_id", p.ID, "error", err)
			return
		}
		built[i] = &InventoryCard{
			EnhancedCardResult: buildEnhancedCardResult(scryfallCard, rowsByPrinting[p.ID]),
			Deck:               deckAvailability(availability, p.OracleID),
		}
	})
	results := make([]InventoryCard, 0, len(matches))
	for _, r := range built {
		if r != nil {
			results = append(results, *r)
		}
	}
	ptrs := make([]*CardResult, len(results))
	for i := range results {
		ptrs[i] = &results[i].CardResult
	}
	BackfillEnglishPrices(db, ptrs)

	slog.Debug("collection search", "component", "inventory", "query", q,
		"printings", len(printings), "matches", len(results), "duration", time.Since(start))

	return c.JSON(CollectionSearchResponse{Data: results, TotalCards: len(results)})
}

// parallelFor calls fn(0..n-1) spread over the available cores. fn must only
// write to its own index.
func parallelFor(n int, fn func(i int)) {
	workers := min(runtime.GOMAXPROCS(0), n)
	var wg sync.WaitGroup
	for w := range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := w; i < n; i += workers {
				fn(i)
			}
		}()
	}
	wg.Wait()
}

// inventoryScope turns storage_location_id into a row filter: "" is the
// whole collection, "null" the unassigned copies, a number one location.
func inventoryScope(locationID string) (func(models.Inventory) bool, error) {
	switch locationID {
	case "":
		return func(models.Inventory) bool { return true }, nil
	case "null":
		return func(row models.Inventory) bool { return row.StorageLocationID == nil }, nil
	}
	if err := utils.ValidateNumericParam(locationID, "storage_location_id"); err != nil {
		return nil, err
	}
	id, err := strconv.ParseUint(locationID, 10, 64)
	if err != nil {
		return nil, err
	}
	return func(row models.Inventory) bool {
		return row.StorageLocationID != nil && uint64(*row.StorageLocationID) == id
	}, nil
}

// getCardsChunked loads cards by Scryfall ID in chunks.
func getCardsChunked(db *gorm.DB, ids []string) (map[string]models.Card, error) {
	cards := make(map[string]models.Card, len(ids))
	for i := 0; i < len(ids); i += cardsChunkSize {
		chunk, err := models.GetCardsByIDs(db, ids[i:min(i+cardsChunkSize, len(ids))])
		if err != nil {
			return nil, err
		}
		for id, card := range chunk {
			cards[id] = card
		}
	}
	return cards, nil
}

// fillEnglishPrices gives localized printings without prices the prices of the
// English printing with the same set and collector number, as
// BackfillEnglishPrices does for display, so price searches see them too.
func fillEnglishPrices(db *gorm.DB, printings []*cardquery.Printing) {
	var keys []models.PrintKey
	for _, p := range printings {
		if needsEnglishPrices(p) {
			keys = append(keys, models.PrintKey{SetCode: p.Set, CollectorNumber: p.CollectorNumber})
		}
	}
	if len(keys) == 0 {
		return
	}
	pricesByPrint, err := models.GetEnglishPricesByPrint(db, keys)
	if err != nil {
		slog.Warn("english price fallback lookup failed", "component", "inventory", "error", err)
		return
	}
	for _, p := range printings {
		if !needsEnglishPrices(p) {
			continue
		}
		key := models.PrintKey{SetCode: p.Set, CollectorNumber: p.CollectorNumber}
		if pr, ok := pricesByPrint[key.String()]; ok {
			p.Prices = cardquery.PricesFrom(pr.USD, pr.USDFoil, pr.USDEtched, pr.EUR, pr.EURFoil, pr.Tix)
		}
	}
}

func needsEnglishPrices(p *cardquery.Printing) bool {
	return p.Lang != "en" && p.Prices == (cardquery.Prices{}) && p.Set != "" && p.CollectorNumber != ""
}
