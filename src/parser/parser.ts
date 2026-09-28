import { tokenize, type Token } from './lexer.js';
import type {
  AttributeNode,
  ConnectorNode,
  DefinitionNode,
  InterfaceDefNode,
  InterfaceEndNode,
  PartDefNode,
  PartUsageNode,
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

  atIdent(): boolean {
    return this.peek().type === 'ident';
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
  let prefix = '';
  if (p.at('~')) {
    prefix = '~';
    p.advance();
  }
  let name = prefix + p.advance().value;
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

/** Consumes an optional `[multiplicity]` clause, returning its raw inner text if present. */
function parseOptionalMultiplicity(p: ParserState): string | undefined {
  if (!p.at('[')) return undefined;
  p.advance();
  const parts: string[] = [];
  while (!p.eof() && !p.at(']')) parts.push(p.advance().value);
  if (p.at(']')) p.advance();
  return parts.join('');
}

/**
 * A part usage's type and multiplicity can appear in either order
 * (`part inventory : Product [8];` vs `part adult[*] : Person;`), and the
 * type can be introduced by `:`, `:>` (subsets), or `:>>` (redefines, which
 * our lexer sees as `:>` followed by a dropped `>`) — so this loops rather
 * than assuming a fixed order or a single separator.
 */
function parseOptionalTypeAndMultiplicity(p: ParserState): {
  type?: string;
  multiplicity?: string;
} {
  let type: string | undefined;
  let multiplicity: string | undefined;
  for (;;) {
    if (multiplicity === undefined && p.at('[')) {
      multiplicity = parseOptionalMultiplicity(p);
      continue;
    }
    if (type === undefined && (p.at(':') || p.at(':>'))) {
      p.advance();
      type = parseQualifiedName(p);
      continue;
    }
    break;
  }
  return { type, multiplicity };
}

/**
 * Best-effort recovery for constructs outside this subset: skip to the next
 * top-level `;`, or — for a braced construct with no trailing `;`
 * (`attribute def Product { ... }`, `view x : Y { ... }`) — stop right after
 * *its own* matching `}` closes. Without that second condition this would
 * keep consuming everything after the brace closes, since nothing else
 * marks the statement as complete, silently swallowing every sibling member
 * up to the next unrelated `}` (which is usually the enclosing block's own
 * closer) — confirmed against real files, where this ate three `port def`s
 * hiding behind one preceding `attribute def`.
 */
function skipUnknownMember(p: ParserState): void {
  let depth = 0;
  let openedBrace = false;
  while (!p.eof()) {
    if (p.at('{')) {
      depth++;
      openedBrace = true;
      p.advance();
      continue;
    }
    if (p.at('}')) {
      if (depth === 0) return;
      depth--;
      p.advance();
      if (depth === 0 && openedBrace) {
        if (p.at(';')) p.advance();
        return;
      }
      continue;
    }
    if (p.at(';') && depth === 0) {
      p.advance();
      return;
    }
    p.advance();
  }
}

/** Skips a `{ ... }` block (assumes the current token is `{`), respecting nesting. */
function skipBalancedBraceBlock(p: ParserState): void {
  p.expect('{');
  let depth = 1;
  while (!p.eof() && depth > 0) {
    if (p.at('{')) depth++;
    else if (p.at('}')) depth--;
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
  if (p.at(':>') || p.at(':')) {
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

/**
 * A nested `part <name> [: | :> Type] [[mult]] [{ ... } | ;]` containment
 * usage. Returns `undefined` for unnamed forms this subset doesn't model
 * (e.g. `part :>> socialService;` redefinition, with no name at all) —
 * the caller falls back to structural skipping for those.
 */
function parsePartUsage(p: ParserState): PartUsageNode | undefined {
  p.expect('part');
  if (!p.atIdent()) {
    skipUnknownMember(p);
    return undefined;
  }
  const name = p.advance().value;
  const { type, multiplicity } = parseOptionalTypeAndMultiplicity(p);
  if (p.at('{')) {
    // A usage's inline body (redefinitions, further nested containment) is
    // outside this subset's rendering depth (see README) — skip it.
    skipBalancedBraceBlock(p);
    if (p.at(';')) p.advance();
  } else if (p.at(';')) {
    p.advance();
  }
  return { name, type, multiplicity };
}

/**
 * Unifies `connect a.b to c.d;` and `flow [name] [from] a.b to c.d;` — both
 * describe a line between two ports, differing only in an optional leading
 * name and an optional `from` keyword before the source path.
 */
function parseConnectorLike(p: ParserState): ConnectorNode {
  p.advance(); // 'connect' or 'flow'
  let name: string | undefined;
  if (!p.at('from') && !p.at('to') && p.peek(1).value === 'from') {
    name = p.advance().value;
  }
  if (p.at('from')) p.advance();
  const from = parseRawUntil(p, ['to']);
  p.expect('to');
  const to = parseRawUntil(p, [';']);
  if (p.at(';')) p.advance();
  return { name, from, to };
}

/** Shared member loop for both `part def Name { ... }` and a bare `part name { ... }` usage-with-body. */
function parsePartBody(p: ParserState, def: PartDefNode): void {
  p.expect('{');
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
    if (p.at('port') && p.peek(1).value !== 'def') {
      def.ports.push(parsePortRef(p));
      continue;
    }
    if (p.at('part') && p.peek(1).value !== 'def') {
      const usage = parsePartUsage(p);
      if (usage) def.parts.push(usage);
      continue;
    }
    if (p.at('connect') || p.at('flow')) {
      def.connectors.push(parseConnectorLike(p));
      continue;
    }
    // Nested defs, actions, states, requirements, satisfy, etc. are outside
    // this subset — skip resiliently rather than fail the whole diagram.
    skipUnknownMember(p);
  }
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
  const def: PartDefNode = {
    kind: 'partDef',
    name,
    superType,
    attributes: [],
    ports: [],
    parts: [],
    connectors: [],
  };
  if (p.at('{')) {
    parsePartBody(p, def);
  } else if (p.at(';')) {
    p.advance();
  }
  return def;
}

/**
 * A bare top-level (or nested-in-package) `part name [: Type] { ... }` usage,
 * rendered the same way as a part def with containment. Returns `undefined`
 * for the body-less instantiation-reference form (`part bvm : BVM;`) — with
 * no attributes/parts/connectors of its own, there's nothing worth drawing.
 */
function parseTopLevelPartUsage(p: ParserState): PartDefNode | undefined {
  p.expect('part');
  if (!p.atIdent()) {
    skipUnknownMember(p);
    return undefined;
  }
  const name = p.advance().value;
  const { type: superType } = parseOptionalTypeAndMultiplicity(p);
  if (!p.at('{')) {
    if (p.at(';')) p.advance();
    return undefined;
  }
  const def: PartDefNode = {
    kind: 'partDef',
    name,
    superType,
    attributes: [],
    ports: [],
    parts: [],
    connectors: [],
  };
  parsePartBody(p, def);
  return def;
}

function parsePortField(p: ParserState): PortFieldNode {
  const direction = p.advance().value as 'in' | 'out';
  if (p.at('item') || p.at('ref')) p.advance();
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
        def.flows.push(parseConnectorLike(p));
        continue;
      }
      skipUnknownMember(p);
    }
  } else if (p.at(';')) {
    p.advance();
  }
  return def;
}

interface ParseContext {
  packageName?: string;
}

function parseMembers(p: ParserState, definitions: DefinitionNode[], ctx: ParseContext): string | undefined {
  let doc: string | undefined;
  for (;;) {
    const d = skipDocAndComments(p);
    if (d && !doc) doc = d;
    if (p.eof() || p.at('}')) break;
    if (p.at('private') || p.at('public') || p.at('protected') || p.at('import')) {
      parseImport(p);
      continue;
    }
    if (p.at('package')) {
      p.advance();
      const name = p.advance().value;
      if (ctx.packageName === undefined) ctx.packageName = name;
      p.expect('{');
      const innerDoc = parseMembers(p, definitions, ctx);
      if (innerDoc && !doc) doc = innerDoc;
      p.expect('}');
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
    if (p.at('part') && p.peek(1).value !== 'def') {
      const usage = parseTopLevelPartUsage(p);
      if (usage) definitions.push(usage);
      continue;
    }
    // Part/attribute usages without a body, actions, requirements, states,
    // views, satisfy, and other SysML v2 constructs are out of scope for
    // this subset (see README) — skip resiliently rather than fail.
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
  const ctx: ParseContext = {};
  const doc = parseMembers(p, definitions, ctx);
  return { packageName: ctx.packageName, doc, definitions };
}
