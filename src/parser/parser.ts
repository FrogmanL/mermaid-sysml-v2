import { tokenize, type Token } from './lexer.js';
import type {
  AttributeDefNode,
  AttributeNode,
  ConnectionDefNode,
  ConnectorNode,
  DefinitionNode,
  EnumDefNode,
  InterfaceDefNode,
  InterfaceEndNode,
  PartDefNode,
  PartUsageNode,
  PortDefNode,
  PortFieldNode,
  PortRefNode,
  RequirementDefNode,
  RequirementSubjectNode,
  SysmlModel,
  TraceabilityNode,
  TypeRelation,
  UseCaseActorNode,
  UseCaseDefNode,
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

/** A dotted feature path (`woman`, `h.exit.air`) — self-terminating, since it only ever consumes ident/`.` tokens. */
function parseFeaturePath(p: ParserState): string {
  const parts: string[] = [p.advance().value];
  while (p.at('.')) {
    p.advance();
    parts.push(p.advance().value);
  }
  return parts.join('.');
}

/**
 * Consumes a type-introducing relation if one is present: plain `:` ("typed
 * by"), `:>`/the `subsets` keyword (a usage narrowing another), or
 * `:>>`/the `redefines` keyword (a usage overriding another). Returns
 * `present: false` (consuming nothing) if none of these is next.
 */
function parseTypeIntroducer(p: ParserState): { present: boolean; kind?: TypeRelation } {
  if (p.at(':>>')) {
    p.advance();
    return { present: true, kind: ':>>' };
  }
  if (p.at(':>')) {
    p.advance();
    return { present: true, kind: ':>' };
  }
  if (p.at(':')) {
    p.advance();
    return { present: true };
  }
  if (p.at('redefines')) {
    p.advance();
    return { present: true, kind: ':>>' };
  }
  if (p.at('subsets')) {
    p.advance();
    return { present: true, kind: ':>' };
  }
  return { present: false };
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
 * type can be introduced by `:` (typed by), `:>`/`subsets`, or
 * `:>>`/`redefines` — so this loops rather than assuming a fixed order or a
 * single separator. If more than one type-introducing relation appears on
 * the same usage (`part x : Type :> base;`), the last one wins — combining
 * a defining type with a subsets/redefines target hasn't been seen in this
 * subset's validation corpus, so this doesn't try to track both at once.
 */
function parseOptionalTypeAndMultiplicity(p: ParserState): {
  type?: string;
  typeKind?: TypeRelation;
  multiplicity?: string;
} {
  let type: string | undefined;
  let typeKind: TypeRelation | undefined;
  let multiplicity: string | undefined;
  for (;;) {
    if (multiplicity === undefined && p.at('[')) {
      multiplicity = parseOptionalMultiplicity(p);
      continue;
    }
    const rel = parseTypeIntroducer(p);
    if (rel.present) {
      type = parseQualifiedName(p);
      typeKind = rel.kind;
      continue;
    }
    break;
  }
  return { type, typeKind, multiplicity };
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
  let typeKind: TypeRelation | undefined;
  const rel = parseTypeIntroducer(p);
  if (rel.present) {
    type = parseQualifiedName(p);
    typeKind = rel.kind;
  }
  let value: string | undefined;
  if (p.at('=')) {
    p.advance();
    value = parseRawUntil(p, [';']);
  }
  if (p.at(';')) p.advance();
  return { name, type, typeKind, value };
}

function parsePortRef(p: ParserState): PortRefNode {
  p.expect('port');
  const name = p.advance().value;
  let type: string | undefined;
  let typeKind: TypeRelation | undefined;
  const rel = parseTypeIntroducer(p);
  if (rel.present) {
    type = parseQualifiedName(p);
    typeKind = rel.kind;
  }
  if (p.at(';')) p.advance();
  return { name, type, typeKind };
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
  const { type, typeKind, multiplicity } = parseOptionalTypeAndMultiplicity(p);
  if (p.at('{')) {
    // A usage's inline body (redefinitions, further nested containment) is
    // outside this subset's rendering depth (see README) — skip it.
    skipBalancedBraceBlock(p);
    if (p.at(';')) p.advance();
  } else if (p.at(';')) {
    p.advance();
  }
  return { name, type, typeKind, multiplicity };
}

/**
 * A connector endpoint: an optional `localName ::>` binding prefix (e.g.
 * `communicationPartnerA ::> woman.verbalExchange`) — kept only for the
 * bound-to path, since the local end name has no drawing meaning here — a
 * dotted feature path, and an optional trailing `[multiplicity]` (discarded).
 */
function parseConnectorEndpoint(p: ParserState): string {
  if (p.atIdent() && p.peek(1).value === '::>') {
    p.advance(); // local end name
    p.advance(); // '::>'
  }
  const path = parseFeaturePath(p);
  parseOptionalMultiplicity(p);
  return path;
}

/**
 * Unifies every connector-establishing shape this subset resolves:
 *  - `connect a.b to c.d;` / `flow [name] [from] a.b to c.d;` (binary, with
 *    an optional leading name and an optional `from` keyword)
 *  - `::>`-bound endpoints on either of the above
 *  - n-ary `connect (a ::> x, b ::> y, c ::> z);`
 */
function parseConnectorLike(p: ParserState): ConnectorNode {
  p.advance(); // 'connect' or 'flow'

  if (p.at('(')) {
    p.advance();
    const ends: string[] = [];
    while (!p.eof() && !p.at(')')) {
      ends.push(parseConnectorEndpoint(p));
      if (p.at(',')) p.advance();
    }
    if (p.at(')')) p.advance();
    if (p.at(';')) p.advance();
    return { ends };
  }

  let name: string | undefined;
  if (!p.at('from') && !p.at('to') && p.peek(1).value === 'from') {
    name = p.advance().value;
  }
  if (p.at('from')) p.advance();
  const from = parseConnectorEndpoint(p);
  p.expect('to');
  const to = parseConnectorEndpoint(p);
  if (p.at(';')) p.advance();
  return { name, ends: [from, to] };
}

/**
 * A `connection [name] [: Type] { ... }` usage — e.g.
 * `connection child : Child { end mother ::> woman[1]; end father ::> man[1]; }`.
 * Its own redefined `end name ::> path;` bindings collectively form one
 * connector once 2+ are seen (the abstract connection IS the relationship
 * between whatever its ends are bound to); any literal `connect`/`flow`
 * statements inside contribute their own connectors independently. Both are
 * appended to `connectors` — the enclosing part's, since a connection usage
 * has no box of its own to draw against in this subset.
 */
function parseConnectionUsage(p: ParserState, connectors: ConnectorNode[]): void {
  p.expect('connection');
  let name: string | undefined;
  if (p.atIdent()) name = p.advance().value;
  parseOptionalTypeAndMultiplicity(p);
  if (!p.at('{')) {
    if (p.at(';')) p.advance();
    return;
  }
  p.advance(); // '{'
  const boundEnds: string[] = [];
  for (;;) {
    skipDocAndComments(p);
    if (p.at('}')) {
      p.advance();
      break;
    }
    if (p.eof()) break;
    if (p.at('end')) {
      p.advance();
      if (p.at('part')) p.advance();
      if (p.atIdent()) p.advance(); // the end's own local name
      if (p.at('::>')) {
        p.advance();
        boundEnds.push(parseConnectorEndpoint(p));
      } else if (p.at(':') || p.at(':>') || p.at(':>>')) {
        p.advance();
        parseQualifiedName(p); // a plain type reference, not a binding
        parseOptionalMultiplicity(p);
      }
      if (p.at(';')) p.advance();
      continue;
    }
    if (p.at('connect') || p.at('flow')) {
      connectors.push(parseConnectorLike(p));
      continue;
    }
    if (p.at('connection')) {
      parseConnectionUsage(p, connectors);
      continue;
    }
    skipUnknownMember(p);
  }
  if (boundEnds.length >= 2) {
    connectors.push({ name, ends: boundEnds });
  }
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
    if (p.at('attribute') && p.peek(1).value !== 'def') {
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
    if (p.at('connection') && p.peek(1).value !== 'def') {
      parseConnectionUsage(p, def.connectors);
      continue;
    }
    // Nested defs (including `attribute def`/`enum def` — this subset only
    // recognizes those at the top/package level, matching every other def
    // kind here), actions, states, requirements, satisfy, etc. are outside
    // this subset — skip resiliently rather than fail the whole diagram.
    skipUnknownMember(p);
  }
}

function parsePartDef(p: ParserState): PartDefNode {
  p.expect('part');
  p.expect('def');
  const name = p.advance().value;
  let superType: string | undefined;
  // Specialization is `:>` per spec (`part def FrontAxle :> Axle`); plain `:`
  // is accepted too for leniency, though not seen in the wild for defs.
  if (p.at(':>') || p.at(':')) {
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
  const { type: usageType, typeKind: usageTypeKind } = parseOptionalTypeAndMultiplicity(p);
  if (!p.at('{')) {
    if (p.at(';')) p.advance();
    return undefined;
  }
  const def: PartDefNode = {
    kind: 'partDef',
    name,
    isUsage: true,
    usageType,
    usageTypeKind,
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
  let typeKind: TypeRelation | undefined;
  const rel = parseTypeIntroducer(p);
  if (rel.present) {
    type = parseQualifiedName(p);
    typeKind = rel.kind;
  }
  if (p.at(';')) p.advance();
  return { direction, name, type, typeKind };
}

function parsePortDef(p: ParserState): PortDefNode {
  p.expect('port');
  p.expect('def');
  const name = p.advance().value;
  let superType: string | undefined;
  if (p.at(':>') || p.at(':')) {
    p.advance();
    superType = parseQualifiedName(p);
  }
  const def: PortDefNode = { kind: 'portDef', name, superType, fields: [] };
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
  let typeKind: TypeRelation | undefined;
  const rel = parseTypeIntroducer(p);
  if (rel.present) {
    type = parseQualifiedName(p);
    typeKind = rel.kind;
  }
  if (p.at(';')) p.advance();
  return { name, type, typeKind };
}

function parseInterfaceDef(p: ParserState): InterfaceDefNode {
  p.expect('interface');
  p.expect('def');
  const name = p.advance().value;
  let superType: string | undefined;
  if (p.at(':>') || p.at(':')) {
    p.advance();
    superType = parseQualifiedName(p);
  }
  const def: InterfaceDefNode = { kind: 'interfaceDef', name, superType, ends: [], flows: [] };
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

/** `end [part] name [: | :> Type [multiplicity]];` inside a `connection def` body. */
function parseConnectionEnd(p: ParserState): InterfaceEndNode {
  p.expect('end');
  if (p.at('part')) p.advance();
  const name = p.advance().value;
  let type: string | undefined;
  let typeKind: TypeRelation | undefined;
  const rel = parseTypeIntroducer(p);
  if (rel.present) {
    type = parseQualifiedName(p);
    typeKind = rel.kind;
    parseOptionalMultiplicity(p);
  }
  if (p.at(';')) p.advance();
  return { name, type, typeKind };
}

/**
 * `connection def Name { end [part] a [:Type]; ...; attribute ...; }` — like
 * `interface def` but for a plain part-to-part link with no port-compatibility
 * requirement.
 */
function parseConnectionDef(p: ParserState): ConnectionDefNode {
  p.expect('connection');
  p.expect('def');
  const name = p.advance().value;
  let superType: string | undefined;
  if (p.at(':>') || p.at(':')) {
    p.advance();
    superType = parseQualifiedName(p);
  }
  const def: ConnectionDefNode = { kind: 'connectionDef', name, superType, ends: [], attributes: [] };
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
        def.ends.push(parseConnectionEnd(p));
        continue;
      }
      if (p.at('attribute') && p.peek(1).value !== 'def') {
        def.attributes.push(parseAttribute(p));
        continue;
      }
      skipUnknownMember(p);
    }
  } else if (p.at(';')) {
    p.advance();
  }
  return def;
}

/**
 * `attribute def Name [:> Super] { attribute field [: Type] [= value]; ... }`
 * — a standalone value-type definition (see `AttributeDefNode`'s doc
 * comment for corpus evidence).
 */
function parseAttributeDef(p: ParserState): AttributeDefNode {
  p.expect('attribute');
  p.expect('def');
  const name = p.advance().value;
  let superType: string | undefined;
  if (p.at(':>') || p.at(':')) {
    p.advance();
    superType = parseQualifiedName(p);
  }
  const def: AttributeDefNode = { kind: 'attributeDef', name, superType, attributes: [] };
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
      if (p.at('attribute') && p.peek(1).value !== 'def') {
        def.attributes.push(parseAttribute(p));
        continue;
      }
      skipUnknownMember(p);
    }
  } else if (p.at(';')) {
    p.advance();
  }
  return def;
}

