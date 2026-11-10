# Design proposal: converging cards, collection, decks and Scryfall data

> **Where this file lives:** `docs/cards-convergence-proposal.md`, versioned on the `prototype/cards-page` branch. It started as an untracked note in `.scratch/` and moved on 2026-11-10.
>
> **Status (2026-11-10):** The design below was validated with a throwaway UI prototype. The user's verdicts, the decisions they settled, and the facts found along the way are in [Prototype results](#prototype-results-2026-11-10) at the end of this file. Where they differ from the proposal, the prototype results win: they are the user's later decisions.

## Context (proposal)

Today the app has three overlapping ways of looking at a card, and each grew its own UI:

- **Search** (`/search`) queries Scryfall live (`backend/api/search.go:94`), then adds owned copies from local `inventory` on top.
- **Inventory** (`/inventory/*`) reads local rows and joins card data from the local bulk `cards` table (`backend/api/inventory.go:323`). It reuses the same `EnhancedCardResult` type, but `total_quantity` means something different there.
- **Decks and Lists** each have their own item DTO, tile, table, and add-card search. Decks derive "owned" from inventory. Lists keep a hand-typed `collected_quantity` that is never linked to inventory.

Symptoms the user sees:
- The same tile (`CardResultCard`) offers different actions on each page.
- There are four table implementations and four tile designs.
- Two price sources (live and the bulk snapshot) can disagree.
- `/cards/[id]` is a read-only dead end.
- Deck and list "add card" search is typed as raw `ScryfallCard` while the backend returns `CardResult`, so `DeckAddResultCard` shows no image and no set code (`DeckAddResultCard.svelte:22,73`).
- Counts mix rows, stacks and copies.
- An unused abstraction, `components/card-collection/` (`DisplayableCard` plus adapters), shows that a frontend-only convergence was already tried and not adopted.

**Decisions already made by the user:**
1. Build one **Cards** page with a scope switch, replacing separate Search and Inventory browsing.
2. ~~**Avoid implementing Scryfall syntax locally.**~~ Reversed on 2026-11-10: collection scopes get a local Scryfall-syntax engine (see §4).
3. **Merge Lists into Decks.**
4. This document is a **design proposal only**, with no implementation detail.

---

## 1. Target model: three layers, one overlay

| Layer | What it is | Source of truth | Mutable by user |
|---|---|---|---|
| **Catalog** | Every printing that exists | Local mirror of Scryfall bulk data (`cards` table). Scryfall live is used only for discovery and for printings the bulk sync has not picked up yet. | No |
| **Collection** | Physical copies and where they are | `inventory` + `storage_locations` + sorting rules | Yes |
| **Wants** | Cards you intend to have: decks and wishlists | `decks` + `deck_items` (absorbing lists) | Yes |

Every place that shows a card renders **catalog data + the same ownership overlay**:
- owned copies of this printing, by finish and location;
- owned copies of the card across all printings;
- free and decked counts;
- which decks or wishlists want it.

The overlay is computed in exactly one place on the backend and looks the same in every view.

**Vocabulary.** Record this in a new `CONTEXT.md` (using the `domain-modeling` skill), and fix the drift in `backend/CLAUDE.md`.
- **card** = an oracle card.
- **printing** = a Scryfall ID.
- **finish** = nonfoil, foil, or etched. Use "finish" in the UI. `treatment` stays as the backend field.
- **copy** = one physical card.
- **stack** = the copies of one printing in one finish at one location.
- **location** = a storage location.
- **deck** and **wishlist** are the two kinds of want list.
- **demand**, **free**, and **missing** describe how wants compare to the collection.

Counts in the UI must always say which unit they use (cards, printings, stacks, or copies).

---

## 2. One card shape from the backend

Problem:
- `EnhancedCardResult`, `InventoryCard`, `EnrichedDeckItem` and `EnrichedListItem` all carry partial, differently named card fields.
- Prices are a string object in some shapes and a float in others.
- Two different scopes are both called `total_quantity`.

Proposal:
- Use a single `CardView = { card: CardSummary, owned: Ownership }`.
- Context-specific data sits **next to** that pair, never mixed into it. For example, a collection row adds `stack: {id, location, finish, quantity}`, and a deck row adds `item: {zone, desired, pinned}`.
- One Go mapper builds `CardSummary` from the local `cards.raw_json`. It replaces the separate enrichment code in `api/card_mapper.go`, `api/decks.go:478,537`, and `api/lists.go:348`.
- One overlay function builds `Ownership`. It merges the search overlay (`search.go:154-203`), the inventory overlay (`inventory.go:305`), and `services/allocation.go`.
- **Hydrate search locally.** Scryfall returns the matching IDs and their order. Card data and prices then come from the local catalog through the same mapper. This gives one price source and identical tiles.
  - If a printing is missing locally (for example a fresh spoiler before the next daily sync), fall back to the live payload.
  - `/api/cards/:id` reads from the local catalog first as well, which means fewer outbound calls under the 1 RPS limit.
- Once `CardView` is shared, the frontend no longer needs an adapter layer. Delete `card-collection/` and keep only `ViewToggle`, `CardFilter` and `isFoilTreatment`, moved to their own homes.

---

## 3. One Cards page with a scope dropdown

> Updated 2026-11-10 after the grilling session: one **scope dropdown** replaces the source switch and the location filter. See "Merged scope and local search" in the Prototype results.

The page has one route (for example `/cards`), one search field and one browser shell. It generalizes today's `InventoryBrowser.svelte`. A single dropdown picks the scope:
- `All cards`
- `My collection` (the default)
- each location
- `Unassigned`

The query is kept when the scope changes, and search runs on Enter.

