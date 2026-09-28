/**
 * AST for the SysML v2 textual-notation subset this plugin understands:
 * `part def`, `port def`, `interface def`, a bare top-level/nested `part`
 * usage with a body, their nested `attribute` / `port` / `part` (containment)
 * / `connect` / `flow` / `end` members, and arbitrarily nested `package`s.
 *
 * This is intentionally not a full SysML v2 grammar (see README for scope).
 */

export interface AttributeNode {
  name: string;
  /** Type reference after `:` or `:>` (e.g. `ISQ::mass`). */
  type?: string;
  /** Raw expression text after `=` (e.g. `engine.mass+transmission.mass`). */
  value?: string;
}

export interface PortRefNode {
  name: string;
  /** Port type name, referencing a `port def`. */
  type?: string;
}

/** A nested `part name [: Type] [[multiplicity]];` usage inside a part's body — containment. */
export interface PartUsageNode {
  name: string;
  type?: string;
  multiplicity?: string;
}

/** A `connect a.b to c.d;` or `flow [name] [from] a.b to c.d;` statement. */
export interface ConnectorNode {
  name?: string;
  from: string;
  to: string;
}

export interface PartDefNode {
  kind: 'partDef';
  name: string;
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
}

export interface PortDefNode {
  kind: 'portDef';
  name: string;
  doc?: string;
  fields: PortFieldNode[];
}

export interface InterfaceEndNode {
  name: string;
  type?: string;
}

export interface InterfaceDefNode {
  kind: 'interfaceDef';
  name: string;
  doc?: string;
  ends: InterfaceEndNode[];
  flows: ConnectorNode[];
}

export type DefinitionNode = PartDefNode | PortDefNode | InterfaceDefNode;

export interface SysmlModel {
  packageName?: string;
  doc?: string;
  definitions: DefinitionNode[];
}
