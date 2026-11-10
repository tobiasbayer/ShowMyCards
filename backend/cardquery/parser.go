package cardquery

// The query AST. Scryfall publishes no grammar; this follows its syntax page:
// terms separated by whitespace are ANDed, "or" binds weaker than AND,
// parentheses group, and "-" negates a term or a group.
type node interface{}

type andNode struct{ kids []node }
type orNode struct{ kids []node }
type notNode struct{ kid node }
type leafNode struct{ tok token }

type parser struct {
	tokens []token
	i      int
	end    int // length of the query, for errors at the end
}

func parse(q string) (node, error) {
	tokens, err := lex(q)
	if err != nil {
		return nil, err
	}
	if len(tokens) == 0 {
		return nil, nil
	}
	p := &parser{tokens: tokens, end: len(q)}
	n, err := p.parseOr()
	if err != nil {
		return nil, err
	}
	if t, ok := p.peek(); ok {
		if t.kind == tokRParen {
			return nil, syntaxError(t.pos, "Unexpected `)`")
		}
		return nil, syntaxError(t.pos, "Unexpected `%s`", t.raw)
	}
	return n, nil
}

func (p *parser) peek() (token, bool) {
	if p.i >= len(p.tokens) {
		return token{}, false
	}
	return p.tokens[p.i], true
}

func (p *parser) parseOr() (node, error) {
	if t, ok := p.peek(); ok && t.kind == tokOr {
		return nil, syntaxError(t.pos, "`or` needs a search term on both sides")
	}
	first, err := p.parseAnd()
	if err != nil {
		return nil, err
	}
	kids := []node{first}
	for {
		t, ok := p.peek()
		if !ok || t.kind != tokOr {
			break
		}
		p.i++
		next, ok := p.peek()
		if !ok || next.kind == tokOr || next.kind == tokRParen {
			return nil, syntaxError(t.pos, "`or` needs a search term on both sides")
		}
		kid, err := p.parseAnd()
		if err != nil {
			return nil, err
		}
		kids = append(kids, kid)
	}
	if len(kids) == 1 {
		return first, nil
	}
	return orNode{kids: kids}, nil
}

func (p *parser) parseAnd() (node, error) {
	var kids []node
	for {
		t, ok := p.peek()
		if !ok || t.kind == tokOr || t.kind == tokRParen {
			break
		}
		kid, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		kids = append(kids, kid)
	}
	switch len(kids) {
	case 0:
		pos := p.end
		if t, ok := p.peek(); ok {
			pos = t.pos
		}
		return nil, syntaxError(pos, "Expected a search term")
	case 1:
		return kids[0], nil
	}
	return andNode{kids: kids}, nil
}

func (p *parser) parseUnary() (node, error) {
	t, _ := p.peek()
	if t.kind == tokNeg {
		p.i++
		if next, ok := p.peek(); !ok || next.kind == tokOr || next.kind == tokRParen {
			return nil, syntaxError(t.pos, "Nothing to negate after `-`")
		}
		kid, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		return notNode{kid: kid}, nil
	}
	if t.kind == tokLParen {
		p.i++
		if next, ok := p.peek(); ok && next.kind == tokRParen {
			return nil, syntaxError(t.pos, "Empty parentheses")
		}
		inner, err := p.parseOr()
		if err != nil {
			return nil, err
		}
		if closing, ok := p.peek(); !ok || closing.kind != tokRParen {
			return nil, syntaxError(t.pos, "Missing closing parenthesis")
		}
		p.i++
		return inner, nil
	}
	p.i++
	return leafNode{tok: t}, nil
}
