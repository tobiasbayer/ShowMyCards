package services

import (
	"context"
	"maps"
	"testing"

	"backend/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupAllocationTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to connect to test database: %v", err)
	}
	if err := db.AutoMigrate(&models.Deck{}, &models.DeckItem{}, &models.Inventory{}); err != nil {
		t.Fatalf("failed to migrate test database: %v", err)
	}
	return db
}

func addInventory(t *testing.T, db *gorm.DB, oracleID, scryfallID string, qty int) {
	t.Helper()
	inv := models.Inventory{OracleID: oracleID, ScryfallID: scryfallID, Treatment: "nonfoil", Quantity: qty}
	if err := db.Create(&inv).Error; err != nil {
		t.Fatalf("failed to create inventory: %v", err)
	}
}

func addDeckItem(t *testing.T, db *gorm.DB, deckID uint, oracleID, scryfallID string, zone models.DeckZone, qty int) {
	t.Helper()
	item := models.DeckItem{
		DeckID: deckID, OracleID: oracleID, ScryfallID: scryfallID, Zone: zone, DesiredQuantity: qty,
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatalf("failed to create deck item: %v", err)
	}
}

func newDeck(t *testing.T, db *gorm.DB, name string) models.Deck {
	t.Helper()
	deck := models.Deck{Name: name}
	if err := db.Create(&deck).Error; err != nil {
		t.Fatalf("failed to create deck: %v", err)
	}
	return deck
}

func computeOracle(t *testing.T, db *gorm.DB, oracleID string) OracleAvailability {
	t.Helper()
	svc := NewAllocationService(db)
	m, err := svc.ComputeAvailability(context.Background())
	if err != nil {
		t.Fatalf("ComputeAvailability failed: %v", err)
	}
	return m.OracleAvailabilityFor(oracleID)
}

func assertAvail(t *testing.T, got OracleAvailability, owned, demand, free int, overCommitted bool) {
	t.Helper()
	if got.Owned != owned {
		t.Errorf("owned: expected %d, got %d", owned, got.Owned)
	}
	if got.Demand != demand {
		t.Errorf("demand: expected %d, got %d", demand, got.Demand)
	}
	if got.Free != free {
		t.Errorf("free: expected %d, got %d", free, got.Free)
	}
	if got.OverCommitted != overCommitted {
		t.Errorf("over_committed: expected %v, got %v", overCommitted, got.OverCommitted)
	}
}

func TestAllocation_EmptyState(t *testing.T) {
	db := setupAllocationTestDB(t)

	svc := NewAllocationService(db)
	m, err := svc.ComputeAvailability(context.Background())
	if err != nil {
		t.Fatalf("ComputeAvailability failed: %v", err)
	}
	if len(m.Oracle) != 0 {
		t.Errorf("expected empty oracle map, got %d entries", len(m.Oracle))
	}
	// Unknown oracle resolves to a zero-valued entry.
	assertAvail(t, m.OracleAvailabilityFor("nope"), 0, 0, 0, false)
}

func TestAllocation_SingleDeckWithinSupply(t *testing.T) {
	db := setupAllocationTestDB(t)
	deck := newDeck(t, db, "Solo")

	addInventory(t, db, "oracle-1", "scry-1", 4)
	addDeckItem(t, db, deck.ID, "oracle-1", "", models.ZoneMain, 3)

	assertAvail(t, computeOracle(t, db, "oracle-1"), 4, 3, 1, false)
}

func TestAllocation_PartlyDecked(t *testing.T) {
	db := setupAllocationTestDB(t)
	deck := newDeck(t, db, "Partial")

	// Own 8, 4 decked -> free 4.
	addInventory(t, db, "oracle-1", "scry-1", 8)
	addDeckItem(t, db, deck.ID, "oracle-1", "", models.ZoneMain, 4)

	assertAvail(t, computeOracle(t, db, "oracle-1"), 8, 4, 4, false)
}

func TestAllocation_MultipleDecksContend(t *testing.T) {
	db := setupAllocationTestDB(t)
	deckA := newDeck(t, db, "A")
	deckB := newDeck(t, db, "B")

	// Own 4, two decks each want 3 -> demand 6 > owned 4 -> over-committed.
	addInventory(t, db, "oracle-1", "scry-1", 4)
	addDeckItem(t, db, deckA.ID, "oracle-1", "", models.ZoneMain, 3)
	addDeckItem(t, db, deckB.ID, "oracle-1", "", models.ZoneMain, 3)

	assertAvail(t, computeOracle(t, db, "oracle-1"), 4, 6, 0, true)
}

