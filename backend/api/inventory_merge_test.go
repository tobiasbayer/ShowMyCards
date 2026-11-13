package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"backend/models"

	"github.com/gofiber/fiber/v3"
	"gorm.io/gorm"
)

// Tests for the Create flags `merge` and `unassigned`, and for the
// auto-location preview and per-card availability endpoints.

func createStackRow(t *testing.T, db *gorm.DB, scryfallID, treatment string, quantity int, locationID *uint) models.Inventory {
	t.Helper()
	row := models.Inventory{
		ScryfallID:        scryfallID,
		OracleID:          "oracle-" + scryfallID,
		Treatment:         treatment,
		Quantity:          quantity,
		StorageLocationID: locationID,
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatalf("failed to create inventory row: %v", err)
	}
	return row
}

// postInventory sends a create request and decodes the returned item.
func postInventory(t *testing.T, app *fiber.App, body string) (int, models.Inventory) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/inventory", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	var item models.Inventory
	if resp.StatusCode < 300 {
		if err := json.NewDecoder(resp.Body).Decode(&item); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
	}
	return resp.StatusCode, item
}

func getJSON(t *testing.T, app *fiber.App, url string, out any) int {
	t.Helper()
	resp, err := app.Test(httptest.NewRequest(http.MethodGet, url, nil))
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusOK && out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
	}
	return resp.StatusCode
}

func countStackRows(t *testing.T, db *gorm.DB, scryfallID, treatment string, locationID *uint) int64 {
	t.Helper()
	query := db.Model(&models.Inventory{}).Where("scryfall_id = ? AND treatment = ?", scryfallID, treatment)
	if locationID == nil {
		query = query.Where("storage_location_id IS NULL")
	} else {
		query = query.Where("storage_location_id = ?", *locationID)
	}
	var n int64
	if err := query.Count(&n).Error; err != nil {
		t.Fatalf("count failed: %v", err)
	}
	return n
}

func TestInventoryCreate_Merge_IncrementsOldestStackRow(t *testing.T) {
	app, db := setupInventoryTestApp(t)
	box := createTestStorageLocation(t, db)
	oldest := createStackRow(t, db, "card-a", "nonfoil", 2, &box.ID)
	createStackRow(t, db, "card-a", "nonfoil", 1, &box.ID)

	status, item := postInventory(t, app, fmt.Sprintf(
		`{"scryfall_id":"card-a","oracle_id":"oracle-card-a","treatment":"nonfoil","quantity":1,"storage_location_id":%d,"merge":true}`, box.ID))

	if status != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, status)
	}
	if item.ID != oldest.ID {
		t.Errorf("expected the oldest row %d to be returned, got %d", oldest.ID, item.ID)
	}
	if item.Quantity != 3 {
		t.Errorf("expected quantity 3, got %d", item.Quantity)
	}
	if item.StorageLocation == nil || item.StorageLocation.ID != box.ID {
		t.Errorf("expected the storage location to be preloaded, got %+v", item.StorageLocation)
	}
	if n := countStackRows(t, db, "card-a", "nonfoil", &box.ID); n != 2 {
		t.Errorf("expected no new row (2 rows), got %d", n)
	}
}

func TestInventoryCreate_Merge_InsertsWhenStackDiffers(t *testing.T) {
	app, db := setupInventoryTestApp(t)
	box := createTestStorageLocation(t, db)
	createStackRow(t, db, "card-a", "nonfoil", 1, &box.ID)
	createStackRow(t, db, "card-a", "foil", 1, nil)

	tests := []struct {
		name      string
		body      string
		treatment string
		location  *uint
	}{
		{
			name:      "other finish at the same location",
			body:      fmt.Sprintf(`{"scryfall_id":"card-a","oracle_id":"oracle-card-a","treatment":"foil","storage_location_id":%d,"merge":true}`, box.ID),
			treatment: "foil",
			location:  &box.ID,
		},
		{
			name:      "same finish but unassigned",
			body:      `{"scryfall_id":"card-a","oracle_id":"oracle-card-a","treatment":"nonfoil","unassigned":true,"merge":true}`,
			treatment: "nonfoil",
			location:  nil,
		},
		{
			name:      "other printing",
			body:      fmt.Sprintf(`{"scryfall_id":"card-b","oracle_id":"oracle-card-a","treatment":"nonfoil","storage_location_id":%d,"merge":true}`, box.ID),
			treatment: "nonfoil",
			location:  &box.ID,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, item := postInventory(t, app, tt.body)
			if status != http.StatusCreated {
				t.Fatalf("expected status %d, got %d", http.StatusCreated, status)
			}
			if item.Quantity != 1 || item.Treatment != tt.treatment {
				t.Errorf("expected a new row with quantity 1 and treatment %q, got %+v", tt.treatment, item)
			}
			if (tt.location == nil) != (item.StorageLocationID == nil) {
				t.Errorf("expected location %v, got %v", tt.location, item.StorageLocationID)
			}
		})
	}
}

