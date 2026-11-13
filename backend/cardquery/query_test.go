package cardquery

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

// Fixtures are real Scryfall card JSON from the local catalog (testdata/).
var fixtureNames = []string{
	"angry_mob", "bolt_m11", "bolt_m11_de", "bolt_sld_foil", "borrower",
	"borrower_de", "delver", "emrakul", "fire_ice", "jace", "knuckleblade",
	"krenko", "lotus", "probe", "reckoner", "sol_ring", "tarmogoyf",
	"valakut", "wasteland",
}

// loadFixtures returns one printing per fixture, keyed by fixture name, with
// collection facts: one nonfoil copy each, except four Lightning Bolts (M11,
// foil and nonfoil), a foil copy of the foil-only Secret Lair Bolt, and two
// foil Krenkos with two copies free for decks.
func loadFixtures(t *testing.T) map[string]*Printing {
	t.Helper()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	out := map[string]*Printing{}
	for i, name := range fixtureNames {
		raw, err := os.ReadFile(filepath.Join("testdata", name+".json"))
		if err != nil {
			t.Fatalf("reading fixture %s: %v", name, err)
		}
		card, err := Decode(raw)
		if err != nil {
			t.Fatalf("decoding fixture %s: %v", name, err)
		}
		out[name] = &Printing{
			Card:     card,
			Quantity: 1,
			Finishes: []string{"nonfoil"},
			AddedAt:  base.Add(time.Duration(i) * time.Hour),
		}
	}
	out["bolt_m11"].Quantity = 4
	out["bolt_m11"].Finishes = []string{"nonfoil", "foil"}
	out["bolt_sld_foil"].Finishes = []string{"foil"}
	out["krenko"].Quantity = 2
	out["krenko"].Finishes = []string{"foil"}
	out["krenko"].Free = 2
	return out
}

