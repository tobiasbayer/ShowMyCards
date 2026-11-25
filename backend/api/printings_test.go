package api

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"backend/models"
	"backend/scryfall"
	"backend/services"

	goscryfall "github.com/BlueMonday/go-scryfall"
)

type printingsCardSource struct {
	searchCards  []goscryfall.Card
	searchErr    error
	byID         map[string]goscryfall.Card
	byIDErr      error
	getByIDCalls int
	lastQuery    string
	lastOpts     scryfall.SearchOptions
}

func (p *printingsCardSource) SearchWithOptions(_ context.Context, query string, opts scryfall.SearchOptions) (scryfall.SearchResult, error) {
	p.lastQuery = query
	p.lastOpts = opts
	if p.searchErr != nil {
		return scryfall.SearchResult{}, p.searchErr
	}
	return scryfall.SearchResult{
		Cards:      p.searchCards,
		TotalCards: len(p.searchCards),
		Page:       opts.Page,
	}, nil
}

func (p *printingsCardSource) GetByID(_ context.Context, id string) (goscryfall.Card, error) {
	p.getByIDCalls++
	if p.byIDErr != nil {
		return goscryfall.Card{}, p.byIDErr
	}
	if card, ok := p.byID[id]; ok {
		return card, nil
	}
	return goscryfall.Card{}, errors.New("not found")
}

func setupPrintingsTest(t *testing.T, source cardSource) (*collectionSearchSetup, *services.SettingsService) {
	t.Helper()
	s := setupCollectionSearch(t)
	if err := s.db.AutoMigrate(&models.Setting{}); err != nil {
		t.Fatalf("failed to migrate settings: %v", err)
	}
	settingsSvc := services.NewSettingsService(s.db)
	handler := NewSearchHandler(source, s.db, settingsSvc)
	s.app.Get("/api/cards/printings/:oracle_id", handler.Printings)
	return s, settingsSvc
}

func getPrintings(t *testing.T, s *collectionSearchSetup, target string) (int, []InventoryCard) {
	t.Helper()
	resp, err := s.app.Test(httptest.NewRequest(http.MethodGet, target, nil))
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	var cards []InventoryCard
	if resp.StatusCode == http.StatusOK {
		if err := json.NewDecoder(resp.Body).Decode(&cards); err != nil {
			t.Fatalf("failed to decode printings response: %v", err)
		}
	}
	return resp.StatusCode, cards
}

func TestPrintings_IncludesCrossLanguageOwnedPrintingsAndDeduplicates(t *testing.T) {
	boltEN := scryfallFixture(t, fixtureBolt)
	boltExtraEN := boltEN
	boltExtraEN.ID = "bolt-lea-en"
	boltExtraEN.Set = "lea"
	boltExtraEN.SetName = "Limited Edition Alpha"
	boltExtraEN.CollectorNumber = "161"

	source := &printingsCardSource{
		searchCards: []goscryfall.Card{boltEN, boltExtraEN},
	}
	s, _ := setupPrintingsTest(t, source)
	s.addCard(t, fixtureBolt)
	s.addCard(t, fixtureBoltDE)
	s.addRow(t, fixtureBolt, "nonfoil", 2, &s.boxA.ID)
	s.addRow(t, fixtureBoltDE, "nonfoil", 1, nil)

	deck := models.Deck{Name: "Burn"}
	if err := s.db.Create(&deck).Error; err != nil {
		t.Fatalf("failed to create deck: %v", err)
	}
	addDeckItemDemand(t, s.db, deck.ID, fixtureBolt.oracle, 1)

	status, cards := getPrintings(t, s, "/api/cards/printings/"+fixtureBolt.oracle+"?lang=en")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if source.lastQuery != "oracleid:"+fixtureBolt.oracle+" game:paper l:en" {
		t.Errorf("query = %q, want %q", source.lastQuery, "oracleid:"+fixtureBolt.oracle+" game:paper l:en")
	}
	if source.lastOpts.UniqueMode != goscryfall.UniqueModePrints {
		t.Errorf("UniqueMode = %q, want %q", source.lastOpts.UniqueMode, goscryfall.UniqueModePrints)
	}

	var gotIDs []string
	for _, c := range cards {
		gotIDs = append(gotIDs, c.ID)
	}
	// Both bolt_m11 and bolt_m11_de have released_at 2010-07-16, set m11, cn 149; lang "de" < "en".
	wantIDs := []string{fixtureBoltDE.id, fixtureBolt.id, boltExtraEN.ID}
	if !slices.Equal(gotIDs, wantIDs) {
		t.Fatalf("ids = %v, want %v", gotIDs, wantIDs)
	}

	deCard := cards[0]
	if deCard.Prices.USD == "" {
		t.Errorf("expected English price backfill on German printing, got empty prices: %+v", deCard.Prices)
	}
	if len(deCard.Inventory.ThisPrinting) != 1 || len(deCard.Inventory.OtherPrintings) != 1 || deCard.Inventory.TotalQuantity != 3 {
		t.Errorf("unexpected German printing inventory = %+v", deCard.Inventory)
	}
	wantPrintings := map[string]int{fixtureBolt.id: 2, fixtureBoltDE.id: 1}
	if deCard.Deck.Owned != 3 || deCard.Deck.Decked != 1 || deCard.Deck.Free != 2 || !maps.Equal(deCard.Deck.Printings, wantPrintings) {
		t.Errorf("unexpected German printing deck = %+v", deCard.Deck)
	}
}