func TestInventoryCreate_Merge_UnassignedStack(t *testing.T) {
	app, db := setupInventoryTestApp(t)
	row := createStackRow(t, db, "card-a", "nonfoil", 1, nil)

	status, item := postInventory(t, app,
		`{"scryfall_id":"card-a","oracle_id":"oracle-card-a","treatment":"nonfoil","unassigned":true,"merge":true}`)

	if status != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, status)
	}
	if item.ID != row.ID || item.Quantity != 2 || item.StorageLocationID != nil {
		t.Errorf("expected unassigned row %d with quantity 2, got %+v", row.ID, item)
	}
}

func TestInventoryCreate_Merge_IntoAutoSortedStack(t *testing.T) {
	app, db := setupInventoryTestAppWithRules(t)
	box := createTestStorageLocation(t, db)
	createTestCard(t, db, "bolt-id", "Lightning Bolt", "lea", "common", "0.25")
	createTestSortingRule(t, db, "Cheap Cards", 1, "prices.usd < 5.0", box.ID)
	row := createStackRow(t, db, "bolt-id", "nonfoil", 1, &box.ID)

	status, item := postInventory(t, app,
		`{"scryfall_id":"bolt-id","oracle_id":"oracle-bolt-id","treatment":"nonfoil","merge":true}`)

	if status != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, status)
	}
	if item.ID != row.ID || item.Quantity != 2 {
		t.Errorf("expected the auto-sorted row %d with quantity 2, got %+v", row.ID, item)
	}
}

func TestInventoryCreate_WithoutMerge_StillInserts(t *testing.T) {
	app, db := setupInventoryTestApp(t)
	box := createTestStorageLocation(t, db)
	createStackRow(t, db, "card-a", "nonfoil", 1, &box.ID)

	status, _ := postInventory(t, app, fmt.Sprintf(
		`{"scryfall_id":"card-a","oracle_id":"oracle-card-a","treatment":"nonfoil","storage_location_id":%d}`, box.ID))

	if status != http.StatusCreated {
		t.Fatalf("expected status %d, got %d", http.StatusCreated, status)
	}
	if n := countStackRows(t, db, "card-a", "nonfoil", &box.ID); n != 2 {
		t.Errorf("expected a second row without merge, got %d rows", n)
	}
}

func TestInventoryCreate_Unassigned_SkipsRules(t *testing.T) {
	app, db := setupInventoryTestAppWithRules(t)
	box := createTestStorageLocation(t, db)
	createTestCard(t, db, "bolt-id", "Lightning Bolt", "lea", "common", "0.25")
	createTestSortingRule(t, db, "Cheap Cards", 1, "prices.usd < 5.0", box.ID)

	status, item := postInventory(t, app,
		`{"scryfall_id":"bolt-id","oracle_id":"oracle-bolt-id","treatment":"nonfoil","unassigned":true}`)

	if status != http.StatusCreated {
		t.Fatalf("expected status %d, got %d", http.StatusCreated, status)
	}
	if item.StorageLocationID != nil {
		t.Errorf("expected no storage location, got %d", *item.StorageLocationID)
	}
}

