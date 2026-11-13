package api

import (
	"encoding/json"
	"maps"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strconv"
	"testing"
	"time"

	"backend/models"
	"backend/services"

	"github.com/gofiber/fiber/v3"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// Card JSON shared with the cardquery package's tests.
type searchFixture struct {
	file, id, oracle string
}

var (
	fixtureBolt   = searchFixture{"bolt_m11", "e768c957-3a1f-42f5-853a-96942f645df5", "4457ed35-7c10-48c8-9776-456485fdf070"}
	fixtureBoltDE = searchFixture{"bolt_m11_de", "2fccd2f9-9f1b-4f88-a18c-81c374a249e0", "4457ed35-7c10-48c8-9776-456485fdf070"}
	fixtureKrenko = searchFixture{"krenko", "aa078518-0ce2-4c6f-9061-aa7e22ed7493", "krenko-oracle"}
	fixtureJace   = searchFixture{"jace", "c057dc0d-4017-4e60-9c5e-45fc569a8d31", "jace-oracle"}
	fixtureDelver = searchFixture{"delver", "11bf83bb-c95b-4b4f-9a56-ce7a1816307a", "delver-oracle"}
)

type collectionSearchSetup struct {
	app      *fiber.App
	db       *gorm.DB
	boxA     models.StorageLocation
	boxB     models.StorageLocation
	nextTime time.Time
}

// setupCollectionSearch creates an app with the search route and a database
// with the generated card columns the English-price fallback needs.
func setupCollectionSearch(t *testing.T) *collectionSearchSetup {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to connect to test database: %v", err)
	}
	if err := db.AutoMigrate(&models.StorageLocation{}, &models.Inventory{}, &models.Deck{}, &models.DeckItem{}, &models.Card{}); err != nil {
		t.Fatalf("failed to migrate test database: %v", err)
	}
	for _, stmt := range []string{
		`ALTER TABLE cards ADD COLUMN set_code TEXT GENERATED ALWAYS AS (json_extract(raw_json, '$.set')) VIRTUAL`,
		`ALTER TABLE cards ADD COLUMN collector_number TEXT GENERATED ALWAYS AS (json_extract(raw_json, '$.collector_number')) VIRTUAL`,
		`ALTER TABLE cards ADD COLUMN lang TEXT GENERATED ALWAYS AS (json_extract(raw_json, '$.lang')) VIRTUAL`,
	} {
		if err := db.Exec(stmt).Error; err != nil {
			t.Fatalf("failed to add generated column: %v", err)
		}
	}

	app := fiber.New()
	handler := NewInventoryHandler(db, services.NewAutoSortService(db))
	app.Get("/api/inventory/search", handler.SearchCollection)

	s := &collectionSearchSetup{app: app, db: db, nextTime: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	s.boxA = models.StorageLocation{Name: "Box A", StorageType: models.Box}
	s.boxB = models.StorageLocation{Name: "Box B", StorageType: models.Box}
	for _, loc := range []*models.StorageLocation{&s.boxA, &s.boxB} {
		if err := db.Create(loc).Error; err != nil {
			t.Fatalf("failed to create location: %v", err)
		}
	}
	return s
}

func (s *collectionSearchSetup) addCard(t *testing.T, f searchFixture) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "cardquery", "testdata", f.file+".json"))
	if err != nil {
		t.Fatalf("failed to read fixture %s: %v", f.file, err)
	}
	card := models.Card{ScryfallID: f.id, OracleID: f.oracle, RawJSON: string(raw)}
	if err := s.db.Create(&card).Error; err != nil {
		t.Fatalf("failed to create card: %v", err)
	}
}

// addRow adds copies, each row an hour newer than the last.
func (s *collectionSearchSetup) addRow(t *testing.T, f searchFixture, treatment string, qty int, location *uint) {
	t.Helper()
	row := models.Inventory{ScryfallID: f.id, OracleID: f.oracle, Treatment: treatment, Quantity: qty, StorageLocationID: location}
	row.CreatedAt = s.nextTime
	s.nextTime = s.nextTime.Add(time.Hour)
	if err := s.db.Create(&row).Error; err != nil {
		t.Fatalf("failed to create inventory row: %v", err)
	}
}