func matching(t *testing.T, fixtures map[string]*Printing, q string) []string {
	t.Helper()
	query, err := Parse(q)
	if err != nil {
		t.Fatalf("Parse(%q): %v", q, err)
	}
	var names []string
	for name, p := range fixtures {
		if query.Match(p) {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	return names
}

func except(excluded ...string) string {
	var names []string
	for _, n := range fixtureNames {
		if !slices.Contains(excluded, n) {
			names = append(names, n)
		}
	}
	return strings.Join(names, " ")
}

func TestMatch(t *testing.T) {
	fixtures := loadFixtures(t)
	bolts := "bolt_m11 bolt_m11_de bolt_sld_foil"

	tests := []struct {
		query string
		want  string // fixture names, space separated
	}{
		// Names: substring, any face, localized names, accents ignored
		{"bolt", bolts},
		{"BOLT lightning", bolts},
		{"blitzschlag", "bolt_m11_de"},
		{"langfinger", "borrower_de"},
		{"insectile", "delver"},
		{"name:krenko", "krenko"},
		{`!"lightning bolt"`, bolts},
		{"!fire", "fire_ice"},
		{`!"Brazen Borrower"`, "borrower borrower_de"},
		{"!bolt", ""},

		// Type line: any face, English or printed
		{"t:goblin", "krenko"},
		{"t:legendary", "emrakul jace krenko"},
		{"t:insect", "delver"},
		{"t:adventure", "borrower borrower_de"},
		{"t:spontanzauber", "bolt_m11_de borrower_de"},
		{"t:rauber", "borrower_de"},
		{"type:Räuber", "borrower_de"},

		// Rules text: per line, reminder text skipped by o: but not fo:, ~ is the face's name
		{`o:"draw a card"`, "fire_ice probe"},
		{"o:schadenspunkte", "bolt_m11_de"},
		{`o:"~ deals 3 damage"`, bolts},
		{`o:"~ deals 2 damage"`, "fire_ice"},
		{`o:"~ gets +2/+2"`, "knuckleblade"},     // "this creature"
		{`o:"when ~ is put into"`, "emrakul"},    // short name
		{`o:"cast ~, take an extra"`, "emrakul"}, // "this spell"
		{`o:"or 2 life"`, ""},
		{`fo:"or 2 life"`, "probe"},
		{`o:"hand. draw"`, ""},

		{"kw:flying", "borrower borrower_de delver emrakul"},
		{"kw:fly", ""},
		{"ft:momentous", "delver"},
		{"ft:mirrodin", "probe"},
		{"a:moeller", "bolt_m11 bolt_m11_de"},

		// Colour: ":" means includes; front face of two-faced cards
		{"c:r", bolts + " fire_ice knuckleblade krenko reckoner valakut"},
		{"c=r", bolts + " krenko valakut"},
		{"c:u", "borrower borrower_de delver fire_ice jace knuckleblade probe"},
		{"c:c", "emrakul lotus sol_ring wasteland"},
		{"c:m", "fire_ice knuckleblade reckoner"},
		{"c=2", "fire_ice reckoner"},
		{"c:temur", "knuckleblade"},
		{"c<=ur", except("angry_mob", "knuckleblade", "reckoner", "tarmogoyf")},
		{"c!=r", except("bolt_m11", "bolt_m11_de", "bolt_sld_foil", "krenko", "valakut")},

		// Identity: ":" means fits within
		{"id:ur", except("angry_mob", "knuckleblade", "reckoner", "tarmogoyf")},
		{"id:c", "emrakul lotus sol_ring wasteland"},
		{"id>=gu", "knuckleblade"},
		{"identity:izzet", except("angry_mob", "knuckleblade", "reckoner", "tarmogoyf")},

		// Mana cost: multisets, generic compared as a number, hybrid and Phyrexian distinct
		{"m:r", bolts + " fire_ice knuckleblade krenko valakut"},
		{"m:rr", "krenko"},
		{"m:{R/W}", "reckoner"},
		{"m:{U/P}", "probe"},
		{"m:u", "borrower borrower_de delver fire_ice jace knuckleblade"},
		{"m:2", "angry_mob emrakul jace krenko valakut"},
		{"m=2WW", "angry_mob"},
		{"m<=1", "lotus sol_ring"},

		// Mana value
		{"mv=1", bolts + " delver probe sol_ring"},
		{"cmc>=4", "angry_mob emrakul fire_ice jace krenko"},
		{"mv:even", "angry_mob fire_ice jace krenko lotus tarmogoyf wasteland"},

		// Power, toughness, loyalty: any face, * is 0, null never matches
		{"pow=0", "tarmogoyf"},
		{"pow=2", "angry_mob"},
		{"pow>=5", "emrakul"},
		{"pow>tou", "borrower borrower_de delver"},
		{"tou=1", "borrower borrower_de delver tarmogoyf"},
		{"pow!=3", "angry_mob delver emrakul knuckleblade tarmogoyf"},
		{"loy=3", "jace"},
		{"pt=8", "knuckleblade"},

		// Rarity
		{"r:mythic", "borrower borrower_de emrakul jace tarmogoyf"},
		{"r:c", "bolt_m11 bolt_m11_de delver probe"},
		{"r>=rare", except("angry_mob", "bolt_m11", "bolt_m11_de", "delver", "fire_ice", "probe", "sol_ring")},

		// Set, collector number, language, year
		{"s:m11", "bolt_m11 bolt_m11_de"},
		{"e:M11", "bolt_m11 bolt_m11_de"},
		{"cn:83", "bolt_sld_foil"},
		{"cn:1", ""},
		{"cn>200", "lotus reckoner sol_ring wasteland"},
		{"lang:de", "bolt_m11_de borrower_de"},
		{"lang:german", "bolt_m11_de borrower_de"},
		{"-lang:en", "bolt_m11_de borrower_de"},
		{"lang:any bolt", bolts},
		{"year<2000", "angry_mob lotus"},
		{"year=2020", "bolt_sld_foil valakut"},

		// Legality: legal includes restricted
		{"f:vintage", except()},
		{"f:legacy", except("lotus", "probe", "sol_ring")},
		{"f:edh", except("emrakul", "lotus")},
		{"banned:commander", "emrakul lotus"},
		{"restricted:vintage", "lotus probe sol_ring"},
		{"f:pauper", bolts + " delver fire_ice"},

		// Prices: the highest price among the owned finishes; missing prices never match
		{"usd>20", "emrakul jace wasteland"},
		{"usd<1", "angry_mob delver fire_ice knuckleblade reckoner"},
		{"usd>=4.5 usd<5", "bolt_sld_foil"},
		// The M11 Bolt is owned in foil too (6.89, nonfoil 1.03)
		{"usd>5", "bolt_m11 emrakul jace tarmogoyf valakut wasteland"},
		// The foil Krenko counts as foil (3.37, nonfoil 1.66)
		{"eur>3 eur<4", "krenko probe"},
		{"eur>10000", "lotus"},
		{"tix>100", "lotus"},

		// Layout and is:
		{"layout:split", "fire_ice"},
		{"is:dfc", "delver valakut"},
		{"is:mdfc", "valakut"},
		{"is:transform", "delver"},
		{"is:adventure", "borrower borrower_de"},
		{"is:reserved", "lotus"},
		{"is:commander", "krenko"},
		{"is:reprint", "angry_mob " + bolts + " fire_ice jace reckoner sol_ring tarmogoyf wasteland"},
		{"not:reprint", "borrower borrower_de delver emrakul knuckleblade krenko lotus probe valakut"},
		{"is:foil", except("angry_mob", "fire_ice", "lotus", "sol_ring")},
		{"is:nonfoil", except("bolt_sld_foil")},

		// Print attributes
		{"wm:temur", "knuckleblade"},
		{"has:watermark", "knuckleblade probe"},
		{"border:white", "angry_mob"},
		{"frame:1993", "angry_mob lotus"},
		{"frame:inverted", "bolt_sld_foil"},

		// Collection keywords
		{"qty>=2", "bolt_m11 krenko"},
		{"finish:foil", "bolt_m11 bolt_sld_foil krenko"},
		{"finish:nonfoil", except("bolt_sld_foil", "krenko")},
		{"free>0", "krenko"},

		// Grammar: implicit AND, or, groups, negation
		{"bolt or krenko", bolts + " krenko"},
		{"t:creature (c:r or c:w)", "angry_mob knuckleblade krenko reckoner"},
		{"-t:creature c:r", bolts + " fire_ice valakut"},
		{"-(c:r or c:u)", "angry_mob emrakul lotus sol_ring tarmogoyf wasteland"},
		{"c:r OR c:g mv=2", bolts + " fire_ice knuckleblade krenko reckoner tarmogoyf valakut"},
		{"", except()},
		{"order:name", except()},
		{"order:usd direction:desc", except()},
	}

	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			got := strings.Join(matching(t, fixtures, tt.query), " ")
			want := strings.Join(strings.Fields(tt.want), " ")
			wantSorted := strings.Fields(want)
			slices.Sort(wantSorted)
			if got != strings.Join(wantSorted, " ") {
				t.Errorf("Parse(%q) matched\n  got:  %s\n  want: %s", tt.query, got, strings.Join(wantSorted, " "))
			}
		})
	}
}