/** `enum literalName;` inside an `enum def` body — one enumerated value. */
function parseEnumValue(p: ParserState): string {
  p.expect('enum');
  const name = p.advance().value;
  if (p.at(';')) p.advance();
  return name;
}

/**
 * `enum def Name [:> Super] { enum literal; ... }` — an enumeration (see
 * `EnumDefNode`'s doc comment for corpus evidence).
 */
function parseEnumDef(p: ParserState): EnumDefNode {
  p.expect('enum');
  p.expect('def');
  const name = p.advance().value;
  let superType: string | undefined;
  if (p.at(':>') || p.at(':')) {
    p.advance();
    superType = parseQualifiedName(p);
  }
  const def: EnumDefNode = { kind: 'enumDef', name, superType, values: [] };
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
      if (p.at('enum')) {
        def.values.push(parseEnumValue(p));
        continue;
      }
      skipUnknownMember(p);
    }
  } else if (p.at(';')) {
    p.advance();
  }
  return def;
}

/** `subject name [: Type];` inside a `requirement def` body. */
function parseRequirementSubject(p: ParserState): RequirementSubjectNode {
  p.expect('subject');
  const name = p.advance().value;
  let type: string | undefined;
  if (p.at(':>') || p.at(':')) {
    p.advance();
    type = parseQualifiedName(p);
  }
  if (p.at(';')) p.advance();
  return { name, type };
}