func TestPrintings_GermanViewIncludesOwnedEnglishPrinting(t *testing.T) {
	boltDE := scryfallFixture(t, fixtureBoltDE)
	source := &printingsCardSource{
		searchCards: []goscryfall.Card{boltDE},
	}
	s, _ := setupPrintingsTest(t, source)
	s.addCard(t, fixtureBolt)
	s.addCard(t, fixtureBoltDE)
	s.addRow(t, fixtureBolt, "nonfoil", 1, &s.boxA.ID)
	s.addRow(t, fixtureBoltDE, "nonfoil", 1, nil)

	status, cards := getPrintings(t, s, "/api/cards/printings/"+fixtureBolt.oracle+"?lang=de")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if source.lastQuery != "oracleid:"+fixtureBolt.oracle+" game:paper l:de" {
		t.Errorf("query = %q, want %q", source.lastQuery, "oracleid:"+fixtureBolt.oracle+" game:paper l:de")
	}

	var gotIDs []string
	for _, c := range cards {
		gotIDs = append(gotIDs, c.ID)
	}
	wantIDs := []string{fixtureBoltDE.id, fixtureBolt.id}
	if !slices.Equal(gotIDs, wantIDs) {
		t.Fatalf("ids = %v, want %v", gotIDs, wantIDs)
	}
}

func TestPrintings_IgnoresZeroQuantityInventoryRows(t *testing.T) {
	boltEN := scryfallFixture(t, fixtureBolt)
	source := &printingsCardSource{
		searchCards: []goscryfall.Card{boltEN},
	}
	s, _ := setupPrintingsTest(t, source)
	s.addCard(t, fixtureBolt)
	s.addCard(t, fixtureBoltDE)
	s.addRow(t, fixtureBoltDE, "nonfoil", 0, nil)
	// Quantity has gorm:"default:1", so GORM replaces zero values on Create.
	if err := s.db.Model(&models.Inventory{}).Where("scryfall_id = ?", fixtureBoltDE.id).UpdateColumn("quantity", 0).Error; err != nil {
		t.Fatalf("failed to set zero quantity: %v", err)
	}

	status, cards := getPrintings(t, s, "/api/cards/printings/"+fixtureBolt.oracle+"?lang=en")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if len(cards) != 1 || cards[0].ID != fixtureBolt.id {
		t.Fatalf("got %d cards (%v), want only %s", len(cards), cards, fixtureBolt.id)
	}
}

func TestPrintings_FallsBackToGetByIDAndSkipsUnresolvable(t *testing.T) {
	boltEN := scryfallFixture(t, fixtureBolt)
	boltDE := scryfallFixture(t, fixtureBoltDE)

	t.Run("resolves missing local card via GetByID", func(t *testing.T) {
		source := &printingsCardSource{
			searchCards: []goscryfall.Card{boltEN},
			byID:        map[string]goscryfall.Card{fixtureBoltDE.id: boltDE},
		}
		s, _ := setupPrintingsTest(t, source)
		s.addCard(t, fixtureBolt)
		s.addRow(t, fixtureBoltDE, "nonfoil", 1, nil)

		status, cards := getPrintings(t, s, "/api/cards/printings/"+fixtureBolt.oracle+"?lang=en")
		if status != http.StatusOK {
			t.Fatalf("status = %d, want 200", status)
		}
		if len(cards) != 2 || cards[0].ID != fixtureBoltDE.id || cards[1].ID != fixtureBolt.id {
			t.Fatalf("cards = %+v, want [DE, EN]", cards)
		}
	})

	t.Run("skips owned card when GetByID fails", func(t *testing.T) {
		source := &printingsCardSource{
			searchCards: []goscryfall.Card{boltEN},
			byIDErr:     errors.New("scryfall unavailable"),
		}
		s, _ := setupPrintingsTest(t, source)
		s.addRow(t, fixtureBoltDE, "nonfoil", 1, nil)

		status, cards := getPrintings(t, s, "/api/cards/printings/"+fixtureBolt.oracle+"?lang=en")
		if status != http.StatusOK {
			t.Fatalf("status = %d, want 200", status)
		}
		if len(cards) != 1 || cards[0].ID != fixtureBolt.id {
			t.Fatalf("cards = %+v, want only catalog EN printing", cards)
		}
	})
}