func TestParseErrors(t *testing.T) {
	tests := []struct {
		query   string
		code    string
		keyword string
		message string
	}{
		{"art:foo", CodeUnsupported, "art", "`art:` isn't available in your collection"},
		{"otag:removal", CodeUnsupported, "otag", ""},
		{"o:/draw/", CodeUnsupported, "o", "Regular expressions aren't available in your collection"},
		{"is:firstprint", CodeUnsupported, "is", "`is:firstprint` isn't available in your collection"},
		{"order:penny", CodeUnsupported, "order", ""},
		{"foo:bar", CodeUnknownKeyword, "foo", "`foo:` isn't a search keyword"},
		{"mv<=", CodeInvalidValue, "mv", "Couldn't read `mv<=`: expected a number"},
		{"c:xyz", CodeInvalidValue, "c", ""},
		{"f:foobar", CodeInvalidValue, "f", ""},
		{"r:epic", CodeInvalidValue, "r", ""},
		{"lang:klingon", CodeInvalidValue, "lang", ""},
		{"layout:weird", CodeInvalidValue, "layout", ""},
		{"t>creature", CodeInvalidValue, "t", "Couldn't read `t>creature`: use `:` with `t`"},
		{"finish:shiny", CodeInvalidValue, "finish", ""},
		{"order:foo", CodeInvalidValue, "order", ""},
		{"(bolt", CodeSyntax, "", "Missing closing parenthesis"},
		{"bolt)", CodeSyntax, "", "Unexpected `)`"},
		{"or bolt", CodeSyntax, "", ""},
		{"bolt or", CodeSyntax, "", ""},
		{`"bolt`, CodeSyntax, "", "Missing closing quote"},
		{"()", CodeSyntax, "", "Empty parentheses"},
		{"bolt -", CodeSyntax, "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			_, err := Parse(tt.query)
			var qerr *Error
			if !errors.As(err, &qerr) {
				t.Fatalf("Parse(%q) error = %v, want *Error", tt.query, err)
			}
			if qerr.Code != tt.code || qerr.Keyword != tt.keyword {
				t.Errorf("Parse(%q) = code %q keyword %q, want %q %q (%s)", tt.query, qerr.Code, qerr.Keyword, tt.code, tt.keyword, qerr.Message)
			}
			if tt.message != "" && qerr.Message != tt.message {
				t.Errorf("Parse(%q) message = %q, want %q", tt.query, qerr.Message, tt.message)
			}
		})
	}
}

