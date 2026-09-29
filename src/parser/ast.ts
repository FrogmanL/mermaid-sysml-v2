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

/**
 * `attribute def Name [:> Super] { attribute field [: Type] [= value]; ... }`
 * — a standalone value-type definition, e.g. a struct-like record type.
 * Confirmed against `examples/bvm.mmd`'s own `attribute def Product { ... }`,
 * which is referenced by name elsewhere in that same file
 * (`part inventory : Product[8];`, `attribute selectedProduct : Product;`) —
 * both already rendered before this kind existed, pointing at a definition
 * that had no box of its own.
 */
export interface AttributeDefNode {
  kind: 'attributeDef';
  name: string;
  superType?: string;
  doc?: string;
  attributes: AttributeNode[];
}

/**
 * `item def Name [:> Super] { attribute field ...; }` — a standalone item
 * (payload/flow-value) type, same shape as `attribute def`. A real,
 * evidenced gap closed here: the OMG's own `"21. Asynchronous Messaging"`
 * training examples that drove `send`/`accept` (see `ActionUsageNode`,
 * `SendUsage`) declare `item def Scene;`-style items as message payload
 * types — those parsed past with no box until now.
 */
export interface ItemDefNode {
  kind: 'itemDef';
  name: string;
  superType?: string;
  doc?: string;
  attributes: AttributeNode[];
}

/**
 * `enum def Name [:> Super] { enum literal; ... }` — an enumeration.
 * Confirmed against `examples/bvm.mmd`'s own
 * `enum def DispenseResult { enum success; enum failure; }`, referenced by
 * `DispensePort`'s `in item dispenseResult : DispenseResult;`.
 */
export interface EnumDefNode {
  kind: 'enumDef';
  name: string;
  superType?: string;
  doc?: string;
  values: string[];
}

/** Shared by `requirement def`/usage and `use case def`/usage — both use the identical `subject name [: Type];` grammar. */
export interface RequirementSubjectNode {
  name: string;
  type?: string;
}

/**
 * A use case def/usage's `actor name [: Type] [multiplicity];` (definition
 * form) or `actor name = existingActor;` (usage form, redefining an actor
 * inherited from the def by reference rather than giving it a fresh type) —
 * confirmed against the OMG's own training corpus
 * (`Systems-Modeling/SysML-v2-Release/sysml/src/training/35. Use Cases`).
 * Multiplicity is parsed (via the shared type/multiplicity helper) but not
 * kept — this subset doesn't show it on the actor icon.
 */
export interface UseCaseActorNode {
  name: string;
  type?: string;
  value?: string;
}

/**
 * `use case def Name [:> Super] { subject s [: Type]; actor a [: Type]; objective { doc ...; } }`,
 * or a bare `use case name [: Type] { ... }` usage — always kept even
 * body-less, same rationale as `RequirementDefNode`, since an `include`
 * relationship needs a box to point at. Confirmed against the OMG's own
 * training corpus's `Use Case Definition/Usage Example.sysml`.
 *
 * Deliberately out of scope for this round (see README): the `first`/`then`/
 * `done` activity-style control-flow vocabulary real use-case usages nest
 * their steps in, and a bare (non-`include`-keyword) nested `use case` step —
 * both are really activity/behavior composition riding on top of use cases,
 * not the use-case-diagram relationships this subset targets. Only an
 * explicit `include` (optionally `then`-prefixed, which is consumed and
 * discarded) is extracted, as a `TraceabilityNode` alongside satisfy/verify/
 * trace/allocate/derive — so a real model's `then use case X { include Y; }`
 * loses `Y`'s inclusion (nested two levels deep), a known, documented gap.
 */
