// Command querycompare compares the local collection search with Scryfall.
//
// For each query it asks the running backend which owned printings match
// (GET /api/inventory/search), asks Scryfall the same, keeps only what you own,
// and prints the differences. Queries compare cards (oracle IDs, Scryfall's
// default one-printing-per-card search), which suits keywords about the card
// itself and keeps Scryfall's result small. Queries prefixed with "@prints "
// compare printings in every language instead, for keywords about a printing
// (set, number, language, artist, price); keep those narrow.
//
// It is a manual check for drift between the local engine (package cardquery)
// and Scryfall, not a test: Scryfall changes, and some differences are
// expected, for example cards that match only through their localized text.
//
// Usage:
//
//	go run ./cmd/querycompare [-backend http://localhost:3000] [-queries file] [-max-pages 10]
//
// Scryfall is asked to include extras such as tokens, which the collection
// holds and Scryfall hides by default. It only reads from the backend. Scryfall is queried through the app's
// client, rate-limited to 1 request/s.
package main

import (
	"bufio"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"time"

	"backend/scryfall"

	goscryfall "github.com/BlueMonday/go-scryfall"
)

//go:embed queries.txt
var defaultQueries string

type printing struct {
	ID              string `json:"id"`
	OracleID        string `json:"oracle_id"`
	Name            string `json:"name"`
	SetCode         string `json:"set_code"`
	CollectorNumber string `json:"collector_number"`
	Language        string `json:"language"`
}

func (p printing) String() string {
	return fmt.Sprintf("%s (%s #%s, %s)", p.Name, strings.ToUpper(p.SetCode), p.CollectorNumber, p.Language)
}

func main() {
	backend := flag.String("backend", "http://localhost:3000", "URL of the running ShowMyCards backend")
	queriesFile := flag.String("queries", "", "file with one query per line (default: the built-in list)")
	maxPages := flag.Int("max-pages", 10, "skip queries with more Scryfall result pages than this")
	flag.Parse()

	if err := run(*backend, *queriesFile, *maxPages); err != nil {
		fmt.Fprintln(os.Stderr, "querycompare:", err)
		os.Exit(1)
	}
}

func run(backend, queriesFile string, maxPages int) error {
	queries := defaultQueries
	if queriesFile != "" {
		data, err := os.ReadFile(queriesFile)
		if err != nil {
			return err
		}
		queries = string(data)
	}

	owned, err := searchLocal(backend, "")
	if err != nil {
		return fmt.Errorf("loading the collection: %w", err)
	}
	// What you own, by printing ID and by oracle ID, for naming differences.
	ownedPrints := make(map[string]printing, len(owned))
	ownedCards := make(map[string]printing, len(owned))
	for _, p := range owned {
		ownedPrints[p.ID] = p
		ownedCards[p.OracleID] = p
	}
	fmt.Printf("%d owned printings of %d cards\n\n", len(ownedPrints), len(ownedCards))

	client, err := scryfall.NewClient()
	if err != nil {
		return err
	}
	defer client.Close()

	var compared, differing, skipped int
	scanner := bufio.NewScanner(strings.NewReader(queries))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		q, byPrint := strings.CutPrefix(line, "@prints ")

		local, err := searchLocal(backend, q)
		if err != nil {
			fmt.Printf("%-50s  local error: %v\n", line, err)
			skipped++
			continue
		}
		remote, complete, err := searchScryfall(client, q, byPrint, maxPages)
		if err != nil {
			fmt.Printf("%-50s  Scryfall error: %v\n", line, err)
			skipped++
			continue
		}
		if !complete {
			fmt.Printf("%-50s  skipped: more than %d Scryfall pages\n", line, maxPages)
			skipped++
			continue
		}

		// Compare keys: printing IDs, or oracle IDs.
		ownedByKey, key := ownedCards, func(p printing) string { return p.OracleID }
		if byPrint {
			ownedByKey, key = ownedPrints, func(p printing) string { return p.ID }
		}
		localKeys := map[string]printing{}
		for _, p := range local {
			localKeys[key(p)] = p
		}
		var onlyLocal, onlyScryfall []string
		for k, p := range localKeys {
			if !remote[k] {
				onlyLocal = append(onlyLocal, p.String())
			}
		}
		remoteOwned := 0
		for k := range remote {
			p, isOwned := ownedByKey[k]
			if !isOwned {
				continue
			}
			remoteOwned++
			if _, ok := localKeys[k]; !ok {
				onlyScryfall = append(onlyScryfall, p.String())
			}
		}

		compared++
		status := "same"
		if len(onlyLocal) > 0 || len(onlyScryfall) > 0 {
			status = "DIFFERENT"
			differing++
		}
		unit := "cards"
		if byPrint {
			unit = "prints"
		}
		fmt.Printf("%-50s  %-6s local %3d  Scryfall %3d  %s\n", line, unit, len(localKeys), remoteOwned, status)
		slices.Sort(onlyLocal)
		slices.Sort(onlyScryfall)
		for _, p := range onlyLocal {
			fmt.Printf("    only local:    %s\n", p)
		}
		for _, p := range onlyScryfall {
			fmt.Printf("    only Scryfall: %s\n", p)
		}
	}
	fmt.Printf("\n%d compared, %d different, %d skipped\n", compared, differing, skipped)
	return scanner.Err()
}

// searchLocal runs a query on the backend's collection search.
func searchLocal(backend, q string) ([]printing, error) {
	resp, err := http.Get(backend + "/api/inventory/search?q=" + url.QueryEscape(q))
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var result struct {
		Data []printing `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}
	return result.Data, nil
}

// searchScryfall returns what Scryfall matches: oracle IDs from its default
// search (one printing per card), or with byPrint the IDs of every printing in
// any language. complete is false when there are more than maxPages pages.
func searchScryfall(client *scryfall.Client, q string, byPrint bool, maxPages int) (ids map[string]bool, complete bool, err error) {
	// The collection holds tokens and other extras, which Scryfall hides by default.
	q += " include:extras"
	opts := scryfall.SearchOptions{}
	if byPrint {
		q += " lang:any"
		opts.UniqueMode = goscryfall.UniqueModePrints
	}
	ids = map[string]bool{}
	for page := 1; page <= maxPages; page++ {
		opts.Page = page
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		result, err := client.SearchWithOptions(ctx, q, opts)
		cancel()
		var scryfallErr *goscryfall.Error
		if errors.As(err, &scryfallErr) && scryfallErr.Status == http.StatusNotFound {
			return ids, true, nil // no matches
		}
		if err != nil {
			return nil, false, err
		}
		for _, c := range result.Cards {
			if byPrint {
				ids[c.ID] = true
			} else {
				ids[c.OracleID] = true
			}
		}
		if !result.HasMore {
			return ids, true, nil
		}
	}
	return ids, false, nil
}
