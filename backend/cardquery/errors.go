package cardquery

import "fmt"

// Error codes reported to the UI. Unsupported keywords exist on Scryfall but
// can't be answered from local card data, so the UI offers to search All cards.
const (
	CodeSyntax         = "syntax"
	CodeUnsupported    = "unsupported"
	CodeUnknownKeyword = "unknown_keyword"
	CodeInvalidValue   = "invalid_value"
)

// Error is a query that can't be evaluated. Message is one user-facing line.
type Error struct {
	Code    string
	Keyword string
	Pos     int
	Message string
}

func (e *Error) Error() string { return e.Message }

func syntaxError(pos int, format string, args ...any) *Error {
	return &Error{Code: CodeSyntax, Pos: pos, Message: fmt.Sprintf(format, args...)}
}

func unsupported(t token, what string) *Error {
	return &Error{
		Code:    CodeUnsupported,
		Keyword: t.key,
		Pos:     t.pos,
		Message: fmt.Sprintf("%s isn't available in your collection", what),
	}
}

func invalidValue(t token, reason string) *Error {
	return &Error{
		Code:    CodeInvalidValue,
		Keyword: t.key,
		Pos:     t.pos,
		Message: fmt.Sprintf("Couldn't read `%s`: %s", t.raw, reason),
	}
}