export interface UseCaseDefNode {
  kind: 'useCaseDef';
  name: string;
  isUsage?: boolean;
  usageType?: string;
  /** Definition only: supertype after `:>` (specialization). */
  superType?: string;
  doc?: string;
  /** The `objective { doc ...; }` block's text, kept separate from `doc` since it's a distinct spec concept (the use case's goal, not an ordinary comment). */
  objective?: string;
  subject?: RequirementSubjectNode;
  actors: UseCaseActorNode[];
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
 * `verify req by x;`, `trace a to b;`, `allocate a to b;`, or a use case's
 * `include` (source: the including use case, target: the included one —
 * see `UseCaseDefNode`). Only `satisfy`, requirement derivation, and
 * `include` are confirmed against a real corpus file; `verify`/`trace`/
 * `allocate` follow the same grammar shape per the SysML v2 spec but
 * haven't turned up in a local example yet. `source`/`target` are raw
 * dotted paths (see `parseFeaturePath`) — only a simple name matching a box
 * in the diagram resolves to a drawn arrow (see renderer's "Known
 * limitations"): a multi-segment instance path like `bvm.coinAcceptor`
 * usually won't.
 */
export interface TraceabilityNode {
  kind: 'satisfy' | 'verify' | 'trace' | 'allocate' | 'include';
  source: string;
  target: string;
}

/**
 * `in`/`out [item|ref] name [: Type] [= value];` — an action's parameter.
 * `name` is `''` for the shorthand form that omits it entirely (`in item;`),
 * redefining an inherited parameter positionally rather than by name —
 * confirmed against the OMG's own training corpus's
 * `"14. Action Definitions"/Action Shorthand Example.sysml`.
 */
export interface ActionParamNode {
  direction: 'in' | 'out';
  name: string;
  type?: string;
  value?: string;
}

/**
 * `action name accept param [: Type] [via port];` — a shorthand action
 * usage that IS an accept-event action, rather than an ordinary typed/
 * bodied one. Confirmed against the OMG's own training corpus's
 * `"21. Asynchronous Messaging"` (`Messaging Example.sysml`/
 * `Messaging with Ports.sysml`). Drawn as a concave-pentagon flowchart
 * node, the standard UML/SysML shape for this action kind.
 */
export interface AcceptClause {
  param: string;
  type?: string;
  via?: string;
}

/**
 * A nested `action name [: Type] { ... }` usage inside an action's body —
 * drawn as one flowchart node, not expanded recursively (this subset's
 * activity support is one level deep, same convention as the connector
 * container — see README). `isLoop`/`until` cover a
 * `loop action name { ... } until cond;` statement instead — its own body
 * is skipped structurally (same one-level-deep reasoning), but it still
 * gets a flowchart node of its own, labeled to show it's a loop. `accept`
 * covers the shorthand form above instead of an ordinary type/body.
 */
export interface ActionUsageNode {
  name: string;
  type?: string;
  isLoop?: boolean;
  until?: string;
  accept?: AcceptClause;
}

/**
 * `send <payload> [to <target>] [via <port>];` — an asynchronous message
 * send, confirmed against the same training corpus as `AcceptClause`.
 * Always anonymous in the grammar (unlike an `action`, it has no name of
 * its own), so it gets a synthesized id (`__send1__`, ...) to participate
 * in the succession graph like any other step. Drawn as a convex-pentagon
 * flowchart node. `to`/`via` are shown on the node as text, not resolved to
 * a cross-box arrow — the target is typically a sibling top-level action
 * (like `screen` in `Messaging Example.sysml`), outside the sending
 * action's own flowchart namespace, which this subset doesn't draw an edge
 * across — see README "Known limitations".
 */
export interface SendUsage {
  id: string;
  payload?: string;
  to?: string;
  via?: string;
}

/**
 * A `decide`/`merge`/`fork`/`join` control node — a decision/merge diamond
 * or a fork/join bar in the flowchart. `id` is the name given in the
 * source (`then merge continueCharging;`, `join joinNode;`) or a
 * synthesized one for the unnamed forms (`then decide;`, `then fork;`),
 * confirmed against the OMG's own `Decision Example.sysml`/
 * `Fork Join Example.sysml`.
 */
export interface ControlNodeUsage {
  id: string;
  kind: 'decide' | 'merge' | 'fork' | 'join';
}

/**
 * `first A [if guard] then B;`, the bare `[if guard] then B;` shorthand
 * (implicit `from`: whichever action was most recently declared or
 * succeeded), or the `then action B: Type { ... }` declaration-succession
 * shorthand (a new action usage that also implicitly succeeds the
 * previous one). `'__start__'`/`'__done__'` as `from`/`to` refer to
 * `first start;`/`then done;`'s pseudo endpoints, not a real action.
 */
export interface SuccessionNode {
  from?: string;
  to: string;
  guard?: string;
}

/**
 * `action def Name [:> Super] { in/out params; nested action usages; flow
 * ...; first/then succession; done; }`, or a bare `action name : Type
 * { ... }` usage. Grounded against the OMG's own training corpus
 * (`Systems-Modeling/SysML-v2-Release/sysml/src/training/"14. Action
 * Definitions"` through `"22. Opaque Actions"`) — see README for exactly
 * what's covered.
 *
 * Round 1 covered plain/guarded succession, start/done, and data flow;
 * `decide`/`merge`/`fork`/`join` (round 2) are full flowchart nodes now —
 * see `ControlNodeUsage`. Still deliberately out of scope: `bind` (data
 * binding, parsed and discarded — not drawn) and `loop`'s own body (parsed
 * only far enough to skip it structurally, one level deep, same as a
 * nested action's).
 */
export interface ActionDefNode {
  kind: 'actionDef';
  name: string;
  isUsage?: boolean;
  usageType?: string;
  /** Definition only: supertype after `:>` (specialization). */
  superType?: string;
  doc?: string;
  params: ActionParamNode[];
  actions: ActionUsageNode[];
  successions: SuccessionNode[];
  /** `flow [name] from a.b to c.d;` between two nested actions' items — reuses `ConnectorNode` since the grammar and "binary, resolves via dotted path" shape are identical to a part's connectors. */
  flows: ConnectorNode[];
  /** `decide`/`merge`/`fork`/`join` nodes encountered in this action's body. */
  controlNodes: ControlNodeUsage[];
  /** `send ...;` statements encountered in this action's body. */
  sends: SendUsage[];
  /** Seen a `first start;` statement — draws a filled start node. */
  hasStart?: boolean;
  /** Seen a `then done;` (or `first ... then done;`) statement — draws a bordered "final" node. */
  hasDone?: boolean;
}

export type DefinitionNode =
  | PartDefNode
  | PortDefNode
  | InterfaceDefNode
  | ConnectionDefNode
  | RequirementDefNode
  | AttributeDefNode
  | ItemDefNode
  | EnumDefNode
  | UseCaseDefNode
  | ActionDefNode;

export interface SysmlModel {
  packageName?: string;
  doc?: string;
  definitions: DefinitionNode[];
  traceability: TraceabilityNode[];
}