func TestSort(t *testing.T) {
	fixtures := loadFixtures(t)
	sorted := func(q string, names ...string) []string {
		query, err := Parse(q)
		if err != nil {
			t.Fatalf("Parse(%q): %v", q, err)
		}
		var ps []*Printing
		for _, n := range names {
			ps = append(ps, fixtures[n])
		}
		query.Sort(ps)
		var out []string
		for _, p := range ps {
			for name, f := range fixtures {
				if f == p {
					out = append(out, name)
				}
			}
		}
		return out
	}

	tests := []struct {
		query string
		in    []string
		want  []string
	}{
		// Default: newest added first (fixtures are added in list order)
		{"", []string{"angry_mob", "wasteland", "krenko"}, []string{"wasteland", "krenko", "angry_mob"}},
		{"order:name", []string{"wasteland", "angry_mob", "krenko"}, []string{"angry_mob", "krenko", "wasteland"}},
		{"order:name direction:desc", []string{"wasteland", "angry_mob", "krenko"}, []string{"wasteland", "krenko", "angry_mob"}},
		// Prices ascending, missing prices last
		{"order:usd", []string{"lotus", "jace", "angry_mob"}, []string{"angry_mob", "jace", "lotus"}},
		{"order:usd dir:desc", []string{"lotus", "angry_mob", "jace"}, []string{"jace", "angry_mob", "lotus"}},
		// Owned finishes count: the M11 Bolt (foil 6.89) and the foil Krenko (3.53)
		{"order:usd dir:desc", []string{"krenko", "lotus", "tarmogoyf", "bolt_m11"}, []string{"bolt_m11", "tarmogoyf", "krenko", "lotus"}},
		{"order:usd", []string{"lotus", "bolt_m11", "krenko", "tarmogoyf"}, []string{"krenko", "tarmogoyf", "bolt_m11", "lotus"}},
		// Released: newest first by default
		{"order:released", []string{"lotus", "valakut", "angry_mob"}, []string{"valakut", "angry_mob", "lotus"}},
		{"order:cmc", []string{"emrakul", "lotus", "krenko"}, []string{"lotus", "krenko", "emrakul"}},
		{"order:rarity", []string{"jace", "probe", "krenko"}, []string{"probe", "krenko", "jace"}},
		// Colour: white, blue, black, red, green, multicolour, colourless
		{"order:color", []string{"sol_ring", "fire_ice", "tarmogoyf", "jace", "angry_mob"}, []string{"angry_mob", "jace", "tarmogoyf", "fire_ice", "sol_ring"}},
		// Ties by name, then set and number
		{"order:cmc", []string{"bolt_sld_foil", "bolt_m11"}, []string{"bolt_m11", "bolt_sld_foil"}},
	}
	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			got := sorted(tt.query, tt.in...)
			if !slices.Equal(got, tt.want) {
				t.Errorf("Sort(%q) = %v, want %v", tt.query, got, tt.want)
			}
		})
	}
}