func TestInventoryCreate_UnassignedWithLocation_BadRequest(t *testing.T) {
	app, db := setupInventoryTestApp(t)
	box := createTestStorageLocation(t, db)

	status, _ := postInventory(t, app, fmt.Sprintf(
		`{"scryfall_id":"card-a","oracle_id":"oracle-card-a","storage_location_id":%d,"unassigned":true}`, box.ID))

	if status != http.StatusBadRequest {
		t.Errorf("expected status %d, got %d", http.StatusBadRequest, status)
	}
}

func TestInventoryAutoLocation(t *testing.T) {
	app, db := setupInventoryTestAppWithRules(t)
	box := createTestStorageLocation(t, db)
	createTestCard(t, db, "bolt-id", "Lightning Bolt", "lea", "common", "0.25")
	createTestCard(t, db, "lotus-id", "Black Lotus", "lea", "rare", "50000.00")
	createTestSortingRule(t, db, "Cheap Cards", 1, "prices.usd < 5.0", box.ID)

	tests := []struct {
		name       string
		url        string
		wantStatus int
		wantID     *uint
	}{
		{"rule matches", "/api/inventory/auto-location?scryfall_id=bolt-id&treatment=nonfoil", http.StatusOK, &box.ID},
		{"no rule matches", "/api/inventory/auto-location?scryfall_id=lotus-id&treatment=nonfoil", http.StatusOK, nil},
		{"card not in the local catalog", "/api/inventory/auto-location?scryfall_id=missing", http.StatusOK, nil},
		{"scryfall_id missing", "/api/inventory/auto-location", http.StatusBadRequest, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got AutoLocationResponse
			status := getJSON(t, app, tt.url, &got)
			if status != tt.wantStatus {
				t.Fatalf("expected status %d, got %d", tt.wantStatus, status)
			}
			if tt.wantID == nil && got.StorageLocation != nil {
				t.Errorf("expected no location, got %d", got.StorageLocation.ID)
			}
			if tt.wantID != nil && (got.StorageLocation == nil || got.StorageLocation.ID != *tt.wantID) {
				t.Errorf("expected location %d, got %+v", *tt.wantID, got.StorageLocation)
			}
		})
	}

	// The preview must not write anything.
	var rows int64
	db.Model(&models.Inventory{}).Count(&rows)
	if rows != 0 {
		t.Errorf("expected no inventory rows after previews, got %d", rows)
	}
}

func TestInventoryAvailability(t *testing.T) {
	app, db := setupInventoryTestApp(t)
	box := createTestStorageLocation(t, db)
	// Three copies of one card across two printings.
	createStackRow(t, db, "print-1", "nonfoil", 2, &box.ID)
	row := models.Inventory{ScryfallID: "print-2", OracleID: "oracle-print-1", Treatment: "foil", Quantity: 1}
	if err := db.Create(&row).Error; err != nil {
		t.Fatalf("failed to create row: %v", err)
	}

	var before DeckAvailability
	if status := getJSON(t, app, "/api/inventory/availability/oracle-print-1", &before); status != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, status)
	}
	wantBefore := DeckAvailability{Owned: 3, Decked: 0, Free: 3,
		Printings: map[string]int{"print-1": 2, "print-2": 1}}
	if !reflect.DeepEqual(before, wantBefore) {
		t.Errorf("without decks: expected %+v, got %+v", wantBefore, before)
	}

	deck := models.Deck{Name: "Burn"}
	if err := db.Create(&deck).Error; err != nil {
		t.Fatalf("failed to create deck: %v", err)
	}
	addDeckItemDemand(t, db, deck.ID, "oracle-print-1", 2)

	var after DeckAvailability
	getJSON(t, app, "/api/inventory/availability/oracle-print-1", &after)
	// The deck takes any printing, so either printing can still give the one free copy.
	wantAfter := DeckAvailability{Owned: 3, Decked: 2, Free: 1,
		Printings: map[string]int{"print-1": 1, "print-2": 1}}
	if !reflect.DeepEqual(after, wantAfter) {
		t.Errorf("with a deck wanting 2: expected %+v, got %+v", wantAfter, after)
	}

	var unknown DeckAvailability
	getJSON(t, app, "/api/inventory/availability/unknown-oracle", &unknown)
	if !reflect.DeepEqual(unknown, DeckAvailability{}) {
		t.Errorf("unknown card: expected all zeros, got %+v", unknown)
	}
}