func TestAllocation_DemandEqualsOwnedNotOverCommitted(t *testing.T) {
	db := setupAllocationTestDB(t)
	deck := newDeck(t, db, "Exact")

	addInventory(t, db, "oracle-1", "scry-1", 2)
	addDeckItem(t, db, deck.ID, "oracle-1", "", models.ZoneMain, 2)

	// demand == owned is feasible (not over-committed), free 0.
	assertAvail(t, computeOracle(t, db, "oracle-1"), 2, 2, 0, false)
}

func TestAllocation_MaybeZoneExcludedFromDemand(t *testing.T) {
	db := setupAllocationTestDB(t)
	deck := newDeck(t, db, "Maybe")

	addInventory(t, db, "oracle-1", "scry-1", 1)
	// A huge maybe-board entry must not lock inventory.
	addDeckItem(t, db, deck.ID, "oracle-1", "", models.ZoneMaybe, 99)

	assertAvail(t, computeOracle(t, db, "oracle-1"), 1, 0, 1, false)
}

func TestAllocation_DemandZonesAllCount(t *testing.T) {
	db := setupAllocationTestDB(t)
	deck := newDeck(t, db, "Zones")

	addInventory(t, db, "oracle-1", "scry-1", 10)
	addDeckItem(t, db, deck.ID, "oracle-1", "", models.ZoneMain, 1)
	addDeckItem(t, db, deck.ID, "oracle-1", "", models.ZoneSide, 2)
	addDeckItem(t, db, deck.ID, "oracle-1", "", models.ZoneCommand, 3)
	addDeckItem(t, db, deck.ID, "oracle-1", "", models.ZoneMaybe, 50)

	// Main+Side+Command = 6 demand; maybe excluded.
	assertAvail(t, computeOracle(t, db, "oracle-1"), 10, 6, 4, false)
}

func TestAllocation_PinnedPrintingConflictWhenOracleFits(t *testing.T) {
	db := setupAllocationTestDB(t)
	deck := newDeck(t, db, "Pinned")

	// Oracle pool is plenty (own 4 total across two printings), but the deck
	// pins printing P and wants 3 of it while only 1 of P is owned.
	addInventory(t, db, "oracle-1", "scry-A", 1) // pinned printing P = scry-A
	addInventory(t, db, "oracle-1", "scry-B", 3) // other printing of same oracle
	addDeckItem(t, db, deck.ID, "oracle-1", "scry-A", models.ZoneMain, 3)

	// Oracle: owned 4, demand 3 -> total fits; but pinned scry-A (own 1, want 3)
	// is over-subscribed -> Oracle flagged over-committed.
	assertAvail(t, computeOracle(t, db, "oracle-1"), 4, 3, 1, true)
}

func TestAllocation_PinnedPrintingFitsNoConflict(t *testing.T) {
	db := setupAllocationTestDB(t)
	deck := newDeck(t, db, "PinnedOK")

	addInventory(t, db, "oracle-1", "scry-A", 3)
	addDeckItem(t, db, deck.ID, "oracle-1", "scry-A", models.ZoneMain, 2)

	// Pinned demand (2) fits printing supply (3), oracle total fits -> no conflict.
	assertAvail(t, computeOracle(t, db, "oracle-1"), 3, 2, 1, false)
}

func TestAllocation_PinnedAcrossDecksOverSubscribed(t *testing.T) {
	db := setupAllocationTestDB(t)
	deckA := newDeck(t, db, "A")
	deckB := newDeck(t, db, "B")

	// Two decks each pin the same printing; combined pinned demand exceeds the
	// printing's owned copies even though both decks' totals are small.
	addInventory(t, db, "oracle-1", "scry-A", 2)
	addDeckItem(t, db, deckA.ID, "oracle-1", "scry-A", models.ZoneMain, 2)
	addDeckItem(t, db, deckB.ID, "oracle-1", "scry-A", models.ZoneSide, 1)

	// Oracle owned 2, demand 3 -> over the oracle total too, so over-committed.
	assertAvail(t, computeOracle(t, db, "oracle-1"), 2, 3, 0, true)
}

func TestAllocation_OwnedNothingDemandedShortfall(t *testing.T) {
	db := setupAllocationTestDB(t)
	deck := newDeck(t, db, "Unowned")

	// No inventory at all, want 4 -> over-committed, free 0.
	addDeckItem(t, db, deck.ID, "oracle-1", "", models.ZoneMain, 4)

	assertAvail(t, computeOracle(t, db, "oracle-1"), 0, 4, 0, true)
}