function parseRequirementDef(p: ParserState): RequirementDefNode {
  p.expect('requirement');
  p.expect('def');
  const name = p.advance().value;
  let superType: string | undefined;
  if (p.at(':>') || p.at(':')) {
    p.advance();
    superType = parseQualifiedName(p);
  }
  const def: RequirementDefNode = { kind: 'requirementDef', name, superType };
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
      if (p.at('subject')) {
        def.subject = parseRequirementSubject(p);
        continue;
      }
      // `require constraint`, `assume constraint`, `objective`,
      // `stakeholder`, and other requirement-body constructs are outside
      // this subset — skip resiliently, same as any other unsupported
      // member.
      skipUnknownMember(p);
    }
  } else if (p.at(';')) {
    p.advance();
  }
  return def;
}

/**
 * A bare top-level `requirement name [: Type] [:> derivedFrom];` usage —
 * always kept, even body-less (the norm here, unlike a part usage), since
 * satisfy/verify/trace/allocate/derive need a box to point at. `:` (which
 * def this instantiates) and `:>` (which usage this one derives from/
 * narrows) are independent and can both appear on the same usage — see
 * `RequirementDefNode`'s doc comment for why they're kept as separate
 * fields rather than the generic `type`/`typeKind` pattern.
 */
function parseTopLevelRequirementUsage(p: ParserState): RequirementDefNode {
  p.expect('requirement');
  const name = p.advance().value;
  let usageType: string | undefined;
  let derivedFrom: string | undefined;
  for (;;) {
    if (p.at(':>')) {
      p.advance();
      derivedFrom = parseQualifiedName(p);
      continue;
    }
    if (usageType === undefined && p.at(':')) {
      p.advance();
      usageType = parseQualifiedName(p);
      continue;
    }
    break;
  }
  const def: RequirementDefNode = { kind: 'requirementDef', name, isUsage: true, usageType, derivedFrom };
  if (p.at('{')) {
    // A requirement usage's inline body (redefined subject, nested
    // satisfy/require, etc.) is outside this subset's rendering depth —
    // skip it structurally, same as a part usage's inline body.
    skipBalancedBraceBlock(p);
    if (p.at(';')) p.advance();
  } else if (p.at(';')) {
    p.advance();
  }
  return def;
}

