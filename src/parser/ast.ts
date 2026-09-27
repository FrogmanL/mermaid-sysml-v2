/**
 * AST for the SysML v2 textual-notation subset this plugin understands:
 * `part def`, `port def`, `interface def`, their nested `attribute` / `port` /
 * `end` / `flow` members, and an optional wrapping `package`.
 *
 * This is intentionally not a full SysML v2 grammar (see README for scope).
 */

export interface AttributeNode {
  name: string;
  /** Type reference after `:>` (e.g. `ISQ::mass`). */
  type?: string;
  /** Raw expression text after `=` (e.g. `engine.mass+transmission.mass`). */
  value?: string;
}

export interface PortRefNode {
  name: string;
  /** Port type name, referencing a `port def`. */
  type?: string;
}

export interface PartDefNode {
  kind: 'partDef';
  name: string;
  superType?: string;
  doc?: string;
  attributes: AttributeNode[];
  ports: PortRefNode[];
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

export interface FlowNode {
  from: string;
  to: string;
}

export interface InterfaceDefNode {
  kind: 'interfaceDef';
  name: string;
  doc?: string;
  ends: InterfaceEndNode[];
  flows: FlowNode[];
}

export type DefinitionNode = PartDefNode | PortDefNode | InterfaceDefNode;

export interface SysmlModel {
  packageName?: string;
  doc?: string;
  definitions: DefinitionNode[];
}
