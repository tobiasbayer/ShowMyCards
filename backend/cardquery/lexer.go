package cardquery

import (
	"strings"
)

type tokenKind int

const (
	tokLParen tokenKind = iota
	tokRParen
	tokOr
	tokNeg
	tokWord  // bare word or quoted string: matches the name
	tokExact // !name or !"name": the whole name
	tokTerm  // key op value
)

type token struct {
	kind  tokenKind
	pos   int
	raw   string // the token as typed, for messages
	key   string // lowercased keyword (tokTerm)
	op    string // ":", "=", "!=", "<", "<=", ">", ">=" (tokTerm)
	value string // unquoted value (tokTerm, tokWord, tokExact)
	regex bool   // value was written as /regex/
}

// lex splits a query into tokens. It only fails on unterminated quotes or
// regular expressions; everything else is the parser's or compiler's job.
func lex(q string) ([]token, error) {
	var tokens []token
	i := 0
	for i < len(q) {
		c := q[i]
		switch {
		case isSpace(c):
			i++
		case c == '(':
			tokens = append(tokens, token{kind: tokLParen, pos: i, raw: "("})
			i++
		case c == ')':
			tokens = append(tokens, token{kind: tokRParen, pos: i, raw: ")"})
			i++
		case c == '-':
			if i+1 == len(q) || isSpace(q[i+1]) || q[i+1] == ')' {
				return nil, syntaxError(i, "Nothing to negate after `-`")
			}
			tokens = append(tokens, token{kind: tokNeg, pos: i, raw: "-"})
			i++
		case c == '!' && i+1 < len(q) && !isSpace(q[i+1]):
			start := i
			value, next, err := readValue(q, i+1)
			if err != nil {
				return nil, err
			}
			tokens = append(tokens, token{kind: tokExact, pos: start, raw: q[start:next], value: value})
			i = next
		case c == '"':
			start := i
			value, next, err := readQuoted(q, i)
			if err != nil {
				return nil, err
			}
			tokens = append(tokens, token{kind: tokWord, pos: start, raw: q[start:next], value: value})
			i = next
		default:
			t, next, err := readTermOrWord(q, i)
			if err != nil {
				return nil, err
			}
			tokens = append(tokens, t)
			i = next
		}
	}
	return tokens, nil
}

// readTermOrWord reads "key op value" when the text starts with letters
// followed by an operator, and a bare word otherwise.
func readTermOrWord(q string, start int) (token, int, error) {
	k := start
	for k < len(q) && isLetter(q[k]) {
		k++
	}
	if k > start {
		if op := operatorAt(q, k); op != "" {
			value, next, err := readValue(q, k+len(op))
			if err != nil {
				return token{}, 0, err
			}
			regex := k+len(op) < len(q) && q[k+len(op)] == '/'
			return token{
				kind:  tokTerm,
				pos:   start,
				raw:   q[start:next],
				key:   strings.ToLower(q[start:k]),
				op:    op,
				value: value,
				regex: regex,
			}, next, nil
		}
	}

	end := start
	for end < len(q) && !isSpace(q[end]) && q[end] != '(' && q[end] != ')' {
		end++
	}
	word := q[start:end]
	if strings.EqualFold(word, "or") {
		return token{kind: tokOr, pos: start, raw: word}, end, nil
	}
	return token{kind: tokWord, pos: start, raw: word, value: word}, end, nil
}

// readValue reads a term value: "quoted", /regex/, or up to whitespace or ')'.
func readValue(q string, start int) (string, int, error) {
	if start >= len(q) {
		return "", start, nil
	}
	switch q[start] {
	case '"':
		return readQuoted(q, start)
	case '/':
		end := start + 1
		for end < len(q) && q[end] != '/' {
			if q[end] == '\\' {
				end++
			}
			end++
		}
		if end >= len(q) {
			return "", 0, syntaxError(start, "Missing closing `/` in regular expression")
		}
		return q[start+1 : end], end + 1, nil
	}
	end := start
	for end < len(q) && !isSpace(q[end]) && q[end] != ')' {
		end++
	}
	return q[start:end], end, nil
}

func readQuoted(q string, start int) (string, int, error) {
	end := strings.IndexByte(q[start+1:], '"')
	if end < 0 {
		return "", 0, syntaxError(start, "Missing closing quote")
	}
	return q[start+1 : start+1+end], start + end + 2, nil
}

func operatorAt(q string, i int) string {
	for _, op := range []string{"!=", "<=", ">=", ":", "=", "<", ">"} {
		if strings.HasPrefix(q[i:], op) {
			return op
		}
	}
	return ""
}

func isSpace(c byte) bool  { return c == ' ' || c == '\t' || c == '\n' || c == '\r' }
func isLetter(c byte) bool { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') }