func (s *collectionSearchSetup) search(t *testing.T, params url.Values) (int, CollectionSearchResponse, QueryErrorResponse) {
	t.Helper()
	resp, err := s.app.Test(httptest.NewRequest(http.MethodGet, "/api/inventory/search?"+params.Encode(), nil))
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	var ok CollectionSearchResponse
	var bad QueryErrorResponse
	if resp.StatusCode == http.StatusOK {
		err = json.NewDecoder(resp.Body).Decode(&ok)
	} else {
		err = json.NewDecoder(resp.Body).Decode(&bad)
	}
	if err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	return resp.StatusCode, ok, bad
}

func ids(resp CollectionSearchResponse) []string {
	out := make([]string, len(resp.Data))
	for i, c := range resp.Data {
		out[i] = c.ID
	}
	return out
}

// seedCollection: Lightning Bolt (2 nonfoil in A, 1 foil in B), a German Bolt
// (unassigned), Krenko (1 foil in B, wanted by a deck), Jace and Delver (A).
func seedCollection(t *testing.T) *collectionSearchSetup {
	s := setupCollectionSearch(t)
	for _, f := range []searchFixture{fixtureBolt, fixtureBoltDE, fixtureKrenko, fixtureJace, fixtureDelver} {
		s.addCard(t, f)
	}
	s.addRow(t, fixtureBolt, "nonfoil", 2, &s.boxA.ID)
	s.addRow(t, fixtureBolt, "foil", 1, &s.boxB.ID)
	s.addRow(t, fixtureBoltDE, "nonfoil", 1, nil)
	s.addRow(t, fixtureKrenko, "foil", 1, &s.boxB.ID)
	s.addRow(t, fixtureJace, "nonfoil", 1, &s.boxA.ID)
	s.addRow(t, fixtureDelver, "nonfoil", 1, &s.boxA.ID)

	deck := models.Deck{Name: "Goblins"}
	if err := s.db.Create(&deck).Error; err != nil {
		t.Fatalf("failed to create deck: %v", err)
	}
	addDeckItemDemand(t, s.db, deck.ID, fixtureKrenko.oracle, 1)
	return s
}

func TestSearchCollection(t *testing.T) {
	s := seedCollection(t)
	boxA := uintToString(s.boxA.ID)
	boxB := uintToString(s.boxB.ID)

	tests := []struct {
		name  string
		q     string
		scope string
		want  []string // in order
	}{
		{"everything, newest first", "", "", []string{fixtureDelver.id, fixtureJace.id, fixtureKrenko.id, fixtureBoltDE.id, fixtureBolt.id}},
		{"query", "t:legendary", "", []string{fixtureJace.id, fixtureKrenko.id}},
		{"localized text", "o:schadenspunkte", "", []string{fixtureBoltDE.id}},
		{"one location", "", boxA, []string{fixtureDelver.id, fixtureJace.id, fixtureBolt.id}},
		{"unassigned", "", "null", []string{fixtureBoltDE.id}},
		{"finish counts only copies in scope", "finish:foil", boxA, nil},
		{"finish in another location", "finish:foil", boxB, []string{fixtureKrenko.id, fixtureBolt.id}},
		{"qty counts only copies in scope", "qty>=2", boxB, nil},
		{"qty in the whole collection", "qty>=3", "", []string{fixtureBolt.id}},
		{"free for decks", "free>0 c:r", "", []string{fixtureBoltDE.id, fixtureBolt.id}},
		{"free counts only copies in scope", "free>=2", boxB, nil},
		{"free in the whole collection", "free>=3", "", []string{fixtureBolt.id}},
		{"English price for a German printing", "usd>0.5 lang:de", "", []string{fixtureBoltDE.id}},
		{"order", "order:name", boxA, []string{fixtureDelver.id, fixtureJace.id, fixtureBolt.id}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			params := url.Values{"q": {tt.q}}
			if tt.scope != "" {
				params.Set("storage_location_id", tt.scope)
			}
			status, resp, bad := s.search(t, params)
			if status != http.StatusOK {
				t.Fatalf("status = %d (%s), want 200", status, bad.Error)
			}
			if got := ids(resp); !slices.Equal(got, tt.want) {
				t.Errorf("results = %v, want %v", got, tt.want)
			}
			if resp.TotalCards != len(tt.want) {
				t.Errorf("total_cards = %d, want %d", resp.TotalCards, len(tt.want))
			}
		})
	}
}