func TestAllocation_MultipleOraclesIndependent(t *testing.T) {
	db := setupAllocationTestDB(t)
	deck := newDeck(t, db, "Multi")

	addInventory(t, db, "oracle-1", "scry-1", 4)
	addInventory(t, db, "oracle-2", "scry-2", 1)
	addDeckItem(t, db, deck.ID, "oracle-1", "", models.ZoneMain, 2)
	addDeckItem(t, db, deck.ID, "oracle-2", "", models.ZoneMain, 3)

	svc := NewAllocationService(db)
	m, err := svc.ComputeAvailability(context.Background())
	if err != nil {
		t.Fatalf("ComputeAvailability failed: %v", err)
	}

	assertAvail(t, m.OracleAvailabilityFor("oracle-1"), 4, 2, 2, false)
	assertAvail(t, m.OracleAvailabilityFor("oracle-2"), 1, 3, 0, true)
}

func computeMap(t *testing.T, db *gorm.DB) AvailabilityMap {
	t.Helper()
	m, err := NewAllocationService(db).ComputeAvailability(context.Background())
	if err != nil {
		t.Fatalf("ComputeAvailability failed: %v", err)
	}
	return m
}

func assertPrintingsFree(t *testing.T, m AvailabilityMap, oracleID string, want map[string]int) {
	t.Helper()
	got := m.PrintingsFree(oracleID)
	if !maps.Equal(got, want) {
		t.Errorf("PrintingsFree(%s) = %v, want %v", oracleID, got, want)
	}
	for id, n := range want {
		if p := m.PrintingFree(oracleID, id); p != n {
			t.Errorf("PrintingFree(%s, %s) = %d, want %d", oracleID, id, p, n)
		}
	}
}

func TestPrintingFree_EachDeckPinsItsOwnPrinting(t *testing.T) {
	db := setupAllocationTestDB(t)

	// Seven copies over six printings; six decks each pin one printing. Only
	// the second copy of the first printing is free.
	addInventory(t, db, "sol-ring", "blc", 2)
	for _, printing := range []string{"woc", "ecc", "mic", "onc", "znc"} {
		addInventory(t, db, "sol-ring", printing, 1)
	}
	for _, printing := range []string{"blc", "woc", "ecc", "mic", "onc", "znc"} {
		deck := newDeck(t, db, "Deck "+printing)
		addDeckItem(t, db, deck.ID, "sol-ring", printing, models.ZoneMain, 1)
	}

	m := computeMap(t, db)
	assertAvail(t, m.OracleAvailabilityFor("sol-ring"), 7, 6, 1, false)
	assertPrintingsFree(t, m, "sol-ring", map[string]int{
		"blc": 1, "woc": 0, "ecc": 0, "mic": 0, "onc": 0, "znc": 0,
	})
}

func TestPrintingFree_AnyPrintingSlotIsUpTo(t *testing.T) {
	db := setupAllocationTestDB(t)
	deck := newDeck(t, db, "Any")

	// Two of three copies are free, and the deck takes whichever is left, so
	// either printing can give up to two (or its own count).
	addInventory(t, db, "oracle-1", "blc", 2)
	addInventory(t, db, "oracle-1", "znc", 1)
	addDeckItem(t, db, deck.ID, "oracle-1", "", models.ZoneMain, 1)

	assertPrintingsFree(t, computeMap(t, db), "oracle-1", map[string]int{"blc": 2, "znc": 1})
}

func TestPrintingFree_OverSubscribedPinnedPrinting(t *testing.T) {
	db := setupAllocationTestDB(t)
	deck := newDeck(t, db, "Pinned")

	// The deck pins scry-A (1 owned, 3 wanted): nothing of scry-A is free, and
	// scry-B gives at most the card's single free copy.
	addInventory(t, db, "oracle-1", "scry-A", 1)
	addInventory(t, db, "oracle-1", "scry-B", 3)
	addDeckItem(t, db, deck.ID, "oracle-1", "scry-A", models.ZoneMain, 3)

	assertPrintingsFree(t, computeMap(t, db), "oracle-1", map[string]int{"scry-A": 0, "scry-B": 1})
}

func TestPrintingFree_MaybeZoneDoesNotPin(t *testing.T) {
	db := setupAllocationTestDB(t)
	deck := newDeck(t, db, "Maybe")

	addInventory(t, db, "oracle-1", "scry-A", 1)
	addDeckItem(t, db, deck.ID, "oracle-1", "scry-A", models.ZoneMaybe, 1)

	assertPrintingsFree(t, computeMap(t, db), "oracle-1", map[string]int{"scry-A": 1})
}

func TestPrintingFree_UnownedPrinting(t *testing.T) {
	db := setupAllocationTestDB(t)

	addInventory(t, db, "oracle-1", "scry-A", 2)

	m := computeMap(t, db)
	if got := m.PrintingFree("oracle-1", "scry-other"); got != 0 {
		t.Errorf("unowned printing: PrintingFree = %d, want 0", got)
	}
	if got := m.PrintingsFree("oracle-unknown"); got != nil {
		t.Errorf("unknown card: PrintingsFree = %v, want nil", got)
	}
}
