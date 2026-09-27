import { tokenize, type Token } from './lexer.js';
import type {
  AttributeNode,
  DefinitionNode,
  FlowNode,
  InterfaceDefNode,
  InterfaceEndNode,
  PartDefNode,
  PortDefNode,
  PortFieldNode,
  PortRefNode,
  SysmlModel,
} from './ast.js';

export class SysmlParseError extends Error {}

class ParserState {
  private i = 0;
  constructor(private tokens: Token[]) {}

  peek(offset = 0): Token {
    return this.tokens[Math.min(this.i + offset, this.tokens.length - 1)];
  }

  at(value: string): boolean {
    const t = this.peek();
    return (t.type === 'ident' || t.type === 'punct') && t.value === value;
  }

  atComment(): boolean {
    return this.peek().type === 'comment';
  }

  eof(): boolean {
    return this.peek().type === 'eof';
  }

  advance(): Token {
    const t = this.tokens[this.i];
    if (this.i < this.tokens.length - 1) this.i++;
    return t;
  }

  expect(value: string): Token {
    if (!this.at(value)) {
      const found = this.peek().type === 'eof' ? '<end of input>' : `"${this.peek().value}"`;
      throw new SysmlParseError(`SysML v2: expected "${value}" but found ${found}`);
    }
    return this.advance();
  }
}