func TestSearchCollection_ResultCarriesAllRowsAndDeck(t *testing.T) {
	s := seedCollection(t)
	_, resp, _ := s.search(t, url.Values{"q": {"!\"lightning bolt\" lang:en"}, "storage_location_id": {uintToString(s.boxA.ID)}})
	if len(resp.Data) != 1 {
		t.Fatalf("expected 1 result, got %d", len(resp.Data))
	}
	bolt := resp.Data[0]
	// The printing is in scope through box A, but its rows in box B come along.
	if len(bolt.Inventory.ThisPrinting) != 2 || bolt.Inventory.TotalQuantity != 3 {
		t.Errorf("expected both rows (3 copies), got %d rows, %d copies", len(bolt.Inventory.ThisPrinting), bolt.Inventory.TotalQuantity)
	}
	wantBolt := DeckAvailability{Owned: 4, Decked: 0, Free: 4,
		Printings: map[string]int{fixtureBolt.id: 3, fixtureBoltDE.id: 1}}
	if !reflect.DeepEqual(bolt.Deck, wantBolt) {
		t.Errorf("deck availability = %+v, want %+v (both printings)", bolt.Deck, wantBolt)
	}

	_, resp, _ = s.search(t, url.Values{"q": {"krenko"}})
	wantKrenko := DeckAvailability{Owned: 1, Decked: 1, Free: 0, Printings: map[string]int{fixtureKrenko.id: 0}}
	if len(resp.Data) != 1 || !reflect.DeepEqual(resp.Data[0].Deck, wantKrenko) {
		t.Errorf("krenko deck availability = %+v, want %+v", resp.Data, wantKrenko)
	}
}

func TestSearchCollection_FreeIsPerPrinting(t *testing.T) {
	s := seedCollection(t)
	// A deck pins all three copies of the English Bolt; the German one stays free.
	deck := models.Deck{Name: "Burn"}
	if err := s.db.Create(&deck).Error; err != nil {
		t.Fatalf("failed to create deck: %v", err)
	}
	item := models.DeckItem{DeckID: deck.ID, OracleID: fixtureBolt.oracle, ScryfallID: fixtureBolt.id,
		Zone: models.ZoneMain, DesiredQuantity: 3}
	if err := s.db.Create(&item).Error; err != nil {
		t.Fatalf("failed to create deck item: %v", err)
	}

	_, resp, _ := s.search(t, url.Values{"q": {"free>0 c:r"}})
	if got, want := ids(resp), []string{fixtureBoltDE.id}; !slices.Equal(got, want) {
		t.Errorf("free>0 = %v, want %v", got, want)
	}

	_, resp, _ = s.search(t, url.Values{"q": {"!\"lightning bolt\" lang:en"}})
	if len(resp.Data) != 1 {
		t.Fatalf("expected 1 result, got %d", len(resp.Data))
	}
	want := map[string]int{fixtureBolt.id: 0, fixtureBoltDE.id: 1}
	if got := resp.Data[0].Deck.Printings; !maps.Equal(got, want) {
		t.Errorf("deck.printings = %v, want %v", got, want)
	}
}

func TestSearchCollection_Errors(t *testing.T) {
	s := seedCollection(t)
	tests := []struct {
		name    string
		params  url.Values
		code    string
		keyword string
	}{
		{"unsupported keyword", url.Values{"q": {"art:dragon"}}, "unsupported", "art"},
		{"unknown keyword", url.Values{"q": {"foo:bar"}}, "unknown_keyword", "foo"},
		{"bad value", url.Values{"q": {"mv<="}}, "invalid_value", "mv"},
		{"syntax", url.Values{"q": {"(bolt"}}, "syntax", ""},
		{"bad scope", url.Values{"storage_location_id": {"abc"}}, "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, _, bad := s.search(t, tt.params)
			if status != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", status)
			}
			if bad.Error == "" || bad.Code != tt.code || bad.Keyword != tt.keyword {
				t.Errorf("error = %+v, want code %q keyword %q and a message", bad, tt.code, tt.keyword)
			}
		})
	}
}

// All cards rejects collection keywords before calling Scryfall.
func TestSearch_CollectionOnlyKeyword(t *testing.T) {
	app := fiber.New()
	app.Get("/api/search", (&SearchHandler{}).Search)

	resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/search?q="+url.QueryEscape("t:goblin qty>=2"), nil))
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	var bad QueryErrorResponse
	if err := json.NewDecoder(resp.Body).Decode(&bad); err != nil {
		t.Fatalf("failed to decode: %v", err)
	}
	if bad.Code != "collection_only" || bad.Keyword != "qty" || bad.Error != "`qty` only works in your collection" {
		t.Errorf("error = %+v", bad)
	}
}

func uintToString(id uint) string {
	return strconv.FormatUint(uint64(id), 10)
}
