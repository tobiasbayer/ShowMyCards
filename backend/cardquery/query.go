// Package cardquery evaluates Scryfall search syntax locally, over printings
// decoded from Scryfall card JSON. It covers the keywords that card JSON can
// answer plus a few collection keywords (finish:, qty, free). Queries are
// parsed to an AST and compiled to Go predicates; nothing is sent to Scryfall.
//
// Semantics follow https://scryfall.com/docs/syntax, checked against the live
// API where the docs are thin. Deliberate differences: unknown values are
// errors instead of being silently ignored, localized (printed) names, type
// lines and text match as well as English ones, and no printings are hidden by
// default (Scryfall hides other languages and "extras").
package cardquery

import "slices"

// Query is a parsed, compiled search.
type Query struct {
	match     pred   // nil matches everything
	order     string // order: value, "" for the default (newest added first)
	direction string // asc, desc or auto ("")
}

// Parse parses and compiles a query. An empty query matches everything.
// Errors are *Error.
func Parse(q string) (*Query, error) {
	query := &Query{}
	n, err := parse(q)
	if err != nil {
		return nil, err
	}
	if n == nil {
		return query, nil
	}
	match, err := query.compile(n)
	if err != nil {
		return nil, err
	}
	query.match = match
	return query, nil
}

// Match reports whether a printing matches the query.
func (q *Query) Match(p *Printing) bool {
	return q.match == nil || q.match(p)
}

// CollectionOnlyKeyword returns the first collection keyword (finish:, qty,
// free) in q, or "". It only tokenizes, so it works on any query Scryfall
// accepts, including syntax this package doesn't support.
func CollectionOnlyKeyword(q string) string {
	tokens, err := lex(q)
	if err != nil {
		return ""
	}
	for _, t := range tokens {
		if t.kind == tokTerm && collectionOnly[t.key] {
			return t.key
		}
	}
	return ""
}

// compile turns a node into a predicate. Option terms (order:, direction:) set
// how results are sorted and match nothing: they compile to a nil predicate,
// which AND leaves out and which `-` and `or` reject.
func (q *Query) compile(n node) (pred, error) {
	switch n := n.(type) {
	case andNode:
		kids, err := q.compileAll(n.kids)
		if err != nil {
			return nil, err
		}
		kids = slices.DeleteFunc(kids, func(k pred) bool { return k == nil })
		switch len(kids) {
		case 0:
			return nil, nil
		case 1:
			return kids[0], nil
		}
		return func(p *Printing) bool {
			for _, k := range kids {
				if !k(p) {
					return false
				}
			}
			return true
		}, nil
	case orNode:
		kids, err := q.compileAll(n.kids)
		if err != nil {
			return nil, err
		}
		for i, k := range kids {
			if k == nil {
				return nil, optionMisuse(n.kids[i], "can't be combined with `or`")
			}
		}
		return func(p *Printing) bool {
			for _, k := range kids {
				if k(p) {
					return true
				}
			}
			return false
		}, nil
	case notNode:
		kid, err := q.compile(n.kid)
		if err != nil {
			return nil, err
		}
		if kid == nil {
			return nil, optionMisuse(n.kid, "can't be negated")
		}
		return func(p *Printing) bool { return !kid(p) }, nil
	case leafNode:
		return q.compileLeaf(n.tok)
	}
	return nil, syntaxError(0, "Couldn't read the search")
}

// optionMisuse is the error for an option term (order:, direction:) under `-`
// or `or`, which can only apply to the whole search.
func optionMisuse(n node, reason string) error {
	if t, ok := firstLeaf(n); ok {
		return invalidValue(t, reason)
	}
	return syntaxError(0, "A sort option %s", reason)
}

// firstLeaf returns the first term in a node, in query order.
func firstLeaf(n node) (token, bool) {
	switch n := n.(type) {
	case leafNode:
		return n.tok, true
	case notNode:
		return firstLeaf(n.kid)
	case andNode:
		for _, k := range n.kids {
			if t, ok := firstLeaf(k); ok {
				return t, true
			}
		}
	case orNode:
		for _, k := range n.kids {
			if t, ok := firstLeaf(k); ok {
				return t, true
			}
		}
	}
	return token{}, false
}

func (q *Query) compileAll(nodes []node) ([]pred, error) {
	preds := make([]pred, 0, len(nodes))
	for _, n := range nodes {
		p, err := q.compile(n)
		if err != nil {
			return nil, err
		}
		preds = append(preds, p)
	}
	return preds, nil
}

func (q *Query) compileLeaf(t token) (pred, error) {
	switch t.kind {
	case tokWord:
		value := fold(t.value)
		return func(p *Printing) bool { return anyContains(p.names, value) }, nil
	case tokExact:
		if t.value == "" {
			return nil, syntaxError(t.pos, "Expected a name after `!`")
		}
		value := fold(t.value)
		return func(p *Printing) bool { return anyEquals(p.names, value) }, nil
	case tokTerm:
		return q.compileTerm(t)
	}
	return nil, syntaxError(t.pos, "Unexpected `%s`", t.raw)
}

func anyEquals(list []string, value string) bool {
	for _, s := range list {
		if s == value {
			return true
		}
	}
	return false
}