function cleanComment(raw: string): string {
  return raw
    .replace(/^\/\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*?\s?/, '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

/** Skips stray comments and `doc /* ... *\/` blocks, returning the first doc text found (if any). */
function skipDocAndComments(p: ParserState): string | undefined {
  let doc: string | undefined;
  for (;;) {
    if (p.atComment()) {
      p.advance();
      continue;
    }
    if (p.at('doc')) {
      p.advance();
      if (p.atComment()) {
        const text = cleanComment(p.advance().value);
        if (!doc) doc = text;
      }
      if (p.at(';')) p.advance();
      continue;
    }
    break;
  }
  return doc;
}

function parseQualifiedName(p: ParserState): string {
  let name = p.advance().value;
  while (p.at('::')) {
    p.advance();
    if (p.at('*')) {
      name += '::*';
      p.advance();
      break;
    }
    name += '::' + p.advance().value;
  }
  return name;
}

/** Consumes raw tokens up to (not including) one of `terminators`, for content this subset doesn't model in depth. */
function parseRawUntil(p: ParserState, terminators: string[]): string {
  const parts: string[] = [];
  while (!p.eof() && !terminators.some((t) => p.at(t))) {
    if (p.atComment()) {
      p.advance();
      continue;
    }
    parts.push(p.advance().value);
  }
  return parts
    .join(' ')
    .replace(/\s*::\s*/g, '::')
    .replace(/\s*\.\s*/g, '.')
    .trim();
}

/** Best-effort recovery for constructs outside this subset (part usages, actions, etc.): skip to the next top-level `;` or `}`. */
function skipUnknownMember(p: ParserState): void {
  let depth = 0;
  while (!p.eof()) {
    if (p.at('{')) {
      depth++;
      p.advance();
      continue;
    }
    if (p.at('}')) {
      if (depth === 0) return;
      depth--;
      p.advance();
      continue;
    }
    if (p.at(';') && depth === 0) {
      p.advance();
      return;
    }
    p.advance();
  }
}

function parseImport(p: ParserState): void {
  if (p.at('private') || p.at('public') || p.at('protected')) p.advance();
  p.expect('import');
  parseRawUntil(p, [';']);
  if (p.at(';')) p.advance();
}

function parseAttribute(p: ParserState): AttributeNode {
  p.expect('attribute');
  const name = p.advance().value;
  let type: string | undefined;
  let value: string | undefined;
  if (p.at(':>')) {
    p.advance();
    type = parseQualifiedName(p);
  }
  if (p.at('=')) {
    p.advance();
    value = parseRawUntil(p, [';']);
  }
  if (p.at(';')) p.advance();
  return { name, type, value };
}

function parsePortRef(p: ParserState): PortRefNode {
  p.expect('port');
  const name = p.advance().value;
  let type: string | undefined;
  if (p.at(':')) {
    p.advance();
    type = parseQualifiedName(p);
  }
  if (p.at(';')) p.advance();
  return { name, type };
}

function parsePartDef(p: ParserState): PartDefNode {
  p.expect('part');
  p.expect('def');
  const name = p.advance().value;
  let superType: string | undefined;
  if (p.at(':')) {
    p.advance();
    superType = parseQualifiedName(p);
  }
  const def: PartDefNode = { kind: 'partDef', name, superType, attributes: [], ports: [] };
  if (p.at('{')) {
    p.advance();
    for (;;) {
      const doc = skipDocAndComments(p);
      if (doc && !def.doc) def.doc = doc;
      if (p.at('}')) {
        p.advance();
        break;
      }
      if (p.eof()) break;
      if (p.at('attribute')) {
        def.attributes.push(parseAttribute(p));
        continue;
      }
      if (p.at('port')) {
        def.ports.push(parsePortRef(p));
        continue;
      }
      skipUnknownMember(p);
    }
  } else if (p.at(';')) {
    p.advance();
  }
  return def;
}

function parsePortField(p: ParserState): PortFieldNode {
  const direction = p.advance().value as 'in' | 'out';
  const name = p.advance().value;
  let type: string | undefined;
  if (p.at(':>') || p.at(':')) {
    p.advance();
    type = parseQualifiedName(p);
  }
  if (p.at(';')) p.advance();
  return { direction, name, type };
}

function parsePortDef(p: ParserState): PortDefNode {
  p.expect('port');
  p.expect('def');
  const name = p.advance().value;
  const def: PortDefNode = { kind: 'portDef', name, fields: [] };
  if (p.at('{')) {
    p.advance();
    for (;;) {
      const doc = skipDocAndComments(p);
      if (doc && !def.doc) def.doc = doc;
      if (p.at('}')) {
        p.advance();
        break;
      }
      if (p.eof()) break;
      if (p.at('in') || p.at('out')) {
        def.fields.push(parsePortField(p));
        continue;
      }
      skipUnknownMember(p);
    }
  } else if (p.at(';')) {
    p.advance();
  }
  return def;
}

function parseInterfaceEnd(p: ParserState): InterfaceEndNode {
  p.expect('end');
  const name = p.advance().value;
  let type: string | undefined;
  if (p.at(':')) {
    p.advance();
    type = parseQualifiedName(p);
  }
  if (p.at(';')) p.advance();
  return { name, type };
}

function parseFlow(p: ParserState): FlowNode {
  p.expect('flow');
  const from = parseRawUntil(p, ['to']);
  p.expect('to');
  const to = parseRawUntil(p, [';']);
  if (p.at(';')) p.advance();
  return { from, to };
}

function parseInterfaceDef(p: ParserState): InterfaceDefNode {
  p.expect('interface');
  p.expect('def');
  const name = p.advance().value;
  const def: InterfaceDefNode = { kind: 'interfaceDef', name, ends: [], flows: [] };
  if (p.at('{')) {
    p.advance();
    for (;;) {
      const doc = skipDocAndComments(p);
      if (doc && !def.doc) def.doc = doc;
      if (p.at('}')) {
        p.advance();
        break;
      }
      if (p.eof()) break;
      if (p.at('end')) {
        def.ends.push(parseInterfaceEnd(p));
        continue;
      }
      if (p.at('flow')) {
        def.flows.push(parseFlow(p));
        continue;
      }
      skipUnknownMember(p);
    }
  } else if (p.at(';')) {
    p.advance();
  }
  return def;
}

function parseMembers(p: ParserState, definitions: DefinitionNode[]): string | undefined {
  let doc: string | undefined;
  for (;;) {
    const d = skipDocAndComments(p);
    if (d && !doc) doc = d;
    if (p.eof() || p.at('}')) break;
    if (p.at('private') || p.at('public') || p.at('protected') || p.at('import')) {
      parseImport(p);
      continue;
    }
    if (p.at('part') && p.peek(1).value === 'def') {
      definitions.push(parsePartDef(p));
      continue;
    }
    if (p.at('port') && p.peek(1).value === 'def') {
      definitions.push(parsePortDef(p));
      continue;
    }
    if (p.at('interface') && p.peek(1).value === 'def') {
      definitions.push(parseInterfaceDef(p));
      continue;
    }
    // Part/attribute/action usages and other SysML v2 constructs are out of
    // scope for this subset (see README) — skip resiliently rather than fail.
    skipUnknownMember(p);
  }
  return doc;
}

/** Strips the leading `sysml-v2` diagram-type line mermaid keeps in the source text. */
function stripDiagramHeader(text: string): string {
  const newlineIndex = text.indexOf('\n');
  if (newlineIndex === -1) return '';
  const firstLine = text.slice(0, newlineIndex);
  return /^\s*sysml-v2\s*$/i.test(firstLine) ? text.slice(newlineIndex + 1) : text;
}

export function parseSysml(text: string): SysmlModel {
  const p = new ParserState(tokenize(stripDiagramHeader(text)));
  const definitions: DefinitionNode[] = [];
  let packageName: string | undefined;
  let doc: string | undefined;

  doc = skipDocAndComments(p);

  if (p.at('package')) {
    p.advance();
    packageName = p.advance().value;
    p.expect('{');
    const innerDoc = parseMembers(p, definitions);
    if (innerDoc && !doc) doc = innerDoc;
    p.expect('}');
  } else {
    const innerDoc = parseMembers(p, definitions);
    if (innerDoc && !doc) doc = innerDoc;
  }

  return { packageName, doc, definitions };
}
