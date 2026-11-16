package api

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"backend/models"
	"backend/scryfall"
	"backend/services"

	goscryfall "github.com/BlueMonday/go-scryfall"
)

// fakeCardSource answers every search with the same cards.
type fakeCardSource struct {
	cards []goscryfall.Card
}

func (f fakeCardSource) SearchWithOptions(_ context.Context, _ string, opts scryfall.SearchOptions) (scryfall.SearchResult, error) {
	return scryfall.SearchResult{Cards: f.cards, TotalCards: len(f.cards), Page: opts.Page}, nil
}

func (f fakeCardSource) GetByID(context.Context, string) (goscryfall.Card, error) {
	return goscryfall.Card{}, errors.New("not used")
}

func scryfallFixture(t *testing.T, f searchFixture) goscryfall.Card {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "cardquery", "testdata", f.file+".json"))
	if err != nil {
		t.Fatalf("failed to read fixture %s: %v", f.file, err)
	}
	var card goscryfall.Card
	if err := json.Unmarshal(raw, &card); err != nil {
		t.Fatalf("failed to decode fixture %s: %v", f.file, err)
	}
	card.OracleID = f.oracle
	return card
}

// The real Search handler attaches deck availability to each result: per card,
// plus the free copies of every owned printing.
func TestSearch_DeckAvailability(t *testing.T) {
	s := setupCollectionSearch(t)
	if err := s.db.AutoMigrate(&models.Setting{}); err != nil {
		t.Fatalf("failed to migrate settings: %v", err)
	}
	s.addCard(t, fixtureBolt)
	s.addCard(t, fixtureBoltDE)
	s.addRow(t, fixtureBolt, "nonfoil", 2, &s.boxA.ID)
	s.addRow(t, fixtureBoltDE, "nonfoil", 1, nil)
	deck := models.Deck{Name: "Burn"}
	if err := s.db.Create(&deck).Error; err != nil {
		t.Fatalf("failed to create deck: %v", err)
	}
	addDeckItemDemand(t, s.db, deck.ID, fixtureBolt.oracle, 1)

	source := fakeCardSource{cards: []goscryfall.Card{
		scryfallFixture(t, fixtureBolt),
		scryfallFixture(t, fixtureJace), // not owned
	}}
	handler := NewSearchHandler(source, s.db, services.NewSettingsService(s.db))
	s.app.Get("/api/search", handler.Search)

	resp, err := s.app.Test(httptest.NewRequest(http.MethodGet, "/api/search?q=bolt", nil))
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var body SearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(body.Data) != 2 {
		t.Fatalf("got %d results, want 2", len(body.Data))
	}

	bolt := body.Data[0].Deck
	if bolt.Owned != 3 || bolt.Decked != 1 || bolt.Free != 2 {
		t.Errorf("bolt deck = %+v, want owned 3, decked 1, free 2", bolt)
	}
	wantPrintings := map[string]int{fixtureBolt.id: 2, fixtureBoltDE.id: 1}
	if !maps.Equal(bolt.Printings, wantPrintings) {
		t.Errorf("bolt printings = %v, want %v", bolt.Printings, wantPrintings)
	}

	jace := body.Data[1].Deck
	if jace.Owned != 0 || jace.Free != 0 || jace.Printings != nil {
		t.Errorf("unowned card deck = %+v, want zero with no printings", jace)
	}
}