/** `satisfy <req> by <target>;` / `verify <req> by <target>;` — the same shape, differing only in keyword. */
function parseSatisfyOrVerify(p: ParserState, kind: 'satisfy' | 'verify'): TraceabilityNode {
  p.advance();
  const source = parseFeaturePath(p);
  p.expect('by');
  const target = parseFeaturePath(p);
  if (p.at(';')) p.advance();
  return { kind, source, target };
}

/** `trace <a> to <b>;` / `allocate <a> to <b>;` — the same shape, differing only in keyword. */
function parseTraceOrAllocate(p: ParserState, kind: 'trace' | 'allocate'): TraceabilityNode {
  p.advance();
  const source = parseFeaturePath(p);
  p.expect('to');
  const target = parseFeaturePath(p);
  if (p.at(';')) p.advance();
  return { kind, source, target };
}

/**
 * `actor name [: Type] [multiplicity];` (def form) or
 * `actor name = existingActor;` (usage form, redefining an inherited actor
 * by reference). Multiplicity is parsed (so it doesn't derail the rest of
 * the statement) but not kept — see `UseCaseActorNode`.
 */
function parseUseCaseActor(p: ParserState): UseCaseActorNode {
  p.expect('actor');
  const name = p.advance().value;
  const { type } = parseOptionalTypeAndMultiplicity(p);
  let value: string | undefined;
  if (p.at('=')) {
    p.advance();
    value = parseRawUntil(p, [';']);
  }
  if (p.at(';')) p.advance();
  return { name, type, value };
}

