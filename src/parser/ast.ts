/**
 * AST for the SysML v2 textual-notation subset this plugin understands:
 * `part def`, `port def`, `interface def`, `connection def`, a bare top-
 * level/nested `part` usage with a body, their nested `attribute` / `port` /
 * `part` (containment) / `connect` / `flow` / `end` members, a `connection`
 * usage whose redefined ends form a connector, and arbitrarily nested
 * `package`s.
 *
 * This is intentionally not a full SysML v2 grammar (see README for scope).
 */

/**
 * How a usage's type reference was introduced: `:>` (`subsets` keyword) or
 * `:>>` (`redefines` keyword) — a feature narrowing or overriding another
 * inherited one, per KerML. Plain `:` ("typed by") leaves this `undefined`,
 * since that's the common case and every existing call site already treats
 * an absent `type` as "no type" — adding a third always-present value here
 * would have meant touching every one of those sites for no display benefit.
 */
export type TypeRelation = ':>' | ':>>';

export interface AttributeNode {
  name: string;
  /** Type reference after `:`, `:>`/`subsets`, or `:>>`/`redefines` (e.g. `ISQ::mass`). */
  type?: string;
  typeKind?: TypeRelation;
  /** Raw expression text after `=` (e.g. `engine.mass+transmission.mass`). */
  value?: string;
}

export interface PortRefNode {
  name: string;
  /** Port type name, referencing a `port def`. */
  type?: string;
  typeKind?: TypeRelation;
}

/** A nested `part name [: | :> | :>> Type] [[multiplicity]];` usage inside a part's body — containment. */
export interface PartUsageNode {
  name: string;
  type?: string;
  typeKind?: TypeRelation;
  multiplicity?: string;
}

/**
 * A connector between two or more ports/parts. Covers every connector-
 * establishing form this subset understands:
 *  - `connect a.b to c.d;` / `flow [name] [from] a.b to c.d;` -> ends: [a.b, c.d]
 *  - `connect (a ::> x, b ::> y, c ::> z);` (n-ary) -> ends: [x, y, z]
 *  - a `connection name { end m ::> x; end f ::> y; }` usage's redefined
 *    ends, collected as one connector -> ends: [x, y]
 * A `::>`-bound end (`A ::> x.y`) keeps only the bound-to path (`x.y`) — the
 * local end name itself isn't needed to draw a line between ports.
 */
export interface ConnectorNode {
  name?: string;
  ends: string[];
}

export interface PartDefNode {
  kind: 'partDef';
  name: string;
  /**
   * True for a bare top-level/nested part *usage* with a body
   * (`part roomContext { ... }`), as opposed to a `part def`. The graphical
   * notation distinguishes these: a definition renders as a sharp-cornered
   * box stereotyped «part def», a usage as «part» with "name : Type".
   */
  isUsage?: boolean;
  /** Usage only: the type after `:`/`:>`/`:>>` in `part name : Type { ... }`. */
  usageType?: string;
  usageTypeKind?: TypeRelation;
  /** Definition only: the supertype after `:>` (specialization), e.g. `part def FrontAxle :> Axle`. */
  superType?: string;
  doc?: string;
  attributes: AttributeNode[];
  ports: PortRefNode[];
  parts: PartUsageNode[];
  connectors: ConnectorNode[];
}

export interface PortFieldNode {
  direction: 'in' | 'out';
  name: string;
  type?: string;
  typeKind?: TypeRelation;
}

export interface PortDefNode {
  kind: 'portDef';
  name: string;
  /** Supertype after `:>` (specialization), e.g. `port def SubPort :> BasePort`. */
  superType?: string;
  doc?: string;
  fields: PortFieldNode[];
}

export interface InterfaceEndNode {
  name: string;
  type?: string;
  typeKind?: TypeRelation;
}

export interface InterfaceDefNode {
  kind: 'interfaceDef';
  name: string;
  /** Supertype after `:>` (specialization). */
  superType?: string;
  doc?: string;
  ends: InterfaceEndNode[];
  flows: ConnectorNode[];
}

/**
 * `connection def Name { end [part] a [:Type]; ...; attribute ...; }` — like
 * `interface def` but for a plain part-to-part link with no port-compatibility
 * requirement (the `end` keyword optionally followed by `part` is just a role
 * marker here; both forms parse into the same `InterfaceEndNode` shape).
 */
export interface ConnectionDefNode {
  kind: 'connectionDef';
  name: string;
  superType?: string;
  doc?: string;
  ends: InterfaceEndNode[];
  attributes: AttributeNode[];
}

export interface RequirementSubjectNode {
  name: string;
  type?: string;
}

/**
 * `requirement def Name [:> Super] { doc ...; subject name [: Type]; }`, or
 * a bare `requirement name [: Type] [:> derivedFrom];` usage. SysML v2 has
 * no standalone `deriveReqt` keyword in the textual grammar — requirement
 * derivation is modeled as ordinary usage subsetting instead (confirmed
 * against `examples/bvm.mmd`'s own `requirement req004 : ProductDispensingReq
 * :> req012;`), so `usageType` (the `:` instantiated def) and `derivedFrom`
 * (the `:>` narrowed usage) are kept as two separate fields rather than
 * reusing `type`/`typeKind` — that combo is exactly the one case those
 * generic fields can't hold at once (see `PartUsageNode`'s doc comment).
 * Unlike other usage kinds, a requirement usage always gets its own box even
 * when body-less, since satisfy/verify/trace/allocate/derive need something
 * to point at — a bare `requirement req001 : CoinPaymentReq;` is the norm,
 * not an edge case, for requirement usages specifically.
 */
export interface RequirementDefNode {
  kind: 'requirementDef';
  name: string;
  isUsage?: boolean;
  usageType?: string;
  derivedFrom?: string;
  /** Definition only: supertype after `:>` (specialization). */
  superType?: string;
  doc?: string;
  subject?: RequirementSubjectNode;
}

/**
 * A top-level cross-cutting traceability statement: `satisfy req by x;`,
 * `verify req by x;`, `trace a to b;`, `allocate a to b;`. Only `satisfy` is
 * confirmed against a real corpus file (`examples/bvm.mmd`); `verify`/
 * `trace`/`allocate` follow the same grammar shape per the SysML v2 spec but
 * haven't turned up in a local example yet. `source`/`target` are raw
 * dotted paths (see `parseFeaturePath`) — only a simple name matching a box
 * in the diagram resolves to a drawn arrow (see renderer's "Known
 * limitations"): a multi-segment instance path like `bvm.coinAcceptor`
 * usually won't.
 */
export interface TraceabilityNode {
  kind: 'satisfy' | 'verify' | 'trace' | 'allocate';
  source: string;
  target: string;
}

export type DefinitionNode =
  | PartDefNode
  | PortDefNode
  | InterfaceDefNode
  | ConnectionDefNode
  | RequirementDefNode;

export interface SysmlModel {
  packageName?: string;
  doc?: string;
  definitions: DefinitionNode[];
  traceability: TraceabilityNode[];
}
