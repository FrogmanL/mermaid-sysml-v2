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

export type DefinitionNode = PartDefNode | PortDefNode | InterfaceDefNode | ConnectionDefNode;

export interface SysmlModel {
  packageName?: string;
  doc?: string;
  definitions: DefinitionNode[];
}