/** `objective [name] { doc /* ... *\/ }` inside a `use case def` body — returns just the doc text, the actual goal statement. */
function parseObjective(p: ParserState): string | undefined {
  p.expect('objective');
  if (p.atIdent()) p.advance(); // an optional name, not seen in corpus but harmless to allow
  let text: string | undefined;
  if (p.at('{')) {
    p.advance();
    for (;;) {
      const doc = skipDocAndComments(p);
      if (doc && !text) text = doc;
      if (p.at('}')) {
        p.advance();
        break;
      }
      if (p.eof()) break;
      skipUnknownMember(p);
    }
  } else if (p.at(';')) {
    p.advance();
  }
  return text;
}

/**
 * `include [use case] [localName] [: Target] [[multiplicity]] [{ ... }];` —
 * both the full form (`include use case 'enter vehicle' : 'Enter Vehicle'`)
 * and the shorthand (`include 'add fuel'[0..*]`, where the bare name itself
 * is the target) resolve to the same thing here: the name of the use case
 * being included. Any inline body (redefined subject/actors) is skipped
 * structurally — this subset only extracts the relationship, not a nested
 * usage's own redefinitions. Returns '' if nothing nameable was found (the
 * caller skips pushing a relationship in that case).
 */
function parseUseCaseInclude(p: ParserState): string {
  p.expect('include');
  if (p.at('use') && p.peek(1).value === 'case') {
    p.advance();
    p.advance();
  }
  let localName: string | undefined;
  let target: string | undefined;
  if (p.atIdent()) {
    localName = p.advance().value;
  }
  parseOptionalMultiplicity(p);
  if (p.at(':>') || p.at(':')) {
    p.advance();
    target = parseQualifiedName(p);
  }
  if (p.at('{')) {
    skipBalancedBraceBlock(p);
    if (p.at(';')) p.advance();
  } else if (p.at(';')) {
    p.advance();
  }
  return target ?? localName ?? '';
}

/**
 * Shared member loop for both `use case def Name { ... }` and a bare
 * `use case name { ... }` usage. A leading `then` (the activity-style
 * sequencing marker real use-case usages chain their steps with) is
 * consumed and discarded — see `UseCaseDefNode`'s doc comment for why this
 * subset doesn't model sequencing itself, only the `include` relationship
 * that can follow it.
 */
function parseUseCaseBody(p: ParserState, def: UseCaseDefNode, traceability: TraceabilityNode[]): void {
  p.expect('{');
  for (;;) {
    const doc = skipDocAndComments(p);
    if (doc && !def.doc) def.doc = doc;
    if (p.at('}')) {
      p.advance();
      break;
    }
    if (p.eof()) break;
    if (p.at('then')) p.advance();
    if (p.at('subject')) {
      def.subject = parseRequirementSubject(p);
      continue;
    }
    if (p.at('actor')) {
      def.actors.push(parseUseCaseActor(p));
      continue;
    }
    if (p.at('objective')) {
      const text = parseObjective(p);
      if (text) def.objective = text;
      continue;
    }
    if (p.at('include')) {
      const target = parseUseCaseInclude(p);
      if (target) traceability.push({ kind: 'include', source: def.name, target });
      continue;
    }
    // `first`/`done`/`decide`/`fork`/`join`/etc. control markers, and a bare
    // nested `use case` step (activity-style behavior composition, not a
    // use-case-diagram relationship) are out of scope for this round — see
    // README and `UseCaseDefNode`'s doc comment.
    skipUnknownMember(p);
  }
}