func TestPrintings_ScryfallErrors(t *testing.T) {
	t.Run("404 from Scryfall returns owned printings", func(t *testing.T) {
		source := &printingsCardSource{
			searchErr: &goscryfall.Error{Status: http.StatusNotFound, Code: "not_found"},
		}
		s, _ := setupPrintingsTest(t, source)
		s.addCard(t, fixtureBoltDE)
		s.addRow(t, fixtureBoltDE, "nonfoil", 1, nil)

		status, cards := getPrintings(t, s, "/api/cards/printings/"+fixtureBolt.oracle+"?lang=ja")
		if status != http.StatusOK {
			t.Fatalf("status = %d, want 200", status)
		}
		if len(cards) != 1 || cards[0].ID != fixtureBoltDE.id {
			t.Fatalf("cards = %+v, want owned DE printing", cards)
		}
	})

	t.Run("404 from Scryfall with no owned printings returns empty array", func(t *testing.T) {
		source := &printingsCardSource{
			searchErr: &goscryfall.Error{Status: http.StatusNotFound, Code: "not_found"},
		}
		s, _ := setupPrintingsTest(t, source)

		resp, err := s.app.Test(httptest.NewRequest(http.MethodGet, "/api/cards/printings/"+fixtureBolt.oracle, nil))
		if err != nil {
			t.Fatalf("request failed: %v", err)
		}
		defer func() { _ = resp.Body.Close() }()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		var raw json.RawMessage
		if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
			t.Fatalf("decode failed: %v", err)
		}
		if string(raw) != "[]" {
			t.Fatalf("body = %s, want []", string(raw))
		}
	})

	t.Run("500 from Scryfall still returns local owned printings and skips GetByID fallback", func(t *testing.T) {
		source := &printingsCardSource{
			searchErr: &goscryfall.Error{Status: http.StatusInternalServerError, Code: "internal_error"},
			byID:      map[string]goscryfall.Card{fixtureBolt.id: scryfallFixture(t, fixtureBolt)},
		}
		s, _ := setupPrintingsTest(t, source)
		s.addCard(t, fixtureBoltDE)
		s.addRow(t, fixtureBoltDE, "nonfoil", 1, nil)
		// Owned printing absent from local cards table should not trigger GetByID when Scryfall already failed.
		s.addRow(t, fixtureBolt, "nonfoil", 1, &s.boxA.ID)

		status, cards := getPrintings(t, s, "/api/cards/printings/"+fixtureBolt.oracle)
		if status != http.StatusOK {
			t.Fatalf("status = %d, want 200", status)
		}
		if len(cards) != 1 || cards[0].ID != fixtureBoltDE.id {
			t.Fatalf("cards = %+v, want local owned DE printing only", cards)
		}
		if source.getByIDCalls != 0 {
			t.Errorf("getByIDCalls = %d, want 0", source.getByIDCalls)
		}
	})
}

func TestPrintings_UsesSettingsDefaults(t *testing.T) {
	source := &printingsCardSource{searchCards: []goscryfall.Card{scryfallFixture(t, fixtureBoltDE)}}
	s, settingsSvc := setupPrintingsTest(t, source)
	ctx := context.Background()
	if err := settingsSvc.Set(ctx, "scryfall_default_language", "de"); err != nil {
		t.Fatalf("failed to set language setting: %v", err)
	}
	if err := settingsSvc.Set(ctx, "scryfall_default_search", "-is:digital"); err != nil {
		t.Fatalf("failed to set default search setting: %v", err)
	}

	status, _ := getPrintings(t, s, "/api/cards/printings/"+fixtureBolt.oracle)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	want := "oracleid:" + fixtureBolt.oracle + " -is:digital l:de"
	if source.lastQuery != want {
		t.Errorf("query = %q, want %q", source.lastQuery, want)
	}
}
