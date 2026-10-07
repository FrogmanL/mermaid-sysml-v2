import { tokenize, type Token } from './lexer.js';
import type {
  ActionDefNode,
  ActionParamNode,
  ActionUsageNode,
  AttributeDefNode,
  AttributeNode,
  ConnectionDefNode,
  ConnectorNode,
  ControlNodeUsage,
  DefinitionNode,
  EnumDefNode,
  InterfaceDefNode,
  InterfaceEndNode,
  ItemDefNode,
  MessageNode,
  OccurrenceDefNode,
  PartDefNode,
  PartUsageNode,
  PerformNode,
  PortDefNode,
  PortFieldNode,
  PortRefNode,
  RequirementDefNode,
  VerificationDefNode,
  NestedItemNode,
  RequirementSubjectNode,
  SuccessionNode,
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

/** A dotted feature path (`woman`, `h.exit.air`; a `::`-qualified one like `a::b` is normalized to dots) — self-terminating, since it only ever consumes ident/`.`/`::` tokens. */
function parseFeaturePath(p: ParserState): string {
  const parts: string[] = [p.advance().value];
  while (p.at('.') || p.at('::')) {
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

/** `<keyword> name [: Type] [= value];` — shared shape for `attribute name ...;` and `item name ...;` (an item-typed feature reads identically, e.g. `attribute def Show { item picture : Picture; }`). */
function parseAttributeLike(p: ParserState, keyword: string): AttributeNode {
  p.expect(keyword);
  const name = p.advance().value;
  const { type, typeKind, multiplicity } = parseOptionalTypeAndMultiplicity(p);
  let value: string | undefined;
  if (p.at('=')) {
    p.advance();
    value = parseRawUntil(p, [';']);
  }
  if (p.at(';')) p.advance();
  return { name, type, typeKind, multiplicity, value };
}

function parseAttribute(p: ParserState): AttributeNode {
  return parseAttributeLike(p, 'attribute');
}

/** `item name [: Type] [= value];` as a nested member (not `item def`) — see `parseAttributeLike`. */
function parseItemMember(p: ParserState): AttributeNode {
  return parseAttributeLike(p, 'item');
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
  let items: NestedItemNode[] | undefined;
  if (p.at('{')) {
    // The inline body is only mined for nested item/port structure (see
    // `parseNestedBody`); everything else in it (redefinitions of parts,
    // further containment) is still outside this subset's rendering depth.
    const nested = parseNestedBody(p);
    if (nested.length) items = nested;
    if (p.at(';')) p.advance();
  } else if (p.at(';')) {
    p.advance();
  }
  return items ? { name, type, typeKind, multiplicity, items } : { name, type, typeKind, multiplicity };
}

function nestedLabel(direction: string | undefined, keyword: string | undefined, name: string | undefined, type?: string, kind?: TypeRelation, mult?: string): string {
  const parts: string[] = [];
  if (direction) parts.push(direction);
  if (keyword) parts.push(keyword);
  if (name) parts.push(name);
  if (type) parts.push(`${kind ?? ':'} ${type}`);
  let label = parts.join(' ');
  if (mult) label += ` [${mult}]`;
  return label;
}

/**
 * The inside of a part usage's `{ ... }`: collects `[in|out|inout] [ref] item [name] [: | :> | :>> Type] [mult] ;|{...}` and
 * `port [name] [: | :> | :>> Type] { ... }` into a display tree, recursing into their own bodies. Anything else is skipped.
 * An anonymous redefinition (`item :>> video`) has no name of its own: its label is just the relation and the redefined feature.
 */
function parseNestedBody(p: ParserState): NestedItemNode[] {
  p.expect('{');
  const out: NestedItemNode[] = [];
  for (;;) {
    skipDocAndComments(p);
    if (p.at('}')) {
      p.advance();
      break;
    }
    if (p.eof()) break;
    let direction: string | undefined;
    if (p.at('in') || p.at('out') || p.at('inout')) direction = p.advance().value;
    if (p.at('ref')) p.advance();
    if (p.at('item') || p.at('port')) {
      const keyword = p.advance().value;
      const name = p.atIdent() ? p.advance().value : undefined;
      const { type, typeKind, multiplicity } = parseOptionalTypeAndMultiplicity(p);
      const node: NestedItemNode = {
        label: nestedLabel(direction, keyword === 'port' ? 'port' : undefined, name, type, typeKind, multiplicity),
        ref: name ?? (typeKind === ':>>' || typeKind === ':>' ? type : undefined),
        children: [],
      };
      if (p.at('{')) node.children = parseNestedBody(p);
      if (p.at(';')) p.advance();
      if (keyword === 'item' || node.children.length) out.push(node);
      continue;
    }
    skipUnknownMember(p);
  }
  return out;
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
  if (!p.at('from') && !p.at('to') && !p.at('of') && (p.peek(1).value === 'from' || p.peek(1).value === 'of')) {
    name = p.advance().value;
  }
  let itemType: string | undefined;
  if (p.at('of')) {
    p.advance();
    itemType = parseQualifiedName(p);
    parseOptionalMultiplicity(p);
  }
  if (p.at('from')) p.advance();
  const from = parseConnectorEndpoint(p);
  p.expect('to');
  const to = parseConnectorEndpoint(p);
  if (p.at(';')) p.advance();
  return itemType ? { name, itemType, ends: [from, to] } : { name, ends: [from, to] };
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
/**
 * `perform [action <name> [multiplicity] [ordered]] [references] <path>;` —
 * see `PerformNode` for the two grammar forms this handles, confirmed
 * against the OMG training corpus's "18. Action Performance"/Action
 * Performance Example.sysml.
 */
function parsePerform(p: ParserState): PerformNode {
  p.expect('perform');
  let name: string | undefined;
  let ordered: boolean | undefined;
  if (p.at('action')) {
    p.advance();
    name = p.advance().value;
    parseOptionalMultiplicity(p);
    if (p.at('ordered')) {
      p.advance();
      ordered = true;
    }
  }
  if (p.at('references')) p.advance();
  const target = parseFeaturePath(p);
  if (p.at(';')) p.advance();
  return { name, target, ordered };
}

/**
 * `message [name] [of ItemType] from <path> to <path>;` — see `MessageNode`.
 * A name is absent only when followed immediately by `of`/`from` (the
 * anonymous form seen in the graphical-notation deck's own Sequence View
 * example, `message of VehicleStart from turnVehicleOn to trigger1;`).
 */
function parseMessage(p: ParserState): MessageNode {
  p.expect('message');
  let name: string | undefined;
  if (!p.at('of') && !p.at('from')) {
    name = p.advance().value;
  }
  let itemType: string | undefined;
  if (p.at('of')) {
    p.advance();
    itemType = parseQualifiedName(p);
  }
  p.expect('from');
  const from = parseFeaturePath(p);
  p.expect('to');
  const to = parseFeaturePath(p);
  if (p.at(';')) p.advance();
  return { name, itemType, from, to };
}

/** `first msgA then msgB [then msgC ...];` — an ordering constraint between message names, inside an `occurrence def` body. See `OccurrenceDefNode.order`. */
function parseMessageOrderChain(p: ParserState): string[] {
  p.expect('first');
  const chain = [p.advance().value];
  while (p.at('then')) {
    p.advance();
    chain.push(p.advance().value);
  }
  if (p.at(';')) p.advance();
  return chain;
}

/**
 * `occurrence def Name [:> Super] { ref part p [...]; message ...; first m1
 * then m2; }` — see `OccurrenceDefNode`. Only the bare `ref part name;`
 * declaration form is handled (any `:>>`/type/multiplicity after the name is
 * consumed and discarded); the full redefinition-heavy `occurrence <name> :
 * Type { part :>> x :>> y { ... } }` *usage* form (seen in the OMG's own
 * `Interaction Realization-1.sysml`) is out of scope — see README.
 */
function parseOccurrenceDef(p: ParserState): OccurrenceDefNode {
  p.expect('occurrence');
  p.expect('def');
  const name = p.advance().value;
  let superType: string | undefined;
  if (p.at(':>') || p.at(':')) {
    p.advance();
    superType = parseQualifiedName(p);
  }
  const def: OccurrenceDefNode = {
    kind: 'occurrenceDef',
    name,
    superType,
    participants: [],
    messages: [],
    order: [],
  };
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
      if (p.at('ref') && p.peek(1).value === 'part') {
        p.advance();
        p.advance();
        // `ref part :>> driver;` (no local name — same-name redefinition
        // shorthand, confirmed against Interaction Example-1.sysml: the
        // participant's name IS the redefined feature's name) vs. a plain
        // `ref part name [...];` declaration with the name given directly.
        let participantName: string;
        if (p.at(':>>') || p.at(':>') || p.at(':')) {
          p.advance();
          participantName = parseQualifiedName(p);
        } else {
          participantName = p.advance().value;
          parseOptionalTypeAndMultiplicity(p);
        }
        if (p.at(';')) p.advance();
        def.participants.push(participantName);
        continue;
      }
      if (p.at('message')) {
        def.messages.push(parseMessage(p));
        continue;
      }
      if (p.at('first')) {
        def.order.push(parseMessageOrderChain(p));
        continue;
      }
      skipUnknownMember(p);
    }
  } else if (p.at(';')) {
    p.advance();
  }
  return def;
}

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
    if (p.at('item') && p.peek(1).value !== 'def') {
      def.attributes.push(parseItemMember(p));
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
    if (p.at('perform')) {
      def.performs.push(parsePerform(p));
      continue;
    }
    if (p.at('message')) {
      def.messages.push(parseMessage(p));
      continue;
    }
    if (p.at('dependency')) {
      (def.dependencies ??= []).push(...parseDependency(p).map(({ source, target }) => ({ source, target })));
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
    performs: [],
    messages: [],
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
function parseTopLevelPartUsage(p: ParserState, bodyless?: PartDefNode[]): PartDefNode | undefined {
  p.expect('part');
  if (!p.atIdent()) {
    skipUnknownMember(p);
    return undefined;
  }
  const name = p.advance().value;
  const { type: usageType, typeKind: usageTypeKind } = parseOptionalTypeAndMultiplicity(p);
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
    performs: [],
    messages: [],
  };
  if (!p.at('{')) {
    if (p.at(';')) p.advance();
    // Not drawn on its own, but remembered: a satisfy/dependency/allocate/verify statement that
    // names it needs a box to point at (see `parseSysml`).
    bodyless?.push(def);
    return undefined;
  }
  parsePartBody(p, def);
  return def;
}

function parsePortField(p: ParserState): PortFieldNode {
  const direction = p.advance().value as 'in' | 'out';
  if (p.at('item') || p.at('attribute') || p.at('ref')) p.advance();
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
      if (p.at('item') && p.peek(1).value !== 'def') {
        def.attributes.push(parseItemMember(p));
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
 * `item def Name [:> Super] { attribute field ...; }` — same shape as
 * `attribute def` (see `ItemDefNode`'s doc comment for corpus evidence).
 */
function parseItemDef(p: ParserState): ItemDefNode {
  p.expect('item');
  p.expect('def');
  const name = p.advance().value;
  let superType: string | undefined;
  if (p.at(':>') || p.at(':')) {
    p.advance();
    superType = parseQualifiedName(p);
  }
  const def: ItemDefNode = { kind: 'itemDef', name, superType, attributes: [] };
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
      if (p.at('item') && p.peek(1).value !== 'def') {
        def.attributes.push(parseItemMember(p));
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
  // `subject s : T;`, `subject s :> base;` or `subject s :>> base : T;` — keep the last type named.
  while (p.at(':>>') || p.at(':>') || p.at(':')) {
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

/** `verification def Name [:> Super] { subject s : T; objective [name] { verify req; ... } }` — valid SysML v2 verification. */
function parseVerificationDef(p: ParserState, traceability: TraceabilityNode[]): VerificationDefNode {
  p.expect('verification');
  p.expect('def');
  const name = p.advance().value;
  let superType: string | undefined;
  if (p.at(':>') || p.at(':')) {
    p.advance();
    superType = parseQualifiedName(p);
  }
  const def: VerificationDefNode = { kind: 'verificationDef', name, superType, verifies: [] };
  if (!p.at('{')) {
    if (p.at(';')) p.advance();
    return def;
  }
  p.advance(); // '{'
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
    if (p.at('objective')) {
      p.advance();
      if (p.atIdent()) p.advance();
      if (!p.at('{')) continue;
      p.advance();
      for (;;) {
        skipDocAndComments(p);
        if (p.at('}')) {
          p.advance();
          break;
        }
        if (p.eof()) break;
        if (p.at('verify')) {
          p.advance();
          if (p.at('requirement')) p.advance();
          const req = parseFeaturePath(p);
          // `verify requirement r : R;` declares a usage; the verified name is `r`. Skip any trailing type/body.
          while (!p.eof() && !p.at(';') && !p.at('}')) p.advance();
          if (p.at(';')) p.advance();
          def.verifies.push(req);
          traceability.push({ kind: 'verify', source: req, target: name });
          continue;
        }
        skipUnknownMember(p);
      }
      continue;
    }
    skipUnknownMember(p);
  }
  return def;
}

/** `dependency [name] from a [, b] to c [, d];` — SysML v2's plain (non-semantic) relationship; used for traceability. */
function parseDependency(p: ParserState): TraceabilityNode[] {
  p.expect('dependency');
  if (p.atIdent() && !p.at('from') && p.peek(1).value === 'from') p.advance(); // optional name
  if (p.at('from')) p.advance();
  const sources = [parseFeaturePath(p)];
  while (p.at(',')) { p.advance(); sources.push(parseFeaturePath(p)); }
  p.expect('to');
  const targets = [parseFeaturePath(p)];
  while (p.at(',')) { p.advance(); targets.push(parseFeaturePath(p)); }
  if (p.at(';')) p.advance();
  return sources.flatMap((source) => targets.map((target) => ({ kind: 'dependency' as const, source, target })));
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
 * consumed and discarded — this subset doesn't model sequencing itself,
 * only the relationships a step implies (see `parseNestedUseCaseStep`).
 */
function parseUseCaseBody(
  p: ParserState,
  def: UseCaseDefNode,
  definitions: DefinitionNode[],
  traceability: TraceabilityNode[]
): void {
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
    if (p.at('use') && p.peek(1).value === 'case') {
      parseNestedUseCaseStep(p, definitions, traceability, def.name);
      continue;
    }
    // `first`/`done`/`decide`/`fork`/`join`/etc. control markers are still
    // out of scope — the relationship a step implies is captured above, but
    // the sequencing between steps isn't modeled. Skipped resiliently like
    // any other unsupported member.
    skipUnknownMember(p);
  }
}

/**
 * A bare nested `use case [name] [: Type] { ... }` step inside another use
 * case's body (real usages chain these with `then`, already consumed by
 * `parseUseCaseBody` before this is called) — treated as an `include`-like
 * relationship from the enclosing use case (`sourceName`) to this step, and
 * promoted to its own top-level box so its own nested relationships have
 * something to draw against. Confirmed necessary against the OMG's own
 * `Use Case Usage Example.sysml`: `'drive vehicle'` is exactly this — a
 * step with no separate `use case def`/usage declared elsewhere, whose own
 * nested `include 'add fuel'...` would otherwise be unreachable (two levels
 * deep, both structurally skipped).
 */
function parseNestedUseCaseStep(
  p: ParserState,
  definitions: DefinitionNode[],
  traceability: TraceabilityNode[],
  sourceName: string
): void {
  p.expect('use');
  p.expect('case');
  if (!p.atIdent()) {
    skipUnknownMember(p);
    return;
  }
  const name = p.advance().value;
  const { type: usageType } = parseOptionalTypeAndMultiplicity(p);
  const def: UseCaseDefNode = { kind: 'useCaseDef', name, isUsage: true, usageType, actors: [] };
  if (p.at('{')) {
    parseUseCaseBody(p, def, definitions, traceability);
  } else if (p.at(';')) {
    p.advance();
  }
  definitions.push(def);
  traceability.push({ kind: 'include', source: sourceName, target: name });
}

function parseUseCaseDef(p: ParserState, definitions: DefinitionNode[], traceability: TraceabilityNode[]): UseCaseDefNode {
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
    parseUseCaseBody(p, def, definitions, traceability);
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
function parseTopLevelUseCaseUsage(
  p: ParserState,
  definitions: DefinitionNode[],
  traceability: TraceabilityNode[]
): UseCaseDefNode | undefined {
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
    parseUseCaseBody(p, def, definitions, traceability);
  } else if (p.at(';')) {
    p.advance();
  }
  return def;
}

/**
 * `in`/`out [item|ref] [name] [: Type] [= value];` — an action's parameter.
 * The name is optional (see `ActionParamNode`'s doc comment).
 */
function parseActionParam(p: ParserState): ActionParamNode {
  const direction = p.advance().value as 'in' | 'out';
  if (p.at('item') || p.at('ref')) p.advance();
  let name = '';
  if (p.atIdent()) {
    name = p.advance().value;
  }
  let type: string | undefined;
  if (p.at(':>') || p.at(':')) {
    p.advance();
    type = parseQualifiedName(p);
  }
  let value: string | undefined;
  if (p.at('=')) {
    p.advance();
    value = parseRawUntil(p, [';']);
  }
  if (p.at(';')) p.advance();
  return { direction, name, type, value };
}

/**
 * A nested `action name [: Type] { ... }` usage — parsed only one level
 * deep (see `ActionUsageNode`'s doc comment): its own body (further nested
 * actions, param overrides, flows) is skipped structurally, not modeled.
 * Also handles the `action name accept param [: Type] [via port];`
 * shorthand (an accept-event action) in place of the ordinary type/body.
 */
function parseActionUsage(p: ParserState): ActionUsageNode {
  p.expect('action');
  const name = p.advance().value;
  if (p.at('accept')) {
    p.advance();
    const param = p.advance().value;
    let type: string | undefined;
    if (p.at(':>') || p.at(':')) {
      p.advance();
      type = parseQualifiedName(p);
    }
    let via: string | undefined;
    if (p.at('via')) {
      p.advance();
      via = parseFeaturePath(p);
    }
    if (p.at(';')) p.advance();
    return { name, accept: { param, type, via } };
  }
  const { type } = parseOptionalTypeAndMultiplicity(p);
  if (p.at('{')) {
    skipBalancedBraceBlock(p);
    if (p.at(';')) p.advance();
  } else if (p.at(';')) {
    p.advance();
  }
  return { name, type };
}

/**
 * `send <payload> [to <target>] [via <port>];` — always anonymous in the
 * grammar, so it gets a synthesized id to participate in the succession
 * graph like any other step (see `SendUsage`).
 */
function parseSendStatement(p: ParserState, def: ActionDefNode): string {
  p.expect('send');
  const payload = parseRawUntil(p, ['to', 'via', ';']);
  let to: string | undefined;
  let via: string | undefined;
  if (p.at('to')) {
    p.advance();
    to = parseFeaturePath(p);
  }
  if (p.at('via')) {
    p.advance();
    via = parseFeaturePath(p);
  }
  if (p.at(';')) p.advance();
  const id = `__send${def.sends.length + 1}__`;
  def.sends.push({ id, payload: payload || undefined, to, via });
  return id;
}

/** Guard-expression text after `if`, stopping at the first `then`, `{`, or `;` seen — never crosses into a nested block, unlike the generic `parseRawUntil`. */
function parseGuardExpression(p: ParserState): string {
  const parts: string[] = [];
  while (!p.eof() && !p.at('then') && !p.at('{') && !p.at(';')) {
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

const ACTION_BRANCH_NODE_KEYWORDS = new Set(['decide', 'fork']);
const ACTION_MERGE_NODE_KEYWORDS = new Set(['merge', 'join']);

/** Registers a `decide`/`merge`/`fork`/`join` node under its given name (or a synthesized one for an unnamed `decide`/`fork`) — idempotent by id, since a merge/join's name is typically declared once and then referenced by bare name from elsewhere in the body. */
function registerControlNode(def: ActionDefNode, kind: ControlNodeUsage['kind'], name: string | undefined): string {
  const id = name ?? `__${kind}${def.controlNodes.filter((c) => c.kind === kind).length + 1}__`;
  if (!def.controlNodes.some((c) => c.id === id)) {
    def.controlNodes.push({ id, kind });
  }
  return id;
}

/**
 * Consumes a `then`/`first ... then` target, resolving it to a plain action
 * name, the `'__done__'` pseudo-node (`done`, which also sets `hasDone`),
 * or a `decide`/`merge`/`fork`/`join` control node's id (registering it).
 * `isBranchPoint` tells the caller whether this is a `decide`/`fork` —
 * a fan-out point where several immediately-following sibling statements
 * (`if g1 then X; if g2 then Y;` or `then A; then B;`) all branch off the
 * *same* node rather than chaining off each other (see `parseActionBody`).
 */
function parseSuccessionTarget(p: ParserState, def: ActionDefNode): { id: string | undefined; isBranchPoint: boolean } {
  const keyword = p.advance().value;
  if (keyword === 'done') {
    def.hasDone = true;
    return { id: '__done__', isBranchPoint: false };
  }
  if (ACTION_BRANCH_NODE_KEYWORDS.has(keyword) || ACTION_MERGE_NODE_KEYWORDS.has(keyword)) {
    const name = p.atIdent() ? p.advance().value : undefined;
    const id = registerControlNode(def, keyword as ControlNodeUsage['kind'], name);
    return { id, isBranchPoint: ACTION_BRANCH_NODE_KEYWORDS.has(keyword) };
  }
  return { id: keyword, isBranchPoint: false };
}

/**
 * Handles what follows a (possibly absent) guard: either an optional `then`
 * plus a target — recording a succession from `from` only when `from` is
 * itself known — or an inline `{ ... }` branch body (`if guard { ... }`,
 * still out of scope — see `ActionDefNode`'s doc comment), skipped
 * structurally. Returns the resolved target and whether it's a branch
 * point, or `{ id: undefined, isBranchPoint: false }` when nothing usable
 * was found — deliberately *not* falling back to `from`, so unrelated
 * failures don't get silently bridged over.
 */
function parseSuccessionThenTarget(
  p: ParserState,
  def: ActionDefNode,
  from: string | undefined,
  guard: string | undefined
): { id: string | undefined; isBranchPoint: boolean } {
  if (p.at('then')) p.advance();
  if (p.at('{')) {
    skipBalancedBraceBlock(p);
    if (p.at(';')) p.advance();
    return { id: undefined, isBranchPoint: false };
  }
  const { id: to, isBranchPoint } = parseSuccessionTarget(p, def);
  if (p.at(';')) p.advance();
  if (!to) return { id: undefined, isBranchPoint: false };
  // Only the *edge* needs a known `from` to be worth recording — the
  // resolved node itself (e.g. a `decide` with nothing recorded before it,
  // the first statement in a body) is still real and still worth tracking
  // as the next reference point, so callers don't lose it.
  if (from !== undefined) {
    def.successions.push({ from, to, guard });
  }
  return { id: to, isBranchPoint };
}

/**
 * `loop [action] name { ... } [until cond];` — the loop's own body is
 * skipped structurally (one level deep, same as a nested action's), but it
 * still becomes its own flowchart node (labeled "loop <name>"). `until`'s
 * condition is kept on the node but not yet surfaced visually — see
 * README "Known limitations".
 */
function parseLoopAction(p: ParserState): ActionUsageNode {
  p.expect('loop');
  if (p.at('action')) p.advance();
  const name = p.atIdent() ? p.advance().value : '(loop)';
  if (p.at('{')) skipBalancedBraceBlock(p);
  let until: string | undefined;
  if (p.at('until')) {
    p.advance();
    until = parseRawUntil(p, [';']);
  }
  if (p.at(';')) p.advance();
  return { name, isLoop: true, until };
}

/**
 * Shared member loop for both `action def Name { ... }` and a bare
 * `action name { ... }` usage. Tracks `lastActionName` — the most recently
 * declared or succeeded action/control node — so a bare `then B;`/
 * `if guard then B;` (no explicit `first`) resolves its implicit
 * predecessor the way the OMG's own training corpus idiomatically writes
 * successions. `lastIsBranchPoint` keeps that predecessor "pinned" at a
 * `decide`/`fork` across consecutive sibling-branch statements, rather than
 * advancing to the first branch's own target (which would wrongly chain
 * the branches to each other instead of fanning out from the same node) —
 * confirmed necessary against the OMG's own `Decision Example.sysml` and
 * `Fork Join Example.sysml`. `lastActionName` is cleared (not left
 * dangling) whenever the chain runs through something still unmodeled
 * (`done`, or an inline `if guard { ... }` branch).
 */
function parseActionBody(p: ParserState, def: ActionDefNode): void {
  p.expect('{');
  let lastActionName: string | undefined;
  let lastIsBranchPoint = false;
  for (;;) {
    const doc = skipDocAndComments(p);
    if (doc && !def.doc) def.doc = doc;
    if (p.at('}')) {
      p.advance();
      break;
    }
    if (p.eof()) break;
    if (p.at('in') || p.at('out')) {
      def.params.push(parseActionParam(p));
      continue;
    }
    if (p.at('then') && p.peek(1).value === 'action') {
      p.advance(); // 'then'
      const usage = parseActionUsage(p);
      def.actions.push(usage);
      if (lastActionName) def.successions.push({ from: lastActionName, to: usage.name });
      lastActionName = usage.name;
      lastIsBranchPoint = false;
      continue;
    }
    if (p.at('action') && p.peek(1).value !== 'def') {
      const usage = parseActionUsage(p);
      def.actions.push(usage);
      lastActionName = usage.name;
      lastIsBranchPoint = false;
      continue;
    }
    if (p.at('loop')) {
      const usage = parseLoopAction(p);
      def.actions.push(usage);
      lastActionName = usage.name;
      lastIsBranchPoint = false;
      continue;
    }
    if (p.at('then') && p.peek(1).value === 'send') {
      p.advance(); // 'then'
      const id = parseSendStatement(p, def);
      if (lastActionName) def.successions.push({ from: lastActionName, to: id });
      lastActionName = id;
      lastIsBranchPoint = false;
      continue;
    }
    if (p.at('send')) {
      const id = parseSendStatement(p, def);
      if (lastActionName) def.successions.push({ from: lastActionName, to: id });
      lastActionName = id;
      lastIsBranchPoint = false;
      continue;
    }
    if (p.at('join')) {
      p.advance();
      const name = p.atIdent() ? p.advance().value : undefined;
      lastActionName = registerControlNode(def, 'join', name);
      lastIsBranchPoint = false;
      if (p.at(';')) p.advance();
      continue;
    }
    if (p.at('first')) {
      p.advance();
      const from = p.advance().value;
      const fromId = from === 'start' ? '__start__' : from;
      if (from === 'start') def.hasStart = true;
      let guard: string | undefined;
      if (p.at('if')) {
        p.advance();
        guard = parseGuardExpression(p);
      }
      if (p.at('then') || p.at('{')) {
        const result = parseSuccessionThenTarget(p, def, fromId, guard);
        lastActionName = result.id;
        lastIsBranchPoint = result.isBranchPoint;
      } else {
        lastActionName = fromId;
        lastIsBranchPoint = false;
        if (p.at(';')) p.advance();
      }
      continue;
    }
    if (p.at('then')) {
      p.advance();
      let guard: string | undefined;
      if (p.at('if')) {
        p.advance();
        guard = parseGuardExpression(p);
      }
      const result = parseSuccessionThenTarget(p, def, lastActionName, guard);
      if (!lastIsBranchPoint) {
        lastActionName = result.id;
        lastIsBranchPoint = result.isBranchPoint;
      }
      continue;
    }
    if (p.at('if')) {
      p.advance();
      const guard = parseGuardExpression(p);
      const result = parseSuccessionThenTarget(p, def, lastActionName, guard);
      if (!lastIsBranchPoint) {
        lastActionName = result.id;
        lastIsBranchPoint = result.isBranchPoint;
      }
      continue;
    }
    if (p.at('succession') && p.peek(1).value === 'flow') {
      p.advance(); // 'succession' — the flow itself is still modeled below;
      // the succession implication layered on top of it isn't (see README).
      def.flows.push(parseConnectorLike(p));
      continue;
    }
    if (p.at('flow')) {
      def.flows.push(parseConnectorLike(p));
      continue;
    }
    // `bind` (data binding) as a standalone statement is out of scope for
    // this round — see `ActionDefNode`'s doc comment. Skipped resiliently
    // like any other unsupported member.
    skipUnknownMember(p);
  }
}

function parseActionDef(p: ParserState): ActionDefNode {
  p.expect('action');
  p.expect('def');
  const name = p.advance().value;
  let superType: string | undefined;
  if (p.at(':>') || p.at(':')) {
    p.advance();
    superType = parseQualifiedName(p);
  }
  const def: ActionDefNode = {
    kind: 'actionDef',
    name,
    superType,
    params: [],
    actions: [],
    successions: [],
    flows: [],
    controlNodes: [],
    sends: [],
  };
  if (p.at('{')) {
    parseActionBody(p, def);
  } else if (p.at(';')) {
    p.advance();
  }
  return def;
}

/**
 * A bare top-level `action name [: Type] { ... }` usage — discarded when
 * body-less (nothing of its own to draw), same as a part usage.
 */
function parseTopLevelActionUsage(p: ParserState): ActionDefNode | undefined {
  p.expect('action');
  if (!p.atIdent()) {
    skipUnknownMember(p);
    return undefined;
  }
  const name = p.advance().value;
  const { type: usageType } = parseOptionalTypeAndMultiplicity(p);
  if (!p.at('{')) {
    if (p.at(';')) p.advance();
    return undefined;
  }
  const def: ActionDefNode = {
    kind: 'actionDef',
    name,
    isUsage: true,
    usageType,
    params: [],
    actions: [],
    successions: [],
    flows: [],
    controlNodes: [],
    sends: [],
  };
  parseActionBody(p, def);
  return def;
}

interface ParseContext {
  packageName?: string;
  /** Body-less top-level part usages, kept aside until we know whether a traceability statement references them. */
  bodylessParts: PartDefNode[];
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
    if (p.at('item') && p.peek(1).value === 'def') {
      definitions.push(parseItemDef(p));
      continue;
    }
    if (p.at('enum') && p.peek(1).value === 'def') {
      definitions.push(parseEnumDef(p));
      continue;
    }
    if (p.at('occurrence') && p.peek(1).value === 'def') {
      definitions.push(parseOccurrenceDef(p));
      continue;
    }
    if (p.at('use') && p.peek(1).value === 'case' && p.peek(2).value === 'def') {
      definitions.push(parseUseCaseDef(p, definitions, traceability));
      continue;
    }
    if (p.at('use') && p.peek(1).value === 'case' && p.peek(2).value !== 'def') {
      const usage = parseTopLevelUseCaseUsage(p, definitions, traceability);
      if (usage) definitions.push(usage);
      continue;
    }
    if (p.at('action') && p.peek(1).value === 'def') {
      definitions.push(parseActionDef(p));
      continue;
    }
    if (p.at('action') && p.peek(1).value !== 'def') {
      const usage = parseTopLevelActionUsage(p);
      if (usage) definitions.push(usage);
      continue;
    }
    if (p.at('part') && p.peek(1).value !== 'def') {
      const usage = parseTopLevelPartUsage(p, ctx.bodylessParts);
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
    if (p.at('verification') && p.peek(1).value === 'def') {
      definitions.push(parseVerificationDef(p, traceability));
      continue;
    }
    if (p.at('dependency')) {
      traceability.push(...parseDependency(p));
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
  // No newline: the text is a single line, which is only the header if it IS the header — otherwise it is the model itself.
  if (newlineIndex === -1) return /^\s*sysml-v2\s*$/i.test(text) ? '' : text;
  const firstLine = text.slice(0, newlineIndex);
  return /^\s*sysml-v2\s*$/i.test(firstLine) ? text.slice(newlineIndex + 1) : text;
}

export function parseSysml(text: string): SysmlModel {
  const p = new ParserState(tokenize(stripDiagramHeader(text)));
  const definitions: DefinitionNode[] = [];
  const traceability: TraceabilityNode[] = [];
  const ctx: ParseContext = { bodylessParts: [] };
  const doc = parseMembers(p, definitions, traceability, ctx);
  const lastSegment = (path: string): string => path.replace(/::/g, '.').split('.').pop() ?? path;
  const referenced = new Set(traceability.flatMap((t) => [lastSegment(t.source), lastSegment(t.target)]));
  for (const usage of ctx.bodylessParts) {
    if (referenced.has(usage.name) && !definitions.some((d) => d.name === usage.name)) definitions.push(usage);
  }
  return { packageName: ctx.packageName, doc, definitions, traceability };
}