function parseUseCaseDef(p: ParserState, traceability: TraceabilityNode[]): UseCaseDefNode {
  p.expect('use');
  p.expect('case');
  p.expect('def');
  const name = p.advance().value;
  let superType: string | undefined;
  if (p.at(':>') || p.at(':')) {
    p.advance();
    superType = parseQualifiedName(p);
  }
  const def: UseCaseDefNode = { kind: 'useCaseDef', name, superType, actors: [] };
  if (p.at('{')) {
    parseUseCaseBody(p, def, traceability);
  } else if (p.at(';')) {
    p.advance();
  }
  return def;
}

/**
 * A bare top-level `use case name [: Type] { ... }` usage — always kept,
 * even body-less, same rationale as a requirement usage: `include` needs a
 * box to point at.
 */
function parseTopLevelUseCaseUsage(p: ParserState, traceability: TraceabilityNode[]): UseCaseDefNode | undefined {
  p.expect('use');
  p.expect('case');
  if (!p.atIdent()) {
    skipUnknownMember(p);
    return undefined;
  }
  const name = p.advance().value;
  const { type: usageType } = parseOptionalTypeAndMultiplicity(p);
  const def: UseCaseDefNode = { kind: 'useCaseDef', name, isUsage: true, usageType, actors: [] };
  if (p.at('{')) {
    parseUseCaseBody(p, def, traceability);
  } else if (p.at(';')) {
    p.advance();
  }
  return def;
}

interface ParseContext {
  packageName?: string;
}

function parseMembers(
  p: ParserState,
  definitions: DefinitionNode[],
  traceability: TraceabilityNode[],
  ctx: ParseContext
): string | undefined {
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
      const innerDoc = parseMembers(p, definitions, traceability, ctx);
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
    if (p.at('connection') && p.peek(1).value === 'def') {
      definitions.push(parseConnectionDef(p));
      continue;
    }
    if (p.at('attribute') && p.peek(1).value === 'def') {
      definitions.push(parseAttributeDef(p));
      continue;
    }
    if (p.at('enum') && p.peek(1).value === 'def') {
      definitions.push(parseEnumDef(p));
      continue;
    }
    if (p.at('use') && p.peek(1).value === 'case' && p.peek(2).value === 'def') {
      definitions.push(parseUseCaseDef(p, traceability));
      continue;
    }
    if (p.at('use') && p.peek(1).value === 'case' && p.peek(2).value !== 'def') {
      const usage = parseTopLevelUseCaseUsage(p, traceability);
      if (usage) definitions.push(usage);
      continue;
    }
    if (p.at('part') && p.peek(1).value !== 'def') {
      const usage = parseTopLevelPartUsage(p);
      if (usage) definitions.push(usage);
      continue;
    }
    if (p.at('connection') && p.peek(1).value !== 'def') {
      // A bare top-level connection usage has no enclosing part to attach
      // its connector to in this subset — parse it so it doesn't fall
      // through to a coarser skip elsewhere, but there's nowhere to draw
      // the result, so the discovered connector(s) are simply discarded.
      parseConnectionUsage(p, []);
      continue;
    }
    if (p.at('requirement') && p.peek(1).value === 'def') {
      definitions.push(parseRequirementDef(p));
      continue;
    }
    if (p.at('requirement') && p.peek(1).value !== 'def') {
      definitions.push(parseTopLevelRequirementUsage(p));
      continue;
    }
    if (p.at('satisfy')) {
      traceability.push(parseSatisfyOrVerify(p, 'satisfy'));
      continue;
    }
    if (p.at('verify')) {
      traceability.push(parseSatisfyOrVerify(p, 'verify'));
      continue;
    }
    if (p.at('trace')) {
      traceability.push(parseTraceOrAllocate(p, 'trace'));
      continue;
    }
    if (p.at('allocate')) {
      traceability.push(parseTraceOrAllocate(p, 'allocate'));
      continue;
    }
    // Part/attribute usages without a body, actions, states, views, and
    // other SysML v2 constructs are out of scope for this subset (see
    // README) — skip resiliently rather than fail.
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
  const traceability: TraceabilityNode[] = [];
  const ctx: ParseContext = {};
  const doc = parseMembers(p, definitions, traceability, ctx);
  return { packageName: ctx.packageName, doc, definitions, traceability };
}
