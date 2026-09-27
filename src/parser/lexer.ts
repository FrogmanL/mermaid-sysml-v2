export interface Token {
  type: 'ident' | 'punct' | 'comment' | 'eof';
  value: string;
  pos: number;
}

const PUNCT_MULTI = [':>', '::'];
const PUNCT_SINGLE = '{}();:,.=*+-';

/**
 * Minimal hand-written tokenizer for the SysML v2 subset. Line comments
 * (`//`) are discarded as trivia; block comments (`/* ... *\/`) are kept as
 * `comment` tokens so `doc /* ... *\/` can be captured by the parser.
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const n = input.length;
  let i = 0;

  while (i < n) {
    const ch = input[i];

    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i++;
      continue;
    }

    if (ch === '/' && input[i + 1] === '/') {
      while (i < n && input[i] !== '\n') i++;
      continue;
    }

    if (ch === '/' && input[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < n && !(input[i] === '*' && input[i + 1] === '/')) i++;
      i = Math.min(i + 2, n);
      tokens.push({ type: 'comment', value: input.slice(start, i), pos: start });
      continue;
    }

    const two = input.slice(i, i + 2);
    if (PUNCT_MULTI.includes(two)) {
      tokens.push({ type: 'punct', value: two, pos: i });
      i += 2;
      continue;
    }

    if (PUNCT_SINGLE.includes(ch)) {
      tokens.push({ type: 'punct', value: ch, pos: i });
      i++;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_]/.test(input[i])) i++;
      tokens.push({ type: 'ident', value: input.slice(start, i), pos: start });
      continue;
    }

    if (/[0-9]/.test(ch)) {
      const start = i;
      while (i < n && /[0-9.]/.test(input[i])) i++;
      tokens.push({ type: 'ident', value: input.slice(start, i), pos: start });
      continue;
    }

    // Anything else (string literals, other operators) is outside this
    // subset's scope for v1; skip it leniently rather than failing the parse.
    i++;
  }

  tokens.push({ type: 'eof', value: '', pos: n });
  return tokens;
}