| Scope | Rows are | Query | Count shown |
|---|---|---|---|
| **All cards** | Scryfall results: one printing per card, in the default language, with ownership badges | Scryfall syntax, sent to Scryfall | Scryfall's `total_cards` |
| **My collection**, **a location**, **Unassigned** | owned printings, aggregated over finishes and locations (the location scopes count only that location) | Scryfall syntax, evaluated locally (see §4), plus `finish:`, `qty`, `free` | physical copies (the unit of the storage overview) |
| **Missing** (later) | wanted cards whose demand exceeds owned copies, across all decks and wishlists | local | |

These views become presets of the Cards page:
- `/inventory/[location]`, `/inventory/unassigned`, `/inventory/all` and `/inventory/recent` (Collection, with sort by newest).
- The deck "Add cards" panel and the "add from inventory" flow.

The storage index (locations with counts and "Browse") stays as the Collection landing view.

Requirements this places on the collection scopes:
- **Server-side filtering, with all matches in one response** (decided 2026-11-10). Each owned printing appears once, with its stacks and deck availability, and the page renders it in slices of 60. This replaces the loaders that fetch every page and merge or concatenate them (`lib/server/inventory-cards.ts`, `inventory/unassigned`, `inventory/[id]`). Paging can come later if collections grow into the tens of thousands.
- **One row per stack.** Make `inventory` unique on (printing, finish, location) and merge rows on create, with a migration that merges existing duplicates.
  - This fixes paging by rows (`inventory.go:~370`), duplicate tiles across page boundaries, and the mismatch between row and copy counts.
  - It also makes `SplitMove` and the "−" button deterministic, because "first row with that finish" stops being ambiguous.

---

## 4. Scryfall syntax on the collection: a local engine

> Rewritten 2026-11-10. The earlier version proposed structured facets compiled to expr-lang, with no parser, because the user first wanted to avoid implementing Scryfall syntax locally. The user has since reversed that: Scryfall syntax should work on the collection too.

- **Collection scopes** (My collection, a location, Unassigned) evaluate Scryfall syntax **locally**, in Go:
  - The query is parsed to an AST and evaluated directly over a per-printing struct.
  - The struct is built once from the stored `raw_json`. It extends the field extraction in `backend/rules/converter.go` (`RawJSONToRuleData`) with legalities, `lang`, `released_at`, `printed_name`/`printed_type_line`/`printed_text`, per-face text, `flavor_text` and `watermark`, plus collection data: finishes, quantity, and `free` from `services/allocation.go`.
  - Queries are **not** compiled to expr-lang or SQL. Evaluating ~1,200 printings in Go is instant, and Scryfall's meanings (colour comparisons, `*` power, two-faced cards) are easiest to get right in plain Go code.
- **All cards** keeps sending the query to Scryfall: exact behaviour, every keyword, and Scryfall's per-card grouping and ordering. Moving it onto the local engine (the full catalog is already local: 548k printings) is a later, separate decision; it needs indexed columns and per-card grouping.
- **First-version keywords**, the ones card JSON can answer:
  - **Names:** plain words, `!"exact"`.
  - **Text:** `t:`, `o:`, `kw:`, `ft:`.
  - **Colour and mana:** `c:`, `id:`, `m:`, `mv`.
  - **Stats:** `pow`, `tou`, `loy`.
  - **Printing:** `r:`, `s:`/`set:`, `cn:`, `a:`, `lang:`, `year`.
  - **Other:** `f:`/`legal:`, `usd`/`eur`, `layout:`.
  - **`is:` subset:** `promo`, `reprint`, `fullart`, `reserved`, the double-faced types, `commander`.
  - **Syntax:** `-`, `or`, parentheses, `order:`/`direction:`.