func TestCollectionOnlyKeyword(t *testing.T) {
	tests := map[string]string{
		"qty>=2 t:goblin":     "qty",
		"o:/regex/ free>0":    "free",
		"-finish:foil":        "finish",
		"t:goblin":            "",
		`"unterminated qty>2`: "",
		"art:dragon":          "",
	}
	for q, want := range tests {
		if got := CollectionOnlyKeyword(q); got != want {
			t.Errorf("CollectionOnlyKeyword(%q) = %q, want %q", q, got, want)
		}
	}
}

func TestFold(t *testing.T) {
	tests := map[string]string{
		"Jötun Grunt":         "jotun grunt",
		"Kreatur — Räuber":    "kreatur — rauber",
		"Lim-Dûl’s Vault":     "lim-dul's vault",
		"Lightning Bolt":      "lightning bolt",
		"Éclair de la Foudre": "eclair de la foudre",
		"稲妻":                  "稲妻",
	}
	for in, want := range tests {
		if got := fold(in); got != want {
			t.Errorf("fold(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestPricesFrom(t *testing.T) {
	p := PricesFrom("", "4.61", "", "", "7.68", "1.12")
	if v := p.byKey("usd"); v == nil || *v != 4.61 {
		t.Errorf("byKey(usd) = %v, want the foil price 4.61", v)
	}
	if v := p.byKey("eur"); v == nil || *v != 7.68 {
		t.Errorf("byKey(eur) = %v, want the foil price 7.68", v)
	}
	if v := p.byKey("tix"); v == nil || *v != 1.12 {
		t.Errorf("byKey(tix) = %v, want 1.12", v)
	}
	if p := PricesFrom("", "", "", "", "", ""); p != (Prices{}) {
		t.Errorf("PricesFrom with no prices = %+v, want all nil", p)
	}
}

func TestPrintingPrice(t *testing.T) {
	prices := PricesFrom("1.00", "5.00", "9.00", "0.80", "4.00", "0.10")
	tests := []struct {
		finishes []string
		key      string
		want     float64 // 0 means no price
	}{
		// Without finishes (no ownership data), Scryfall's price
		{nil, "usd", 1.00},
		{[]string{"nonfoil"}, "usd", 1.00},
		{[]string{"normal"}, "eur", 0.80},
		{[]string{"foil"}, "usd", 5.00},
		{[]string{"nonfoil", "foil"}, "eur", 4.00},
		{[]string{"etched"}, "usd", 9.00},
		// No EUR etched price: etched uses EUR foil
		{[]string{"etched"}, "eur", 4.00},
		{[]string{"foil", "etched"}, "usd", 9.00},
		// tix has no finishes
		{[]string{"foil"}, "tix", 0.10},
	}
	for _, tt := range tests {
		p := &Printing{Card: &Card{Prices: prices}, Finishes: tt.finishes}
		got := p.price(tt.key)
		if got == nil || *got != tt.want {
			t.Errorf("price(%s) with finishes %v = %v, want %v", tt.key, tt.finishes, got, tt.want)
		}
	}

	// An owned finish without a price has none, even if another finish has one.
	p := &Printing{Card: &Card{Prices: PricesFrom("", "5.00", "", "", "", "")}, Finishes: []string{"nonfoil"}}
	if got := p.price("usd"); got != nil {
		t.Errorf("price(usd) of a nonfoil copy without a nonfoil price = %v, want nil", *got)
	}
}