- **Not supported locally:** regular expressions, display keywords, and keywords that need data outside the card JSON:
  - `art:`/`atag:` and `function:`/`otag:` (Scryfall's tags);
  - `cube:` and `block:`;
  - the cross-printing keywords `cheapest:`, `new:`, `unique:` and `is:firstprint`.
- **Collection-only keywords:**
  - `finish:foil|nonfoil|etched` matches the finish of your copies.
  - `qty>=N` matches by copies owned.
  - `free>0` matches copies free for decks, counted per card like the deck badge and today's "available for deck building" filter.
- **Language:** collection queries match English **and** localized text, for names, the type line (`t:Kreatur`) and oracle or printed text (`o:"Karte ziehen"`). On two-faced cards any face can match, as on Scryfall. All cards behaves as Scryfall does.
- **Errors:** an unsupported keyword, a collection keyword in All cards, or invalid syntax shows no results and one line of explanation, with a link to the other scope where that helps.
  - Example: "`art:` isn't available in your collection · Search All cards instead".
  - Example: "Couldn't read `mv<=`: expected a number".
- **Sort:** without `order:`, the collection is newest first and All cards uses Scryfall's order.
- **Sorting rules:** rules that use Scryfall syntax come **later**, as their own step. They can reuse the same AST, so expr-lang stays as it is until then.
- **Validation:**
  - **Unit tests:** table-driven, per keyword, on fixture cards.
  - **Manual comparison script:** about 30 narrow queries, each run against Scryfall (results filtered to owned cards, at 1 request/s, not in CI) and against the local engine, with the differences printed.
- **Why not filter Scryfall's results down to owned cards?** Broad queries are far too slow at 1 request/s. `t:creature` is 107 pages (about 2 min), and `t:creature lang:de unique:prints` is 169 pages. In addition, printing-specific terms would be checked against Scryfall's chosen printing, not the user's.
- **No library to reuse:**
  - No maintained Go or Rust parser or evaluator exists.
  - `jnovack/scryfall-query-dsl` (MIT, JavaScript) only compiles to Elasticsearch, and covers 42 of 98 keywords.
  - The deckbelcher TypeScript parser is a reference only; its licence was not verified.
  - Scryfall publishes no formal grammar.

---

## 5. Lists merge into Decks ("want lists")

- **Data model.** Add `kind` to `decks`: `deck` or `wishlist`.
  - Deck items already model everything a list item needs: an oracle, an optional pinned printing, an optional finish, and a desired quantity.
  - Wishlists use a single implicit zone.
- **Progress is derived, never typed.**
  - Decks keep their oracle-level allocation semantics, and their items count as demand.
  - Wishlist items are satisfied by owned copies at the printing+finish level when pinned, otherwise at the oracle level. They **do not** create demand or reduce free copies.
- **One page and one item component** for both kinds. Zones, stacks view and format concerns show only for `kind=deck`.
- **The "Missing" source (§3)** becomes the cross-cutting shopping list across both kinds.
- **Migration.** Move `list_items` into `deck_items` with `kind=wishlist`, `zone=main`, and the printing and finish pinned. Then drop `lists`, `list_items`, `ListCardGrid`, `ListCardTable`, `ListSearchResults` and `ListStatsBar`.
- **Prerequisite:** export and backup must include decks first. `ExportData` (`backend/api/data.go:33`) covers lists but not decks, and the scheduled backup uses it. Without this fix, the merge would remove wishlists from backups.

---

## 6. One way to act on a card

- **One tile and one table row.** Both show the same anatomy and the same overlay badge. The page decides only which *primary* control is shown inline:
  - Collection: +/− copies.
  - Deck: desired quantity.
  - Picker: add.
  
  Everything else lives in a single card action menu that is identical everywhere: add to collection, add to deck or wishlist, move, open details.
- **One "Add" popover** replaces the per-tile storage dropdown, `PrintingConflictModal` and `DeckAddResultCard`. Its fields:
  - finish (from the card's finishes) and quantity;
  - destination: Collection (location = Auto rules, Next to existing copies, or a specific location) or a deck or wishlist (with zone).
  
  The "you already own this" case becomes the inline default "next to existing copies", instead of a modal on every extra copy.
- **`/cards/[id]` becomes the hub** instead of a dead end:
  - per-finish, per-location stacks with +/− and move;
  - "Wanted by" (decks and wishlists) with add;
  - other printings with their overlay.
  
  It reads from the local catalog.
- **Import** reuses the same Add destination model and the per-line conflict defaults, rather than one storage choice for every line.
- **Write-path rule.**
  - Card-level mutations in shared components go through `apiClient` to the `/api` proxy, so they work on any page without per-page form actions.
  - Page-level CRUD forms (create or edit deck, location, rule) keep SvelteKit form actions.
  
  This retires `lib/server/inventory-actions.ts` being duplicated into every page, and the separate `/decks/[id]/items` route.

---

## 7. Navigation

Group the 10 flat sidebar items (`frontend/src/lib/data/navigation.ts`):
- **Cards**: the unified browser. The navbar search box lands here.
- **Collection**: Locations (index plus per-location presets), Sorting rules, Import.
- **Decks & wishlists**.
- **System**: Jobs, Settings.

The dashboard stays as the home page. Align the naming drift ("Storage Rules" vs "Sorting Rules", "Storage" vs "Storage Locations").

---

## 8. Cleanup that falls out of this

- `components/card-collection/` (except the parts that move out), `composables/useAsyncAction`, unused `listsApi`/`storageApi`/`inventoryApi` methods, `routes/rules/+page.svelte.backup`.
- The hand-written `ScryfallCard` type (`types/runtime.ts:27`), wherever backend results are mislabeled with it.
- Page wrapper, stats, error-display and localStorage-key inconsistencies, fixed as each page moves onto the shared shell.

---

## Suggested order (coarse)

1. **Vocabulary and safety net.** `CONTEXT.md`; include decks in export and backup; fix the deck-search typing bug.
2. **Collection search engine** (added 2026-11-10, see §4).
   - **What it adds:** a collection endpoint that takes `q` and returns every matching owned printing once, with stacks and deck availability, plus the Go parser and evaluator, their unit tests and the comparison script.
   - **First users:** today's inventory pages. Their loaders switch to the endpoint, which ends the duplicate entries across pages, and their filter box accepts Scryfall syntax.
3. **Backend `CardView` and overlay**, with local hydration of search results; regenerate types.
4. **Shared tile, table, browser shell and Add popover.** Move Search and the Inventory presets onto them, and turn card detail into the hub.
5. **Stack uniqueness migration**, then the single Cards page with the scope dropdown (using the step 2 endpoint for collection scopes) and the navigation regroup.
6. **Lists merge into Decks** (`kind=wishlist`), add the Missing scope, and remove the list code.
7. **Later, each its own decision:** sorting rules accepting Scryfall syntax (reusing the step 2 AST), and moving All cards onto the local engine.

Each step ships on its own and leaves the app consistent.

## Open questions and risks

- **Merging lists drops `collected_quantity`.** Users may have counted copies they never entered into inventory. Options: a one-time reconciliation report, or creating unassigned inventory rows for `collected − owned`. This needs a decision before step 5.
- **Merging inventory into one row per stack** changes inventory IDs. Check the effect on bookmarks or links and on `SplitMove`'s assumptions.
- **Deck ownership is oracle-level and finish-blind.** Should a pinned printing or finish that you don't own count as missing? This is out of scope here, but the shared overlay makes the question visible.
- **Catalog freshness.** Hydrating locally depends on the daily bulk sync. The live fallback covers new printings, but those few cards will still show live prices.
- **All cards on the local engine?** Deferred (decided 2026-11-10). It would give identical results in every scope and remove the 1 request/s paging. It needs indexed or generated columns over 548k printings, a per-card "one printing in your language" grouping, and Scryfall's ordering.
- **Local engine drift.** The local engine can drift from Scryfall's semantics. The comparison script in §4 is the guard; run it when Scryfall changes its syntax.

## Validating the design (before committing to implementation)

- Build a throwaway prototype of the unified Cards page and the Add popover with the `prototype` skill, using real exported data. Check that the source switch and the action menu feel right. (Done on 2026-11-10; see Prototype results. The source switch became a scope dropdown.)
- Confirm in the running app the friction points that exploration inferred from code. The plan already relies on them.
  - "+" in Auto mode opens the conflict modal for an owned card.
  - "+" on `/inventory/[id]` does not add to that location.
  - Duplicate tiles appear when unassigned rows span pages.
  - Count mismatch between `/inventory` and `/inventory/[id]`.

---

# Prototype results (2026-11-10)

This section records what the user decided while trying the prototype of the unified Cards page, plus facts about the code and data found along the way. It is written for an agent picking up the implementation. Observations from real data are given as rates or examples, not as details of any one collection.

## Where the work is

- **Branch:** `prototype/cards-page`, created from `main`. The user commits only when asked. Commits so far:
  - `8d7c8c4` "search prototype, split between collection and catalog": the two-tab version, plus the backend card-text fields.
  - `ebe70c9` "merge collection and catalog view": the scope dropdown and search on Enter.
  - `b8761ad` "make prototype work with real data for further exploration": real writes, the backend additions, the default `/search` route and the Move menu.
- **Run it:** `make dev-backend` and `make dev-frontend`, then open `http://localhost:5173/search`. On this branch `/search` **is** the Cards page, in dev and production builds alike, and `?variant=current` shows today's search page. A floating pill toggles between the two; ←/→ does the same when focus is not in an input.
- **Writes are real** (since 2026-11-10; see "Usable on real data" below). Add copies with Undo, −/+, Move and Add to deck save to the backend.
- **Losing variants:** the overlay-drawer and bottom-sheet variants were deleted before the first commit. A local, unversioned copy of all three variants, plus a patch of the tracked files at that point, is in `.scratch/cards-prototype-all-variants/` on the user's machine.
- **Capture:** the `prototype` skill says to commit the full prototype to the throwaway branch, record the verdict, and fold only the validated decisions into `main`.
  - The branch commits above capture the prototype.
  - Folding the validated decisions into `main` is still pending; see "Suggested order".

### Prototype files (throwaway, except where marked)

| File | Role |
|---|---|
| `frontend/src/routes/search/prototype/state.svelte.ts` | `CardsView` (source, query, scope, selection, catalog paging, result counts, `forDecks()`), the `live` store of data re-read after writes, the write actions (`addCopy`, `removeCopy`, `undoAdd`, `moveStack`, `refreshCard`), and helpers such as `effectiveStacks`, `ownedCount`, `existingLocation` and `resolveAuto` |
| `.../prototype/stacks.ts` (+ `stacks.test.ts`) | Pure helpers: `aggregateStacks`, `rowsOfStack`, `pickRowToDecrement` |
| `.../prototype/MoveMenu.svelte` | The Move icon's DaisyUI dropdown of target locations |
| `.../prototype/CardsHeader.svelte` | Search input (applied on Enter), scope dropdown (All cards / My collection / locations / Unassigned), result counter |
| `.../prototype/CardGrid.svelte` | Infinite-scroll grid |
| `.../prototype/CardTile.svelte` | Tile: image, caption, deck badge, owned badge, hover "+" |
| `.../prototype/AddPopover.svelte` | Add popover: finish buttons, destination picker, tally with Undo |
| `.../prototype/CardPanel.svelte` | Detail panel; also holds the oracle-text parser (symbols, reminder text) |
| `.../prototype/VariantPush.svelte` | The winning layout: grid plus a sticky 380px panel beside it |
| `frontend/src/lib/components/PrototypeSwitcher.svelte` | Floating switcher between the Cards page and `?variant=current`. On this branch it ships in production builds too |
| `frontend/src/routes/search/+page.server.ts` | `loadPrototype()`: Collection loads every owned printing; Catalog loads the first `/api/search` page; both build an oracle → deck-availability map from `/api/inventory/cards` |
| `frontend/src/routes/search/+page.svelte` | Renders the prototype unless `?variant=current`, in which case it renders today's page (the large diff is mostly re-indentation) |
| `frontend/src/lib/components/SearchControl.svelte` | In the prototype, the navbar search goes to the All cards scope (`source=catalog`) |
| **Keep:** `backend/api/card_mapper.go`, `card_mapper_test.go`, `search.go`, `frontend/src/lib/types/api.ts`, `frontend/src/lib/utils/card-name.ts` | Real API additions; see "Backend changes" below |
| **Keep:** `backend/api/inventory.go`, `inventory_merge_test.go`, `server/inventory_routes.go` | Create flags `merge`/`unassigned`, the auto-location preview and per-card availability; see "Usable on real data" below |

## Decisions the user settled

These override the proposal where they differ.

### Layout
- **Push-aside detail panel wins** over an overlay drawer and a bottom sheet. The panel sits beside the grid, which narrows and reflows. It is sticky and 380px wide.
- **The panel is non-modal.** The grid stays interactive. Clicking another tile swaps the panel; Esc or × closes it. Esc closes an open Add popover first.
- **Card size must be readable: 4 columns at 1440px.** Six columns was rejected as too small. Implementation: `grid-cols-[repeat(auto-fill,minmax(16.5rem,1fr))]` (2 columns below `sm`). That gives 4 columns at 1440px whether the sidebar is collapsed (56px) or expanded (256px), and 3 or 2 columns while the panel is open. Wider screens get 5.
- **Clean, minimal UI is a standing preference.** Show only what is needed, and put details behind the panel. Hide empty sections rather than rendering empty states. Minimal does not mean small: cards must stay readable.

### Page chrome
- The page has only a search input, a scope dropdown, and a result counter. This replaced the original `Collection | Catalog` switch and the location select; see "Merged scope and local search" below. It has no stats row, grid/table toggle, owned/not-owned post-filter, "Advanced" builder, language selector or per-tile storage dropdown.
- **Result counter.** It sits at the right end of the header row and shows quiet text such as "120 cards".
  - **Collection:** the number of physical copies matching the name and location filter. This is the same unit as `card_count` on the storage overview (`GET /api/storage/with-counts`, `SUM(quantity)`). Its tooltip says "N copies in M printings". Verified: a location's count equals its storage-overview count, and the sum over all locations plus unassigned equals the total.
  - **Catalog:** Scryfall's `total_cards` for the query, not just the loaded pages.
  - **Hidden** when the count is 0.
- **Scopes:**
  - The page lands in "My collection" (all owned printings, newest first).
  - The query is kept when the scope changes.
  - The navbar search goes to "All cards".
  - State lives in the URL (`?source=&q=&location=`; the dropdown maps onto these).
  - Every scope scrolls infinitely.
- **Collection name filter** matches the English name and the printed (localized) name, like today's search page.

### Tile
- The tile shows the image, then one caption row: `Name · SET`, with a deck badge and an owned badge at the right.
  - **Name:** the printed (localized) name, via `getDisplayName`.
  - **Set code:** muted text.
- **Owned badge:** a solid primary count for this printing, aggregated over finishes and locations. In a location-filtered Collection it counts only that location. In Catalog, a faint outline dot means "you own only other printings".
- **Deck badge (user request):** "how many of my copies are available for deck building".
  - **Look:** the Lucide `Layers` icon (the sidebar's Decks icon) plus the free count. Green when free > 0; a grey 0 when every copy is in decks; hidden when no printing of the card is owned.
  - **Unit:** the count is per card (oracle), not per printing, matching the backend allocation (`InventoryCard.deck.free`). It can exceed the printing's owned count.
  - **Catalog:** the badge also shows there, which repeats it on every printing of an owned card.
  - **Not yet decided:** whether to cap it at the printing's count, and whether to keep it in Catalog.
- On hover, a single "+" opens the Add popover. Clicking anywhere else on the tile opens the panel.

### Add popover
- Collection only; adding to a deck lives in the panel.
- One button per finish (from `getAvailableTreatments`); each click adds one copy, and the popover stays open.
- One destination line shows the **resolved** location, with a picker offering "Next to your copies" (the default when the card is already owned), "Auto (rules) → X", each location, and Unassigned.
- A running tally ("Added 2× Foil") with Undo.

### Detail panel (top to bottom; empty sections hidden)
1. **Header:** localized name, set name · #collector number, and a compact price per finish. No card image: the user removed it, since it repeated the large tile.
2. **Card text,** in the card's language (see "Card language" below).
   - Mana symbols, {T} and {Q} render as Mana-font icons.
   - Reminder text in parentheses is muted and italic.
   - Multi-face cards show each face in order, separated by a thin rule. The rule is quite faint in the dark theme.
3. **Your copies:** one row per finish × location, with −/+ and Move (Move moves the whole stack).
4. **In decks:** deck name and quantity. When empty, the section is just a quiet "Add to deck" link.
5. **Other printings:** a thumbnail strip with the owned badge, loaded when the panel opens and cached per oracle. Clicking a thumbnail shows that printing.

### Card language
- The user wants panel text in the card's language: name and card text in German for German printings.
- English is used only where Scryfall has no translation, and per face for multi-face cards, so no face is dropped.

## Backend changes made (real API additions: keep them)

All card responses (search, `/api/cards/:id`, inventory cards, resolve) build their card through `BuildCardResult` in `backend/api/card_mapper.go`, so these fields reach every page.

- **`CardResult.oracle_text`:** the English Oracle text. Multi-face cards join their faces' text with `"\n//\n"`.
- **`CardResult.printed_text`:** the text as printed, in the card's language. It is empty for English cards.
  - **Single-face cards:** Scryfall's top-level `printed_text`.
  - **Multi-face cards:** each face's `printed_text`, falling back to that face's English `oracle_text`. The value is empty when no face is localized.
- **`CardResult.printed_name` now covers multi-face cards.**
  - **Source:** the top-level `printed_name` if set; otherwise each face's `printed_name`, joined with `" // "` and falling back to that face's English name.
  - **Effect beyond the prototype:** today's tiles and card page use `getDisplayName`, so localized multi-face names now appear there too. The comment in `frontend/src/lib/utils/card-name.ts` was updated to match.
- **Helpers in `card_mapper.go`:** `deref`, `joinFaces`, `joinLocalizedFaces`, `cardOracleText`, `cardPrintedText`, `cardPrintedName`. Tests are in `card_mapper_test.go` and cover single-face, multi-face, partly translated and English cards.
- **Types** were regenerated with `make types`; only these fields changed in `frontend/src/lib/types/api.ts`.
- **Tygo gotcha:** an unexported `const ( … )` block in `backend/api` makes tygo emit an empty `// source: <file>.go` section. Don't put const blocks in that package's files unless they are meant for export.
- **Payload:** inventory responses grow by roughly a paragraph of text per card. That is acceptable locally.

## Merged scope and local search (grilling, 2026-11-10)

The user asked why Collection and Catalog are separate views when Catalog badges already show ownership, and whether Scryfall syntax could work on the collection.

**The answer:** the split came from the search engines, not from user needs.
- **Collection** was local and instant, but matched names only.
- **Catalog** was Scryfall live, with syntax but no way to restrict to the collection.

**Two facts settled it:**
- **The whole catalog is already local.** The `cards` table holds Scryfall's `all_cards` bulk data: 548,247 printings, 39,505 cards, all languages (as of November 2026), refreshed by the daily bulk sync.
- **Filtering Scryfall results down to owned cards does not scale.** Scryfall pages (175 results each) at the app's 1 request/s:

| Query | `total_cards` | Pages |
|---|---|---|
| `t:dragon c:r game:paper` | 255 | 2 |
| `c:r t:instant game:paper` | 857 | 5 |
| `o:"draw a card" game:paper` | 2,556 | 15 |
| `t:creature game:paper` | 18,576 | 107 |
| `t:creature game:paper lang:de unique:prints` | 29,512 | 169 |

Relevant settings: `scryfall_unique_mode`, `scryfall_default_language` and `scryfall_default_search` decide what All cards returns: one printing per card or every printing, in which language, and with which default filter (for example `game:paper`).

**Decisions:**

| # | Decision |
|---|---|
| 1 | **One list, one scope dropdown** in place of the tabs and the location dropdown: `All cards`, `My collection` (default), each location, `Unassigned`. The query is kept and reruns on a scope change. The counter shows copies in collection scopes and Scryfall's total in All cards. |
| 2 | **This session's deliverable:** the decisions plus the merged layout in the prototype. The prototype's search engine is unchanged (name matching for the collection). |
| 3 | **Collection scopes get a local Scryfall-syntax engine.** This reverses the earlier "no local Scryfall subset" decision. |
| 4 | **All cards keeps Scryfall.** The local engine for All cards is a later decision. |
| 5 | **Collection matching covers English and localized text,** for names, type line and text. Any face can match. |
| 6 | **Search runs on Enter** in every scope. |
| 7 | **Unsupported keyword, collection keyword in All cards, or invalid syntax:** no results, one explanatory line, and a link to the other scope where useful. |
| 8 | **First-version keywords:** the list in §4. |
| 9 | **Collection-only keywords:** `finish:`, `qty`, `free`. |
| 10 | **Engine design:** a Go AST evaluator over a per-printing struct built from `raw_json`. No expr-lang or SQL compilation. |
| 11 | **Sorting rules with Scryfall syntax come later,** reusing the AST. |
| 12 | **The collection endpoint returns all matches in one response,** with each printing once. This replaces `fetchAllInventoryCards`, which receives the same printing on several pages. |
| 13 | **The engine is its own step,** right after "vocabulary and safety net". Today's inventory pages use it first. |
| 14 | **Validation:** per-keyword unit tests plus a manual comparison script against Scryfall. |

**Research behind decisions 8 and 10:**
- **Existing parsers:**
  - No maintained Go or Rust parser or evaluator exists.
  - [`jnovack/scryfall-query-dsl`](https://github.com/jnovack/scryfall-query-dsl) (npm `scryfall-query-dsl` 0.2.0-rc.1, MIT, 1 star) parses to an AST and compiles to Elasticsearch, covering 42 of 98 keywords.
  - The [deckbelcher](https://tangled.org/aviva.gay/deckbelcher) TypeScript recursive-descent parser has an unverified licence; it is a reference only.
  - Scryfall publishes no formal grammar.
- **Keyword families:** the [syntax page](https://scryfall.com/docs/syntax) has about 20 keyword families that card JSON can answer.
- **Families needing data outside the card JSON:**
  - tags: `art:`/`atag:`/`arttag:` and `function:`/`otag:`/`oracletag:`;
  - `cube:` and `block:`/`b:`;
  - cross-printing keywords: `cheapest:`, `new:`, `unique:`, `is:firstprint`.
- **Rules-engine fields:** `RawJSONToRuleData` today already provides name, set, rarity, type line, oracle text (top level only), mana cost, `cmc`, colours, colour identity, keywords, power/toughness/loyalty, prices, artist, frame, border, finishes, promo types, layout and EDHREC rank. It **lacks** legalities, `lang`, `released_at`, localized text, per-face text, flavour text and watermark.

**Prototype state after this session:**
- **Layout:** `CardsHeader.svelte` has the search field (applied on Enter), the scope dropdown (a DaisyUI `select` with an "In" prefix and a "Locations" option group), and the counter.
- **State:** `CardsView` (`state.svelte.ts`) gained `scope` and `setScope(scope, query)`, and `navigate()` takes an optional `location`. URL params are unchanged.
- **Verified in Chrome:**
  - The counts for My collection, a single location and Unassigned match the storage overview.
  - A name query filters only on Enter.
  - Switching to All cards reruns the query on Scryfall, with owned and outline badges. Switching back keeps the query.
  - Navbar search lands in All cards.
  - The pill toggles to "Current" and back.
  - No console errors.

## Usable on real data (2026-11-10)

The user wanted to use the prototype day to day on their real collection, deploying from this branch themselves. The work stays on the prototype branch, and the local Scryfall engine is still a later step.

**Backend additions** (`backend/api/inventory.go`, routes in `server/inventory_routes.go`, tests in `api/inventory_merge_test.go`):
- **`POST /api/inventory` takes two optional flags:**
  - `unassigned: true` skips auto-sort and creates the row with no location. Combining it with `storage_location_id` returns 400.
  - `merge: true` resolves the location first (explicit, auto-sorted or unassigned), then adds the quantity to the **oldest** row of that stack (same `scryfall_id` + `treatment` + location) in one transaction and returns it with 200. Without such a row it inserts as before (201).
  - Without either flag, behaviour is unchanged for the other callers.
- **`GET /api/inventory/auto-location?scryfall_id=&treatment=`** returns `{storage_location | null}`. It calls `AutoSortService.DetermineStorageLocation`, the same code Create runs, so the Add popover's "Auto (rules)" preview is exact. It replaces the earlier `/api/sorting-rules/evaluate` preview, which used card-result data.
- **`GET /api/inventory/availability/:oracle_id`** returns `DeckAvailability {owned, decked, free}`, for re-reading the deck badge after a write.
- `AutoLocationResponse` is generated by tygo with `storage_location: any`, like the other generated types that reference `models.StorageLocation` (there is no tygo mapping for it). The frontend declares its own typed interface instead.

**Frontend (prototype):**
- **No dev gate.** `/search` renders the Cards page by default; `?variant=current` renders today's search page. Navbar search goes to `/search?source=catalog&q=…`, except on the `current` variant.
- **State.** `state.svelte.ts` replaced the in-memory `Changes` store with `live`: rows and availability re-read after each write, plus `owned` and `busy`.
  - **Writes:** `addCopy` (always `merge: true`), `removeCopy`, `undoAdd`, `moveStack` (via `split-move`, which consolidates the source rows and merges at the destination) and `refreshCard`.
  - **Serialized per card:** writes for one card run one after another through a promise chain.
  - **Refresh:** after each write, `GET /api/inventory?scryfall_id=…&page_size=100` and the availability endpoint are re-read.
  - **Failure:** a toast "Couldn't save: …", and the shown data stays as it was.
  - **Reset:** `live` resets on every server load.
- **Row choice:** `prototype/stacks.ts` holds the pure helpers (`aggregateStacks`, `rowsOfStack`, `pickRowToDecrement`), tested in `stacks.test.ts`. "−" takes a copy from a single-copy row first, newest first, so split stacks shrink; otherwise from the newest row.
- **Add to deck** in the panel opens the existing `AddToDeckModal`. "In decks" now shows the zone for non-main entries.

**Verified** against a copy of a real database, using the production build (`node build` on port 5174, backend on port 3100):
- "+" on a stack split across 5 rows added to the oldest row (row count unchanged).
- "−" deleted the newest single-copy row.
- Move consolidated 4 rows into exactly 1 row at the destination.
- "Auto" preview and actual save agreed. No rule matched in the test data, so only the unassigned outcome was checked end to end; the backend tests cover a matching rule.
- An explicit Unassigned add merged, and Undo restored it.
- Add to deck updated "In decks" and lowered the deck badge's free count without a reload.
- Adding from All cards made the card appear in My collection.
- With the backend down, a save showed a toast and left the data unchanged.
- No console errors.
- Backend tests and lint pass (lint: only the 12 `errcheck` findings in test files that were already there). Frontend: 279 server tests pass; the client tests fail only on the 6 `InventoryBrowser` tests already failing on `main`.

**Before deploying:** back up the SQLite file (`/app/data/database.db` in the `showmycards-data` volume, for example with `sqlite3 database.db ".backup backup.db"`). The JSON export and the scheduled backups don't include decks.

**Still open:**
- Collection search is name-only.
- Copies in deck-named storage locations count as free for decks.
- Existing split stacks are only consolidated when moved.

### Follow-up: the Move menu (2026-11-10)

The user reported that "Move to" in the detail panel did nothing. It took three attempts:

1. **The original swap-in `<select>` closed itself.** Clicking the Move icon replaced the row with an autofocused native `<select>`, which had `onblur` set to cancel. Opening a native select's menu takes focus away from it, so the event sequence was `pointerdown`, `mousedown`, `blur`, and the select was gone before an option could be picked. The earlier end-to-end test had set the value from a script, which never opens the menu, so it missed this.
2. **A transparent native `<select>` over the icon worked, but the user rejected the look.** It opens the OS menu, and the user said it "looks awful with the browser native dropdown" and asked for the dropdown already used in the project.
3. **Final version: `prototype/MoveMenu.svelte`.**
   - It uses the DaisyUI `<details class="dropdown dropdown-end">` pattern from `frontend/src/lib/components/DeckCardActions.svelte`: the `<summary>` is the icon button, and the `dropdown-content menu menu-sm` list holds a "Move to" title, every other location, and Unassigned. The list scrolls past about 18rem.
   - Picking an entry closes the menu and calls `moveStack`.
   - Esc or a click outside closes only the menu, not the panel (`DeckCardActions` has no such closing).
   - While the menu is open it bumps `ui.openPopovers`, so the panel's Esc handler leaves the panel open. This first froze the page: the `$effect` read and wrote the counter, which made Svelte throw `effect_update_depth_exceeded`. Wrapping both writes in `untrack` fixed it. `AddPopover` avoids the problem by doing the same in `onMount`.

**Verified** with real clicks against a database copy: the menu opens; Esc and outside clicks close only the menu; moving a stack to another location and back left one row each time; the panel updated; no console errors.

**User preference recorded:** no OS-native dropdown menus in this UI. Use the DaisyUI `dropdown` (or an in-app list like the Add popover's destination picker).

## Facts found (code and data)

### API and code
- **Ignored `unique=` parameter:** `/api/search` ignores a `unique=` query parameter and reads the unique mode from settings (`backend/api/search.go`). The `unique:prints` keyword inside `q` works, and both `oracleid:` and `oracle_id:` are valid Scryfall syntax. This is why "Other printings" on today's `/cards/[id]` page is incomplete: it sends `&unique=prints`.
- **Deck availability exists only on inventory results.** `InventoryCard.deck {owned, decked, free}` is per card (oracle), finish-blind, and computed by `services/allocation.go`. Only `/api/inventory/cards` serves it; search results do not, so the prototype builds an oracle → availability map from the full collection.
- **A mistyped helper causes the existing type errors.** `fetchAllInventoryCards` (`frontend/src/lib/server/inventory-cards.ts`) returns `InventoryCard`s at runtime but is typed `EnhancedCardResult[]`. That mismatch is the source of the 16 svelte-check errors already on `main`, as is the `InventoryBrowser.svelte.spec.ts` fixtures lacking `deck` (6 failing tests on `main`).
- **The inventory endpoint returns duplicates across pages.** On a real collection, `/api/inventory/cards` returned about 27% more entries across pages (`page_size=200`) than there were unique printings. This confirms the proposal's point that it pages by inventory rows. `fetchAllInventoryCards` hides it by merging on card ID.
- **Fixed: the Auto-rule preview could differ from the real auto-sort.** The first preview called `POST /api/sorting-rules/evaluate` with `CardResult`-shaped data, like `RuleTester`, so rules on fields `CardResult` lacks (rarity, type line and so on) could resolve differently from the real auto-sort, which reads the full local card JSON. `RuleTester` still has this gap. The prototype now uses `GET /api/inventory/auto-location` (see "Usable on real data").
- **SvelteKit shallow routing:** shallow `replaceState` from `$app/navigation` does **not** update `page.url`, so URL builders must read `window.location`.
- **Mana font:** `manaSymbolClasses()` (`frontend/src/lib/utils/mana.ts`) is built for mana costs and maps `{T}` to `ms-t`, which does not exist. The bundled CSS (`src/lib/styles/mana.css`) has `ms-tap` and `ms-untap`. The panel maps {T} and {Q} itself.
- **Images:** tiles use Scryfall's `grid` image format (WebP, 488px wide). At 4 columns (about 276–326 CSS px) on 2× displays it is slightly upscaled. A larger format would be sharper.

### Observations from real data
- **Localized text is complete for single-face cards.** Every single-face German printing checked against real data had localized text.
- **Scryfall's German data has multi-face gaps.** Counts over every German printing in the local bulk `cards` table, not just owned ones:
  - "prepare" layout: 97 of 97 back faces lack a German name and text.
  - Adventure: 31 faces.
  - Flip: 6 faces.
  - Transform: 6 names and 2 texts.
  - Split: 2 faces.
  
  The per-face English fallback covers these.
- **Placeholder images:** many German printings use Scryfall's "Localized Image Not Available" placeholder. That is Scryfall data, not an app bug.
- **New copies don't join existing stacks.** On a real collection about 14% of stacks (printing + finish + location) were split across several inventory rows, up to 10, because `POST /api/inventory` always inserted. The prototype's `merge` flag stops new splits; Move consolidates the stack it moves.
- **Physical decks modelled as storage locations.** Some users keep a storage location per physical deck (for example one per Commander deck). The allocation service counts only demand from the Decks feature, so **copies sitting in such a location still count as "free for decks"**. This needs a decision during the decks/lists merge: link a deck to a location, or count those copies as committed.

## Open questions

- **Deck badge unit:** keep the per-card free count, or cap it at the printing's owned count? Keep the badge in Catalog, show it only on owned printings, or drop it there?
- **Physical-deck locations vs. the Decks feature** (see above).
- **"In decks" section:** should it also show the free and committed counts? Not requested yet.
- **Image format:** consider a larger Scryfall image format now that tiles are bigger.
- **Face rule:** the rule between faces in the panel text is faint in the dark theme.
- **The scope dropdown in the header is still a native `<select>`,** so it opens the OS menu the user disliked for Move. Switch it to the DaisyUI dropdown too?
- **Duplicate location names:** locations can share a name (for example a binder and a box both called "A1"), and the Move menu, the scope dropdown and the Add popover can't tell them apart. The older `StorageLocationDropdown` prefixes 📖 (binder) or 📦 (box). Show the storage type, or require unique names?

## Tooling notes for this environment

- **Sandbox limits:** the sandbox blocks binding local ports (Go `httptest` servers, Vitest browser tests), the golangci-lint cache, localhost connections from scripts, and `go run github.com/gzuidhof/tygo@latest` (TLS through the proxy). Those commands were run outside the sandbox. `sandbox.network.allowLocalBinding: true` fixes the port-binding part.
- **Testing dropdowns:** check them with real clicks. Setting a `<select>` value and dispatching `change` from a script skips opening the menu, and with it the focus and blur that broke the first Move menu. Browser automation also cannot click inside an OS-native select menu; that is one more reason to prefer DOM-based DaisyUI dropdowns.
- **Testing writes safely:** copy the database with `sqlite3 backend/data/database.db ".backup <scratch>/e2e.db"` (about 10 s for 3.8 GB). Then run a second backend with `DATABASE_PATH=<scratch>/e2e.db DATA_DIR=<scratch>/e2e-data PORT=3100 go run .` and a frontend against it with `PUBLIC_BACKEND_URL=http://localhost:3100 bun run dev --port 5174`. Never test writes against the user's dev database.
- **Baseline on `main`, so you don't chase it:**
  - svelte-check: 16 errors and 1 warning (missing `node` types).
  - Vitest: 6 failing `InventoryBrowser.svelte.spec.ts` tests.
  - golangci-lint on `./api/...`: 12 `errcheck` findings, all in test files.
  - gofmt: several files are unformatted (`api/data.go`, `api/storage.go`, some tests).
