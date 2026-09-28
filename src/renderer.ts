import { select } from 'd3';
import type { Selection } from 'd3';
import { log, getConfig, setupGraphViewbox } from './mermaidUtils.js';
import { getModel, getAccTitle, getAccDescription } from './db.js';
import type {
  ActionDefNode,
  ActionUsageNode,
  ConnectorNode,
  DefinitionNode,
  PartUsageNode,
  TraceabilityNode,
  TypeRelation,
  UseCaseActorNode,
  UseCaseDefNode,
} from './parser/ast.js';

type G = Selection<SVGGElement, unknown, null, undefined>;

// Layout constants (logical px; the final SVG is rescaled by setupGraphViewbox).
const PAD = 10;
const STEREOTYPE_H = 16;
const TITLE_H = 20;
const LABEL_H = 15;
const ITEM_H = 16;
const DIVIDER_GAP = 6;
const GAP_X = 30;
const GAP_Y = 30;
const MIN_WIDTH = 150;
const CORNER_RADIUS = 8;

// Container (containment + connectors) layout constants.
const CHILD_PAD = 8;
const CHILD_HEADER_H = 20;
const CHILD_MIN_WIDTH = 90;
const PORT_SIZE = 10;
const PORT_LABEL_H = 12;
const PORT_SLOT_W = 64;
const CHILD_GAP = 40;
const CONTAINER_PAD = 14;
const CONNECTOR_BASE_DROOP = 18;
const CONNECTOR_FAN_STEP = 16;
const ARROW_SIZE = 5;

// Composition-tree layout constants (containment with no connectors).
const TREE_CHILD_GAP = 24;
const TREE_DIAMOND = 6;
const TREE_STEM_MID = 12;
const TREE_STEM_BOTTOM = 14;
// The diamond's top vertex sits flush against the source box's border (per
// spec convention), so the gap above it is just the diamond's own half-size.
const TREE_LEVEL_GAP = TREE_DIAMOND * 2 + TREE_STEM_MID + TREE_STEM_BOTTOM;
const MAX_TREE_DEPTH = 6;

// Specialization-arrow layout constants (top-level definition-to-definition
// generalization arrows).
const SPEC_ARROW_LEN = 14;
const SPEC_ARROW_WIDTH = 10;

// Use-case actor layout constants (stick-figure icons in a column beside a
// use case box, one per `actor` member).
const ACTOR_HEAD_R = 5;
const ACTOR_BODY_H = 16;
const ACTOR_ARM_W = 7;
const ACTOR_LEG_W = 6;
const ACTOR_ICON_H = ACTOR_HEAD_R * 2 + ACTOR_BODY_H;
const ACTOR_MIN_COL_WIDTH = ACTOR_ARM_W * 2 + 4;
const ACTOR_LABEL_GAP = 4;
const ACTOR_LABEL_H = 12;
const ACTOR_ROW_GAP = 14;
const ACTOR_COL_GAP = 30;

interface PreparedBox {
  width: number;
  height: number;
  doc?: string;
  render: (node: G) => void;
}

function estimateTextWidth(text: string, fontSize: number, bold = false): number {
  return text.length * fontSize * (bold ? 0.66 : 0.6);
}

/**
 * Renders a type reference with the operator it was actually introduced by
 * — `:` (typed by, the default when `typeKind` is absent), `:>` (subsets),
 * or `:>>` (redefines) — so the diagram shows the same relationship the
 * source text does, rather than collapsing all three to a plain colon.
 * Returns '' when there's no type at all, so callers can just append it.
 */
function typeSuffix(type: string | undefined, typeKind: TypeRelation | undefined): string {
  return type ? ` ${typeKind ?? ':'} ${type}` : '';
}

/** A box's outer border: sharp corners for a `def` (per spec), rounded for a usage. */
function boxRect(node: G, x: number, y: number, width: number, height: number, rounded: boolean) {
  const rect = node.append('rect').attr('x', x).attr('y', y).attr('width', width).attr('height', height);
  if (rounded) rect.attr('rx', CORNER_RADIUS).attr('ry', CORNER_RADIUS);
  return rect;
}

/**
 * `offsetX`/`offsetY` let a header be positioned within a box that itself
 * sits at a non-zero x/y (the composition tree's root box is horizontally
 * centered over its children; a use case box with actors is vertically
 * centered against its actor column) without wrapping it in an extra
 * translated `<g>` — keeping `.title`/`.stereotype` a direct child of
 * `.node` in every box kind, which other code (and tests) key off of.
 */
function drawHeader(node: G, width: number, stereotype: string, name: string, offsetX = 0, offsetY = 0): void {
  node
    .append('text')
    .attr('class', 'stereotype')
    .attr('x', offsetX + width / 2)
    .attr('y', offsetY + PAD + STEREOTYPE_H * 0.75)
    .attr('text-anchor', 'middle')
    .attr('font-size', '11px')
    .text(`«${stereotype}»`);

  node
    .append('text')
    .attr('class', 'title')
    .attr('x', offsetX + width / 2)
    .attr('y', offsetY + PAD + STEREOTYPE_H + TITLE_H * 0.68)
    .attr('text-anchor', 'middle')
    .attr('font-size', '13px')
    .text(name);
}

/** «part def» / «part» etc., and the header name — a usage shows "name : Type" (or `:>`/`:>>` per how it was introduced), a definition just its name. */
function partStereotypeAndName(def: {
  kind: string;
  name: string;
  isUsage?: boolean;
  usageType?: string;
  usageTypeKind?: TypeRelation;
}): { stereotype: string; displayName: string } {
  if (def.isUsage) {
    return { stereotype: 'part', displayName: `${def.name}${typeSuffix(def.usageType, def.usageTypeKind)}` };
  }
  return { stereotype: 'part def', displayName: def.name };
}

// ---------------------------------------------------------------------------
// Leaf boxes: a definition's own compartmented attributes/ports/ends/flows,
// for definitions (or containment-free usages) with no containment.
// ---------------------------------------------------------------------------

interface RenderCompartment {
  label?: string;
  lines: string[];
}

interface LeafBox {
  stereotype: string;
  name: string;
  rounded: boolean;
  doc?: string;
  compartments: RenderCompartment[];
}

/** "a → b" for the common binary case (preserves the directional arrow for flows); "a ↔ b ↔ c" for an n-ary connector. */
function connectorSummary(c: ConnectorNode): string {
  if (c.ends.length === 2) return `${c.ends[0]} → ${c.ends[1]}`;
  return c.ends.join(' ↔ ');
}

function toLeafBox(def: DefinitionNode): LeafBox {
  if (def.kind === 'partDef') {
    const { stereotype, displayName } = partStereotypeAndName(def);
    const compartments: RenderCompartment[] = [];
    if (def.attributes.length) {
      compartments.push({
        label: 'attributes',
        lines: def.attributes.map((a) =>
          a.value !== undefined ? `${a.name} = ${a.value}` : `${a.name}${typeSuffix(a.type, a.typeKind)}`
        ),
      });
    }
    if (def.ports.length) {
      compartments.push({
        label: 'ports',
        lines: def.ports.map((p) => `${p.name}${typeSuffix(p.type, p.typeKind)}`),
      });
    }
    return { stereotype, name: displayName, rounded: !!def.isUsage, doc: def.doc, compartments };
  }
  if (def.kind === 'portDef') {
    const compartments: RenderCompartment[] = [];
    if (def.fields.length) {
      compartments.push({
        label: 'flow properties',
        lines: def.fields.map((f) => `${f.direction} ${f.name}${typeSuffix(f.type, f.typeKind)}`),
      });
    }
    return { stereotype: 'port def', name: def.name, rounded: false, doc: def.doc, compartments };
  }
  if (def.kind === 'interfaceDef') {
    const compartments: RenderCompartment[] = [];
    if (def.ends.length) {
      compartments.push({
        label: 'ends',
        lines: def.ends.map((e) => `${e.name}${typeSuffix(e.type, e.typeKind)}`),
      });
    }
    if (def.flows.length) {
      compartments.push({ label: 'flows', lines: def.flows.map(connectorSummary) });
    }
    return { stereotype: 'interface def', name: def.name, rounded: false, doc: def.doc, compartments };
  }
  if (def.kind === 'connectionDef') {
    const compartments: RenderCompartment[] = [];
    if (def.attributes.length) {
      compartments.push({
        label: 'attributes',
        lines: def.attributes.map((a) =>
          a.value !== undefined ? `${a.name} = ${a.value}` : `${a.name}${typeSuffix(a.type, a.typeKind)}`
        ),
      });
    }
    if (def.ends.length) {
      compartments.push({
        label: 'ends',
        lines: def.ends.map((e) => `${e.name}${typeSuffix(e.type, e.typeKind)}`),
      });
    }
    return { stereotype: 'connection def', name: def.name, rounded: false, doc: def.doc, compartments };
  }
  if (def.kind === 'requirementDef') {
    // The derivation relationship (`:>`) is drawn as an arrow (see
    // `drawTraceabilityArrows`), not shown as text here, matching how
    // definition-level specialization is treated elsewhere in this renderer.
    const compartments: RenderCompartment[] = [];
    if (def.subject) {
      compartments.push({
        label: 'subject',
        lines: [`${def.subject.name}${typeSuffix(def.subject.type, undefined)}`],
      });
    }
    return {
      stereotype: def.isUsage ? 'requirement' : 'requirement def',
      name: def.isUsage ? `${def.name}${typeSuffix(def.usageType, undefined)}` : def.name,
      rounded: !!def.isUsage,
      doc: def.doc,
      compartments,
    };
  }
  if (def.kind === 'attributeDef') {
    const compartments: RenderCompartment[] = [];
    if (def.attributes.length) {
      compartments.push({
        label: 'attributes',
        lines: def.attributes.map((a) =>
          a.value !== undefined ? `${a.name} = ${a.value}` : `${a.name}${typeSuffix(a.type, a.typeKind)}`
        ),
      });
    }
    return { stereotype: 'attribute def', name: def.name, rounded: false, doc: def.doc, compartments };
  }
  if (def.kind === 'enumDef') {
    const compartments: RenderCompartment[] = [];
    if (def.values.length) {
      compartments.push({ label: 'values', lines: def.values });
    }
    return { stereotype: 'enum def', name: def.name, rounded: false, doc: def.doc, compartments };
  }
  if (def.kind === 'useCaseDef') {
    // Actors are drawn as stick figures outside the box (see
    // `prepareUseCaseBox`), not as a text compartment here.
    const compartments: RenderCompartment[] = [];
    if (def.subject) {
      compartments.push({
        label: 'subject',
        lines: [`${def.subject.name}${typeSuffix(def.subject.type, undefined)}`],
      });
    }
    const doc =
      def.doc && def.objective
        ? `${def.doc} — Objective: ${def.objective}`
        : def.objective
          ? `Objective: ${def.objective}`
          : def.doc;
    return {
      stereotype: def.isUsage ? 'use case' : 'use case def',
      name: def.isUsage ? `${def.name}${typeSuffix(def.usageType, undefined)}` : def.name,
      rounded: !!def.isUsage,
      doc,
      compartments,
    };
  }
  // actionDef — used only when there's nothing to draw as a flowchart (see
  // `prepareActionFlowBox`); a plain leaf box showing just its parameters.
  const compartments: RenderCompartment[] = [];
  if (def.params.length) {
    compartments.push({
      label: 'parameters',
      lines: def.params.map((p) => `${p.direction} ${p.name || '(unnamed)'}${typeSuffix(p.type, undefined)}`),
    });
  }
  return {
    stereotype: def.isUsage ? 'action' : 'action def',
    name: def.isUsage ? `${def.name}${typeSuffix(def.usageType, undefined)}` : def.name,
    rounded: !!def.isUsage,
    doc: def.doc,
    compartments,
  };
}

function measureLeafBox(box: LeafBox): { width: number; height: number } {
  let maxWidth = estimateTextWidth(`«${box.stereotype}»`, 11);
  maxWidth = Math.max(maxWidth, estimateTextWidth(box.name, 13, true));

  let height = PAD + STEREOTYPE_H + TITLE_H + PAD;

  for (const comp of box.compartments) {
    height += DIVIDER_GAP;
    if (comp.label) {
      maxWidth = Math.max(maxWidth, estimateTextWidth(comp.label, 10.5) + PAD * 2);
      height += LABEL_H;
    }
    for (const line of comp.lines) {
      maxWidth = Math.max(maxWidth, estimateTextWidth(line, 11.5) + PAD * 2);
      height += ITEM_H;
    }
  }
  height += PAD;

  return { width: Math.max(MIN_WIDTH, Math.ceil(maxWidth) + PAD * 2), height: Math.ceil(height) };
}

/**
 * Draws a compartmented box (border, header, divider/label/member lines per
 * compartment) at an optional offset — shared by a plain leaf box and a use
 * case box's own rectangle (which sits beside an actor column rather than
 * at the origin). `offsetX`/`offsetY` avoid a wrapping `<g>`, same reason as
 * `drawHeader`'s.
 */
function drawCompartmentedBox(
  node: G,
  box: LeafBox,
  width: number,
  height: number,
  offsetX = 0,
  offsetY = 0
): void {
  boxRect(node, offsetX, offsetY, width, height, box.rounded);
  drawHeader(node, width, box.stereotype, box.name, offsetX, offsetY);

  let cy = offsetY + PAD + STEREOTYPE_H + TITLE_H + PAD;
  for (const comp of box.compartments) {
    node
      .append('line')
      .attr('class', 'divider')
      .attr('x1', offsetX)
      .attr('y1', cy)
      .attr('x2', offsetX + width)
      .attr('y2', cy);
    cy += DIVIDER_GAP;

    if (comp.label) {
      node
        .append('text')
        .attr('class', 'compartment-label')
        .attr('x', offsetX + PAD)
        .attr('y', cy + LABEL_H * 0.75)
        .attr('font-size', '10.5px')
        .text(comp.label);
      cy += LABEL_H;
    }

    for (const line of comp.lines) {
      node
        .append('text')
        .attr('class', 'member')
        .attr('x', offsetX + PAD)
        .attr('y', cy + ITEM_H * 0.75)
        .attr('font-size', '11.5px')
        .text(line);
      cy += ITEM_H;
    }
  }
}

function prepareLeafBox(def: DefinitionNode): PreparedBox {
  const box = toLeafBox(def);
  const { width, height } = measureLeafBox(box);

  return {
    width,
    height,
    doc: box.doc,
    render(node) {
      drawCompartmentedBox(node, box, width, height);
    },
  };
}

// ---------------------------------------------------------------------------
// Use case boxes: a `use case def`/usage's own compartmented box (same style
// as any other leaf box) plus a column of stick-figure actors beside it,
// each with a plain association line to the box — the one piece of classic
// use-case-diagram notation this subset draws that isn't just a compartment
// list, per the spec's actual visual convention for this diagram type.
// ---------------------------------------------------------------------------

/** A stick figure — head, body, arms, legs — centered on `cx`, top of the head at `headY`. */
function drawActorIcon(node: G, cx: number, headY: number): void {
  const headCy = headY + ACTOR_HEAD_R;
  const neckY = headY + ACTOR_HEAD_R * 2;
  const armY = neckY + ACTOR_BODY_H * 0.25;
  const hipY = neckY + ACTOR_BODY_H * 0.6;
  const footY = neckY + ACTOR_BODY_H;

  node.append('circle').attr('class', 'actor-icon').attr('cx', cx).attr('cy', headCy).attr('r', ACTOR_HEAD_R);
  node
    .append('line')
    .attr('class', 'actor-limb')
    .attr('x1', cx)
    .attr('y1', neckY)
    .attr('x2', cx)
    .attr('y2', hipY);
  node
    .append('line')
    .attr('class', 'actor-limb')
    .attr('x1', cx - ACTOR_ARM_W)
    .attr('y1', armY)
    .attr('x2', cx + ACTOR_ARM_W)
    .attr('y2', armY);
  node
    .append('line')
    .attr('class', 'actor-limb')
    .attr('x1', cx)
    .attr('y1', hipY)
    .attr('x2', cx - ACTOR_LEG_W)
    .attr('y2', footY);
  node
    .append('line')
    .attr('class', 'actor-limb')
    .attr('x1', cx)
    .attr('y1', hipY)
    .attr('x2', cx + ACTOR_LEG_W)
    .attr('y2', footY);
}

function useCaseActorLabel(a: UseCaseActorNode): string {
  if (a.value !== undefined) return `${a.name} = ${a.value}`;
  return `${a.name}${typeSuffix(a.type, undefined)}`;
}

function prepareUseCaseBox(def: UseCaseDefNode): PreparedBox {
  const box = toLeafBox(def);
  const { width: boxWidth, height: boxHeight } = measureLeafBox(box);

  if (!def.actors.length) {
    return {
      width: boxWidth,
      height: boxHeight,
      doc: box.doc,
      render(node) {
        drawCompartmentedBox(node, box, boxWidth, boxHeight);
      },
    };
  }

  const actorLabels = def.actors.map(useCaseActorLabel);
  const actorColWidth = Math.max(ACTOR_MIN_COL_WIDTH, ...actorLabels.map((l) => estimateTextWidth(l, 9.5)));
  const actorUnitH = ACTOR_ICON_H + ACTOR_LABEL_GAP + ACTOR_LABEL_H;
  const actorColHeight = actorLabels.length * actorUnitH + (actorLabels.length - 1) * ACTOR_ROW_GAP;

  const height = Math.max(actorColHeight, boxHeight);
  const width = actorColWidth + ACTOR_COL_GAP + boxWidth;
  const boxOffsetX = actorColWidth + ACTOR_COL_GAP;
  const boxOffsetY = (height - boxHeight) / 2;
  const actorColOffsetY = (height - actorColHeight) / 2;

  return {
    width,
    height,
    doc: box.doc,
    render(node) {
      drawCompartmentedBox(node, box, boxWidth, boxHeight, boxOffsetX, boxOffsetY);

      let ay = actorColOffsetY;
      const boxBorderY = boxOffsetY + boxHeight / 2;
      for (const label of actorLabels) {
        const cx = actorColWidth / 2;
        drawActorIcon(node, cx, ay);

        node
          .append('text')
          .attr('class', 'actor-label')
          .attr('x', cx)
          .attr('y', ay + ACTOR_ICON_H + ACTOR_LABEL_GAP + ACTOR_LABEL_H * 0.75)
          .attr('text-anchor', 'middle')
          .attr('font-size', '9.5px')
          .text(label);

        node
          .append('line')
          .attr('class', 'actor-association')
          .attr('x1', cx)
          .attr('y1', ay + ACTOR_ICON_H / 2)
          .attr('x2', boxOffsetX)
          .attr('y2', boxBorderY);

        ay += actorUnitH + ACTOR_ROW_GAP;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Container boxes: a part def/usage with nested `part` containment *and*
// connectors, drawn as an internal-block-diagram-style box with child boxes
// and connector lines. One level deep — see README "Known limitations".
// ---------------------------------------------------------------------------

interface ContainerChildInput {
  name: string;
  type?: string;
  typeKind?: TypeRelation;
  ports: string[];
}

interface ChildPort {
  name: string;
  x: number;
}

interface ChildLayout {
  name: string;
  type?: string;
  typeKind?: TypeRelation;
  x: number;
  width: number;
  height: number;
  ports: ChildPort[];
}

function childLabel(name: string, type?: string, typeKind?: TypeRelation): string {
  return `${name}${typeSuffix(type, typeKind)}`;
}

function measureChildren(children: ContainerChildInput[]): {
  layouts: ChildLayout[];
  contentWidth: number;
  maxHeight: number;
} {
  const layouts: ChildLayout[] = [];
  let x = 0;
  let maxHeight = 0;

  for (const child of children) {
    const labelWidth = estimateTextWidth(childLabel(child.name, child.type, child.typeKind), 12, true) + CHILD_PAD * 2;
    const portsWidth = child.ports.length * PORT_SLOT_W;
    const width = Math.max(CHILD_MIN_WIDTH, labelWidth, portsWidth);
    const height = CHILD_HEADER_H + CHILD_PAD * 2;
    const ports: ChildPort[] = child.ports.map((name, i) => ({
      name,
      x: (width / (child.ports.length + 1)) * (i + 1),
    }));
    layouts.push({ name: child.name, type: child.type, typeKind: child.typeKind, x, width, height, ports });
    x += width + CHILD_GAP;
    maxHeight = Math.max(maxHeight, height);
  }

  return { layouts, contentWidth: Math.max(0, x - CHILD_GAP), maxHeight };
}

/**
 * Resolves a connector endpoint to the drawn coordinates of a connection
 * point on one of this container's children, plus a trailing `.item`
 * segment if present (used as a flow label — see `connectorLabel`):
 *  - `child.port[.item]` resolves to that port's marker (the common case).
 *  - a bare `child` (no port segment — e.g. a `connection` usage's redefined
 *    end bound directly to a part, as in `end mother ::> woman;`) resolves
 *    to an anchor at the child's own bottom-center, as if it had one
 *    unlabeled implicit port. This is what makes a plain part-to-part
 *    connection (no ports involved at all) drawable.
 * Returns `undefined` (and the connector is silently skipped) for anything
 * else this can't resolve: a path outside this container, or a named port
 * that doesn't exist on the resolved child.
 */
function resolvePortPoint(
  children: ChildLayout[],
  endpoint: string,
  childrenY: number
): { x: number; y: number; item?: string } | undefined {
  const dot = endpoint.indexOf('.');
  const childName = dot === -1 ? endpoint : endpoint.slice(0, dot);
  const child = children.find((c) => c.name === childName);
  if (!child) return undefined;
  if (dot === -1) {
    return { x: child.x + child.width / 2, y: childrenY + child.height };
  }
  const rest = endpoint.slice(dot + 1);
  const nextDot = rest.indexOf('.');
  const portName = nextDot === -1 ? rest : rest.slice(0, nextDot);
  const item = nextDot === -1 ? undefined : rest.slice(nextDot + 1);
  const port = child.ports.find((p) => p.name === portName);
  if (!port) return undefined;
  return { x: child.x + port.x, y: childrenY + child.height, item };
}

/** Prefers the conveyed item's name (matches spec's convention of labeling a wire with what flows over it) over a formal connector/flow name. */
function connectorLabel(c: ConnectorNode, fromItem?: string, toItem?: string): string | undefined {
  if (fromItem && fromItem === toItem) return fromItem;
  return fromItem ?? toItem ?? c.name;
}

function prepareContainerBox(
  stereotype: string,
  name: string,
  doc: string | undefined,
  rounded: boolean,
  children: ContainerChildInput[],
  connectors: ConnectorNode[]
): PreparedBox {
  const { layouts, contentWidth, maxHeight } = measureChildren(children);
  const childrenY = PAD + STEREOTYPE_H + TITLE_H + PAD;
  const width = Math.max(
    MIN_WIDTH,
    contentWidth + CONTAINER_PAD * 2,
    estimateTextWidth(name, 13, true) + CONTAINER_PAD * 2
  );
  const labelBottomY = childrenY + maxHeight + PORT_LABEL_H;

  // Resolve connectors to drawable lines up front, deduping identical
  // endpoint sets — several item flows often share one structural connector
  // (see README), and would otherwise draw as overlapping lines. Each gets
  // its own horizontal "fan" band below the port labels, both to keep the
  // routing legible when one child has several connectors, and so the line
  // doesn't cut through the label text sitting just below the row.
  const seenKeys = new Set<string>();
  const binaryLines: { x1: number; y1: number; x2: number; y2: number; midY: number; label?: string }[] = [];
  const junctions: { points: { x: number; y: number }[]; laneY: number; label?: string }[] = [];
  for (const c of connectors) {
    const resolved = c.ends.map((e) => resolvePortPoint(layouts, e, childrenY)).filter((p) => p !== undefined);
    if (resolved.length < 2) continue;
    const key = resolved
      .map((p) => `${p.x},${p.y}`)
      .sort()
      .join('|');
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const laneY = labelBottomY + CONNECTOR_BASE_DROOP + (binaryLines.length + junctions.length) * CONNECTOR_FAN_STEP;
    if (resolved.length === 2) {
      const [from, to] = resolved;
      binaryLines.push({
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
        midY: laneY,
        label: connectorLabel(c, from.item, to.item),
      });
    } else {
      // n-ary connector (`connect (a ::> x, b ::> y, c ::> z);`): drawn as a
      // junction point with one branch per end, since there's no single
      // "from"/"to" pair to route between.
      junctions.push({ points: resolved, laneY, label: c.name });
    }
  }

  const allLaneYs = [...binaryLines.map((l) => l.midY), ...junctions.map((j) => j.laneY)];
  const height = (allLaneYs.length ? Math.max(...allLaneYs) : labelBottomY + CONNECTOR_BASE_DROOP) + CONTAINER_PAD;

  return {
    width,
    height,
    doc,
    render(node) {
      boxRect(node, 0, 0, width, height, rounded);
      drawHeader(node, width, stereotype, name);

      // Orthogonal ("staple") routing rather than a smooth curve: each
      // connector drops straight down to its own lane, travels across, then
      // drops into the target. Right-angle crossings stay legible where two
      // curves sharing a lane would visually blend into each other — the
      // usual reason schematic/IBD tools route this way rather than curved.
      // An arrowhead marks the `to` end (flow direction), and the conveyed
      // item's name (or the connector's own name, if given) labels the wire,
      // matching the spec's own "Connecting Parts" notation.
      for (const line of binaryLines) {
        const midY = line.midY;
        node
          .append('path')
          .attr('class', 'connector')
          .attr(
            'd',
            `M ${line.x1},${line.y1} L ${line.x1},${midY} L ${line.x2},${midY} L ${line.x2},${line.y2}`
          );
        node
          .append('polygon')
          .attr('class', 'connector-arrow')
          .attr(
            'points',
            `${line.x2 - ARROW_SIZE},${line.y2 + ARROW_SIZE * 1.6} ${line.x2 + ARROW_SIZE},${line.y2 + ARROW_SIZE * 1.6} ${line.x2},${line.y2}`
          );
        if (line.label) {
          node
            .append('text')
            .attr('class', 'connector-label')
            .attr('x', (line.x1 + line.x2) / 2)
            .attr('y', midY - 3)
            .attr('text-anchor', 'middle')
            .attr('font-size', '9px')
            .text(line.label);
        }
      }

      // N-ary connector: one branch per end, meeting at a small junction dot.
      // No arrowhead (undirected) — a plain filled circle marks the join,
      // matching the general UML convention for an n-ary association.
      for (const junction of junctions) {
        const xs = junction.points.map((pt) => pt.x);
        const junctionX = xs.reduce((a, b) => a + b, 0) / xs.length;
        const junctionY = junction.laneY;
        for (const pt of junction.points) {
          node
            .append('path')
            .attr('class', 'connector')
            .attr('d', `M ${pt.x},${pt.y} L ${pt.x},${junctionY} L ${junctionX},${junctionY}`);
        }
        node
          .append('circle')
          .attr('class', 'connector-junction')
          .attr('cx', junctionX)
          .attr('cy', junctionY)
          .attr('r', ARROW_SIZE * 0.8);
        if (junction.label) {
          node
            .append('text')
            .attr('class', 'connector-label')
            .attr('x', junctionX)
            .attr('y', junctionY - ARROW_SIZE - 3)
            .attr('text-anchor', 'middle')
            .attr('font-size', '9px')
            .text(junction.label);
        }
      }

      for (const child of layouts) {
        const childNode = node
          .append('g')
          .attr('class', 'child')
          .attr('transform', `translate(${child.x},${childrenY})`);

        boxRect(childNode, 0, 0, child.width, child.height, true);

        childNode
          .append('text')
          .attr('class', 'member')
          .attr('x', child.width / 2)
          .attr('y', child.height / 2 + 4)
          .attr('text-anchor', 'middle')
          .attr('font-size', '12px')
          .text(childLabel(child.name, child.type, child.typeKind));

        for (const port of child.ports) {
          childNode
            .append('rect')
            .attr('class', 'port')
            .attr('x', port.x - PORT_SIZE / 2)
            .attr('y', child.height - PORT_SIZE / 2)
            .attr('width', PORT_SIZE)
            .attr('height', PORT_SIZE);

          childNode
            .append('text')
            .attr('class', 'compartment-label')
            .attr('x', port.x)
            .attr('y', child.height + PORT_SIZE / 2 + PORT_LABEL_H * 0.8)
            .attr('text-anchor', 'middle')
            .attr('font-size', '9px')
            .text(port.name);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Composition trees: a part def/usage with nested `part` containment but no
// connectors, drawn as the spec's own decomposition-tree notation — a
// composition diamond under the parent, org-chart lines fanning down to
// child boxes, recursively for however deep the containment goes.
// ---------------------------------------------------------------------------

interface TreeDataNode {
  label: string;
  children: TreeDataNode[];
}

function treeUsageLabel(usage: PartUsageNode): string {
  const base = `${usage.name}${typeSuffix(usage.type, usage.typeKind)}`;
  return usage.multiplicity ? `${base} [${usage.multiplicity}]` : base;
}

/** Recursively resolves each part usage's own containment (if its type is itself a def with parts), guarding against cycles and runaway depth. */
function buildTreeChildren(
  parts: PartUsageNode[],
  byName: Map<string, DefinitionNode>,
  visited: ReadonlySet<string>,
  depth: number
): TreeDataNode[] {
  return parts.map((usage) => {
    const label = treeUsageLabel(usage);
    if (depth >= MAX_TREE_DEPTH || !usage.type || visited.has(usage.type)) {
      return { label, children: [] };
    }
    const childDef = byName.get(usage.type);
    if (childDef?.kind !== 'partDef' || !childDef.parts.length) {
      return { label, children: [] };
    }
    const nextVisited = new Set(visited);
    nextVisited.add(usage.type);
    return { label, children: buildTreeChildren(childDef.parts, byName, nextVisited, depth + 1) };
  });
}

interface TreeSubtreeLayout {
  label: string;
  boxWidth: number;
  boxHeight: number;
  subtreeWidth: number;
  children: TreeSubtreeLayout[];
}

function measureTreeNode(node: TreeDataNode): TreeSubtreeLayout {
  const boxWidth = Math.max(
    CHILD_MIN_WIDTH,
    estimateTextWidth(node.label, 11.5) + CHILD_PAD * 2,
    estimateTextWidth('«part»', 10.5) + CHILD_PAD * 2
  );
  const boxHeight = CHILD_PAD + STEREOTYPE_H + TITLE_H * 0.7 + CHILD_PAD;
  const children = node.children.map(measureTreeNode);
  const childrenWidth = children.length
    ? children.reduce((sum, c) => sum + c.subtreeWidth, 0) + (children.length - 1) * TREE_CHILD_GAP
    : 0;
  return { label: node.label, boxWidth, boxHeight, subtreeWidth: Math.max(boxWidth, childrenWidth), children };
}

function subtreeHeight(layout: TreeSubtreeLayout): number {
  if (!layout.children.length) return layout.boxHeight;
  return layout.boxHeight + TREE_LEVEL_GAP + Math.max(...layout.children.map(subtreeHeight));
}

function drawSimpleUsageBox(node: G, x: number, y: number, width: number, height: number, label: string): void {
  const box = node.append('g').attr('transform', `translate(${x},${y})`);
  boxRect(box, 0, 0, width, height, true);
  box
    .append('text')
    .attr('class', 'stereotype')
    .attr('x', width / 2)
    .attr('y', CHILD_PAD + STEREOTYPE_H * 0.6)
    .attr('text-anchor', 'middle')
    .attr('font-size', '9.5px')
    .text('«part»');
  box
    .append('text')
    .attr('class', 'member')
    .attr('x', width / 2)
    .attr('y', height - CHILD_PAD - 2)
    .attr('text-anchor', 'middle')
    .attr('font-size', '11px')
    .text(label);
}

function drawTreeDiamond(node: G, cx: number, cy: number): void {
  node
    .append('polygon')
    .attr('class', 'tree-diamond')
    .attr(
      'points',
      `${cx},${cy - TREE_DIAMOND} ${cx + TREE_DIAMOND},${cy} ${cx},${cy + TREE_DIAMOND} ${cx - TREE_DIAMOND},${cy}`
    );
}

/** Draws one subtree (its own box, then recursively its children beneath a composition diamond) within the horizontal span [x, x + layout.subtreeWidth]. */
function drawTreeSubtree(node: G, layout: TreeSubtreeLayout, x: number, y: number): void {
  const boxX = x + (layout.subtreeWidth - layout.boxWidth) / 2;
  drawSimpleUsageBox(node, boxX, y, layout.boxWidth, layout.boxHeight, layout.label);
  if (!layout.children.length) return;

  const diamondCx = boxX + layout.boxWidth / 2;
  // Top vertex touches the box's bottom border directly, per spec convention.
  const diamondCy = y + layout.boxHeight + TREE_DIAMOND;
  const barY = diamondCy + TREE_DIAMOND + TREE_STEM_MID;
  const childY = barY + TREE_STEM_BOTTOM;

  drawTreeDiamond(node, diamondCx, diamondCy);

  let cx = x;
  const childCenters: number[] = [];
  for (const child of layout.children) {
    childCenters.push(cx + child.subtreeWidth / 2);
    drawTreeSubtree(node, child, cx, childY);
    cx += child.subtreeWidth + TREE_CHILD_GAP;
  }

  if (childCenters.length === 1) {
    node
      .append('line')
      .attr('class', 'tree-line')
      .attr('x1', diamondCx)
      .attr('y1', diamondCy + TREE_DIAMOND)
      .attr('x2', childCenters[0])
      .attr('y2', childY);
  } else {
    node
      .append('line')
      .attr('class', 'tree-line')
      .attr('x1', diamondCx)
      .attr('y1', diamondCy + TREE_DIAMOND)
      .attr('x2', diamondCx)
      .attr('y2', barY);
    node
      .append('line')
      .attr('class', 'tree-line')
      .attr('x1', childCenters[0])
      .attr('y1', barY)
      .attr('x2', childCenters[childCenters.length - 1])
      .attr('y2', barY);
    for (const ccx of childCenters) {
      node.append('line').attr('class', 'tree-line').attr('x1', ccx).attr('y1', barY).attr('x2', ccx).attr('y2', childY);
    }
  }
}

function prepareTreeBox(
  stereotype: string,
  name: string,
  doc: string | undefined,
  rounded: boolean,
  parts: PartUsageNode[],
  byName: Map<string, DefinitionNode>
): PreparedBox {
  const children = buildTreeChildren(parts, byName, new Set(), 0).map(measureTreeNode);
  const parentWidth = Math.max(
    MIN_WIDTH,
    estimateTextWidth(name, 13, true) + PAD * 2,
    estimateTextWidth(`«${stereotype}»`, 11) + PAD * 2
  );
  const parentHeight = PAD + STEREOTYPE_H + TITLE_H + PAD;

  const childrenTotalWidth = children.reduce((sum, c) => sum + c.subtreeWidth, 0) + (children.length - 1) * TREE_CHILD_GAP;
  const width = Math.max(parentWidth, childrenTotalWidth);
  const maxChildSubtreeHeight = children.length ? Math.max(...children.map(subtreeHeight)) : 0;
  const height = parentHeight + TREE_LEVEL_GAP + maxChildSubtreeHeight + CONTAINER_PAD;

  return {
    width,
    height,
    doc,
    render(node) {
      const parentX = (width - parentWidth) / 2;
      boxRect(node, parentX, 0, parentWidth, parentHeight, rounded);
      drawHeader(node, parentWidth, stereotype, name, parentX);

      if (!children.length) return;

      const diamondCx = parentX + parentWidth / 2;
      // Top vertex touches the box's bottom border directly, per spec convention.
      const diamondCy = parentHeight + TREE_DIAMOND;
      const barY = diamondCy + TREE_DIAMOND + TREE_STEM_MID;
      const childY = barY + TREE_STEM_BOTTOM;

      drawTreeDiamond(node, diamondCx, diamondCy);

      let cx = (width - childrenTotalWidth) / 2;
      const childCenters: number[] = [];
      for (const child of children) {
        childCenters.push(cx + child.subtreeWidth / 2);
        drawTreeSubtree(node, child, cx, childY);
        cx += child.subtreeWidth + TREE_CHILD_GAP;
      }

      if (childCenters.length === 1) {
        node
          .append('line')
          .attr('class', 'tree-line')
          .attr('x1', diamondCx)
          .attr('y1', diamondCy + TREE_DIAMOND)
          .attr('x2', childCenters[0])
          .attr('y2', childY);
      } else {
        node
          .append('line')
          .attr('class', 'tree-line')
          .attr('x1', diamondCx)
          .attr('y1', diamondCy + TREE_DIAMOND)
          .attr('x2', diamondCx)
          .attr('y2', barY);
        node
          .append('line')
          .attr('class', 'tree-line')
          .attr('x1', childCenters[0])
          .attr('y1', barY)
          .attr('x2', childCenters[childCenters.length - 1])
          .attr('y2', barY);
        for (const ccx of childCenters) {
          node
            .append('line')
            .attr('class', 'tree-line')
            .attr('x1', ccx)
            .attr('y1', barY)
            .attr('x2', ccx)
            .attr('y2', childY);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Action flowcharts: an `action def`/usage with nested action containment
// and/or succession/start/done, drawn as a genuine flowchart — rounded
// action nodes, a filled start circle, a bordered "final" circle for done,
// solid succession arrows (with a bracketed guard label where one was
// given), and dashed data-flow arrows (reusing the same dependency-arrow
// shape built for satisfy/verify/trace/allocate). One level deep — a nested
// action's own body isn't expanded, same convention as the connector
// container. See README for exactly what's covered (round 1: no decision/
// merge/fork/join/loop nodes yet).
// ---------------------------------------------------------------------------

const ACTION_NODE_MIN_WIDTH = 90;
const ACTION_NODE_PAD = 10;
const ACTION_NODE_HEIGHT = 34;
const ACTION_ROW_GAP_X = 30;
const ACTION_ROW_GAP_Y = 44;
const ACTION_TERMINAL_R = 8;
const ACTION_DONE_OUTER_R = ACTION_TERMINAL_R + 3;
const ACTION_DONE_INNER_R = 4;
const ACTION_SUCC_ARROW_LEN = 8;
const ACTION_SUCC_ARROW_WIDTH = 7;

function actionStereotypeAndName(def: ActionDefNode): { stereotype: string; displayName: string } {
  if (def.isUsage) {
    return { stereotype: 'action', displayName: `${def.name}${typeSuffix(def.usageType, undefined)}` };
  }
  return { stereotype: 'action def', displayName: def.name };
}

function actionUsageLabel(a: ActionUsageNode): string {
  return a.type ? `${a.name} : ${a.type}` : a.name;
}

interface ActionFlowNode {
  id: string;
  kind: 'start' | 'done' | 'action';
  label?: string;
  width: number;
  height: number;
}

function buildActionFlowNodes(def: ActionDefNode): ActionFlowNode[] {
  const nodes: ActionFlowNode[] = [];
  if (def.hasStart) {
    nodes.push({ id: '__start__', kind: 'start', width: ACTION_TERMINAL_R * 2, height: ACTION_TERMINAL_R * 2 });
  }
  for (const a of def.actions) {
    const label = actionUsageLabel(a);
    const width = Math.max(ACTION_NODE_MIN_WIDTH, estimateTextWidth(label, 11, true) + ACTION_NODE_PAD * 2);
    nodes.push({ id: a.name, kind: 'action', label, width, height: ACTION_NODE_HEIGHT });
  }
  if (def.hasDone) {
    nodes.push({ id: '__done__', kind: 'done', width: ACTION_DONE_OUTER_R * 2, height: ACTION_DONE_OUTER_R * 2 });
  }
  return nodes;
}

/** Longest-path-from-a-source layering: each node's depth is one more than its deepest predecessor's, or 0 if it has none. A cycle (shouldn't occur in this round's grammar) defaults to depth 0 rather than looping forever. */
function computeActionDepths(nodeIds: string[], edges: { from?: string; to: string }[]): Map<string, number> {
  const incoming = new Map<string, string[]>();
  for (const id of nodeIds) incoming.set(id, []);
  for (const e of edges) {
    if (e.from && incoming.has(e.to) && incoming.has(e.from)) incoming.get(e.to)!.push(e.from);
  }
  const depth = new Map<string, number>();
  const resolving = new Set<string>();
  function resolve(id: string): number {
    if (depth.has(id)) return depth.get(id)!;
    if (resolving.has(id)) return 0;
    resolving.add(id);
    const preds = incoming.get(id) ?? [];
    const d = preds.length ? Math.max(...preds.map(resolve)) + 1 : 0;
    depth.set(id, d);
    resolving.delete(id);
    return d;
  }
  for (const id of nodeIds) resolve(id);
  return depth;
}

interface PositionedActionNode extends ActionFlowNode {
  x: number;
  y: number;
}

/** Groups nodes into rows by depth, centers each row, stacks rows top to bottom — a plain, uncrossed layered layout (no edge-crossing minimization; round 1's successions are simple enough not to need it). */
function layoutActionFlow(
  nodes: ActionFlowNode[],
  depths: Map<string, number>
): { positioned: PositionedActionNode[]; width: number; height: number } {
  const byDepth = new Map<number, ActionFlowNode[]>();
  for (const n of nodes) {
    const d = depths.get(n.id) ?? 0;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(n);
  }
  const depthsSorted = Array.from(byDepth.keys()).sort((a, b) => a - b);
  const rows = depthsSorted.map((d) => byDepth.get(d)!);
  const rowWidths = rows.map(
    (row) => row.reduce((sum, n) => sum + n.width, 0) + (row.length - 1) * ACTION_ROW_GAP_X
  );
  const contentWidth = Math.max(0, ...rowWidths);

  const positioned: PositionedActionNode[] = [];
  let y = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let x = (contentWidth - rowWidths[i]) / 2;
    let rowHeight = 0;
    for (const n of row) {
      positioned.push({ ...n, x, y });
      x += n.width + ACTION_ROW_GAP_X;
      rowHeight = Math.max(rowHeight, n.height);
    }
    y += rowHeight + ACTION_ROW_GAP_Y;
  }
  const height = Math.max(0, y - ACTION_ROW_GAP_Y);
  return { positioned, width: contentWidth, height };
}

function drawActionNode(node: G, n: PositionedActionNode): void {
  const cx = n.x + n.width / 2;
  const cy = n.y + n.height / 2;
  if (n.kind === 'start') {
    node.append('circle').attr('class', 'action-start').attr('cx', cx).attr('cy', cy).attr('r', ACTION_TERMINAL_R);
    return;
  }
  if (n.kind === 'done') {
    node
      .append('circle')
      .attr('class', 'action-done-outer')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', ACTION_DONE_OUTER_R);
    node
      .append('circle')
      .attr('class', 'action-done-inner')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', ACTION_DONE_INNER_R);
    return;
  }
  boxRect(node, n.x, n.y, n.width, n.height, true);
  node
    .append('text')
    .attr('class', 'member')
    .attr('x', cx)
    .attr('y', cy + 4)
    .attr('text-anchor', 'middle')
    .attr('font-size', '11px')
    .text(n.label ?? '');
}

/** A solid line with a small filled arrowhead — control-flow succession, distinct from the hollow/open/dashed arrows used elsewhere. An optional bracketed guard label sits at the midpoint. */
function drawSuccessionArrow(g: G, fromRect: Rect, toRect: Rect, label?: string): void {
  const fromCenter = rectCenter(fromRect);
  const toCenter = rectCenter(toRect);
  const tip = clipToRectBorder(toRect, fromCenter);
  const tail = clipToRectBorder(fromRect, toCenter);

  const dx = tip.x - tail.x;
  const dy = tip.y - tail.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const backX = tip.x - ux * ACTION_SUCC_ARROW_LEN;
  const backY = tip.y - uy * ACTION_SUCC_ARROW_LEN;
  const px = -uy;
  const py = ux;

  g.append('line').attr('class', 'succession-line').attr('x1', tail.x).attr('y1', tail.y).attr('x2', tip.x).attr('y2', tip.y);
  g.append('polygon')
    .attr('class', 'succession-arrow')
    .attr(
      'points',
      `${tip.x},${tip.y} ${backX + (px * ACTION_SUCC_ARROW_WIDTH) / 2},${backY + (py * ACTION_SUCC_ARROW_WIDTH) / 2} ${backX - (px * ACTION_SUCC_ARROW_WIDTH) / 2},${backY - (py * ACTION_SUCC_ARROW_WIDTH) / 2}`
    );

  if (label) {
    g.append('text')
      .attr('class', 'succession-label')
      .attr('x', (tail.x + tip.x) / 2)
      .attr('y', (tail.y + tip.y) / 2 - 4)
      .attr('text-anchor', 'middle')
      .attr('font-size', '9px')
      .text(label);
  }
}

/** Resolves a flow endpoint's dotted path to a drawn node: the first segment names the action, any remainder is kept as an item-name hint for the label (see `connectorLabel`'s analogous role for part connectors). */
function resolveActionFlowEndpoint(
  rectByName: Map<string, Rect>,
  path: string
): { rect: Rect; item?: string } | undefined {
  const dot = path.indexOf('.');
  const nodeName = dot === -1 ? path : path.slice(0, dot);
  const rect = rectByName.get(nodeName);
  if (!rect) return undefined;
  const item = dot === -1 ? undefined : path.slice(dot + 1);
  return { rect, item };
}

function prepareActionFlowBox(def: ActionDefNode): PreparedBox {
  const { stereotype, displayName } = actionStereotypeAndName(def);
  const headerHeight = PAD + STEREOTYPE_H + TITLE_H + PAD;

  const flowNodes = buildActionFlowNodes(def);
  const edges = def.successions.map((s) => ({ from: s.from, to: s.to }));
  const depths = computeActionDepths(
    flowNodes.map((n) => n.id),
    edges
  );
  const { positioned, width: contentWidth, height: contentHeight } = layoutActionFlow(flowNodes, depths);

  const headerWidth = estimateTextWidth(displayName, 13, true) + PAD * 2;
  const width = Math.max(MIN_WIDTH, contentWidth + CONTAINER_PAD * 2, headerWidth);
  const height = headerHeight + (positioned.length ? contentHeight + CONTAINER_PAD * 2 : CONTAINER_PAD);
  const xOffset = (width - contentWidth) / 2;
  const yOffset = headerHeight + CONTAINER_PAD;

  return {
    width,
    height,
    doc: def.doc,
    render(node) {
      boxRect(node, 0, 0, width, height, !!def.isUsage);
      drawHeader(node, width, stereotype, displayName);

      const rectByName = new Map<string, Rect>();
      for (const n of positioned) {
        const rect: Rect = { x: n.x + xOffset, y: n.y + yOffset, width: n.width, height: n.height };
        rectByName.set(n.id, rect);
        drawActionNode(node, { ...n, x: rect.x, y: rect.y });
      }

      for (const s of def.successions) {
        const fromRect = s.from ? rectByName.get(s.from) : undefined;
        const toRect = rectByName.get(s.to);
        if (!fromRect || !toRect) continue;
        drawSuccessionArrow(node, fromRect, toRect, s.guard ? `[${s.guard}]` : undefined);
      }

      for (const flow of def.flows) {
        if (flow.ends.length !== 2) continue;
        const from = resolveActionFlowEndpoint(rectByName, flow.ends[0]);
        const to = resolveActionFlowEndpoint(rectByName, flow.ends[1]);
        if (!from || !to) continue;
        const label = flow.name ?? (from.item && from.item === to.item ? from.item : (from.item ?? to.item ?? ''));
        drawDependencyArrow(node, from.rect, to.rect, label, 0, 0);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Top-level layout and draw
// ---------------------------------------------------------------------------

interface RenderEntry {
  box: PreparedBox;
  def: DefinitionNode;
}

function toRenderList(definitions: DefinitionNode[]): RenderEntry[] {
  const byName = new Map<string, DefinitionNode>();
  for (const def of definitions) byName.set(def.name, def);

  return definitions.map((def): RenderEntry => {
    if (def.kind === 'partDef' && def.parts.length) {
      const { stereotype, displayName } = partStereotypeAndName(def);
      const rounded = !!def.isUsage;
      if (def.connectors.length) {
        const children: ContainerChildInput[] = def.parts.map((usage) => {
          const childDef = usage.type ? byName.get(usage.type) : undefined;
          const ports = childDef && childDef.kind === 'partDef' ? childDef.ports.map((p) => p.name) : [];
          return { name: usage.name, type: usage.type, typeKind: usage.typeKind, ports };
        });
        return { box: prepareContainerBox(stereotype, displayName, def.doc, rounded, children, def.connectors), def };
      }
      return { box: prepareTreeBox(stereotype, displayName, def.doc, rounded, def.parts, byName), def };
    }
    if (def.kind === 'useCaseDef') {
      return { box: prepareUseCaseBox(def), def };
    }
    if (def.kind === 'actionDef' && (def.actions.length || def.hasStart || def.hasDone)) {
      return { box: prepareActionFlowBox(def), def };
    }
    return { box: prepareLeafBox(def), def };
  });
}

interface Positioned {
  box: PreparedBox;
  def: DefinitionNode;
  x: number;
  y: number;
}

function layout(entries: RenderEntry[], maxRowWidth: number): Positioned[] {
  const positioned: Positioned[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;

  for (const entry of entries) {
    if (x > 0 && x + entry.box.width > maxRowWidth) {
      x = 0;
      y += rowHeight + GAP_Y;
      rowHeight = 0;
    }
    positioned.push({ box: entry.box, def: entry.def, x, y });
    x += entry.box.width + GAP_X;
    rowHeight = Math.max(rowHeight, entry.box.height);
  }

  return positioned;
}

// ---------------------------------------------------------------------------
// Specialization arrows: a hollow-triangle generalization arrow (per the
// spec's own graphical notation) drawn between two top-level DEFINITION
// boxes that share a `:>` specialization relationship (`part def X :> Y`,
// `port def X :> Y`, etc.) — tip at the supertype end. Only drawn when the
// supertype resolves to another box actually present in this diagram; a
// library supertype (e.g. `:> ISQ::MassValue`) is parsed and kept on the
// node, but has nothing in the diagram to point at, so it's skipped.
// ---------------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectCenter(r: Rect): { x: number; y: number } {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** The point on `r`'s border along the ray from its own center toward `target`. */
function clipToRectBorder(r: Rect, target: { x: number; y: number }): { x: number; y: number } {
  const c = rectCenter(r);
  const dx = target.x - c.x;
  const dy = target.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = r.width / 2;
  const hh = r.height / 2;
  const scaleX = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

/** A plain line from the subtype box to the supertype box, with a hollow (background-filled) triangle at the supertype end — the spec's own generalization-arrow notation. */
function drawSpecializationArrow(g: G, subRect: Rect, superRect: Rect): void {
  const subCenter = rectCenter(subRect);
  const superCenter = rectCenter(superRect);
  const tip = clipToRectBorder(superRect, subCenter);
  const tail = clipToRectBorder(subRect, superCenter);

  const dx = tip.x - tail.x;
  const dy = tip.y - tail.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const baseX = tip.x - ux * SPEC_ARROW_LEN;
  const baseY = tip.y - uy * SPEC_ARROW_LEN;
  const px = -uy;
  const py = ux;

  g.append('line')
    .attr('class', 'specialization-line')
    .attr('x1', tail.x)
    .attr('y1', tail.y)
    .attr('x2', baseX)
    .attr('y2', baseY);

  g.append('polygon')
    .attr('class', 'specialization-arrow')
    .attr(
      'points',
      `${tip.x},${tip.y} ${baseX + (px * SPEC_ARROW_WIDTH) / 2},${baseY + (py * SPEC_ARROW_WIDTH) / 2} ${baseX - (px * SPEC_ARROW_WIDTH) / 2},${baseY - (py * SPEC_ARROW_WIDTH) / 2}`
    );
}

/**
 * `A::B::Name` -> `Name`, `bvm.coinAcceptor` -> `coinAcceptor` — packages
 * are flattened and top-level boxes matched by simple name only, so a
 * qualified supertype or a dotted instance path is resolved by its last
 * segment. This is a best-effort heuristic, not real path resolution: it
 * finds a box literally named `coinAcceptor`, not "the `coinAcceptor` child
 * of whatever `bvm` is typed as" — see the traceability section below and
 * "Known limitations" in the README for what this does and doesn't resolve.
 */
function lastPathSegment(path: string): string {
  const normalized = path.replace(/::/g, '.');
  const idx = normalized.lastIndexOf('.');
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

function buildRectsByName(positioned: Positioned[]): Map<string, Rect> {
  const rectsByName = new Map<string, Rect>();
  for (const p of positioned) {
    rectsByName.set(p.def.name, { x: p.x, y: p.y, width: p.box.width, height: p.box.height });
  }
  return rectsByName;
}

function drawSpecializationArrows(g: G, positioned: Positioned[], rectsByName: Map<string, Rect>): void {
  for (const p of positioned) {
    const superType = p.def.superType;
    if (!superType) continue;
    const superRect = rectsByName.get(lastPathSegment(superType));
    if (!superRect) continue;
    const subRect = rectsByName.get(p.def.name)!;
    if (subRect === superRect) continue;
    drawSpecializationArrow(g, subRect, superRect);
  }
}

// ---------------------------------------------------------------------------
// Traceability arrows: dashed dependency arrows for the top-level
// `satisfy`/`verify`/`trace`/`allocate` statements this subset parses (see
// `TraceabilityNode`), plus a requirement usage's `:>` derivation — SysML v2
// has no standalone `deriveReqt` keyword, so derivation is ordinary usage
// subsetting, confirmed against `examples/bvm.mmd`. Each is a plain
// open-arrowhead dashed line labeled with its own guillemet stereotype,
// distinct from the hollow-triangle specialization arrow above. Only drawn
// when both ends resolve to a box in this diagram — see `lastPathSegment`'s
// doc comment for why a multi-segment instance path (`by bvm.coinAcceptor`)
// usually won't.
// ---------------------------------------------------------------------------

const DEP_ARROW_LEN = 10;
const DEP_ARROW_WIDTH = 8;
const DEP_NUDGE_STEP = 7;

/**
 * Spreads repeated attachments to the same box border out from center:
 * 0, +1, -1, +2, -2, ... (as a step count, scaled by `DEP_NUDGE_STEP`) — so
 * several dependency arrows sharing an endpoint (a requirement commonly has
 * a `satisfy` AND a `verify` AND a `trace` all landing on it) fan out along
 * its border instead of drawing exactly on top of one another when the
 * boxes involved happen to be collinear in the grid layout.
 */
function nudgeOffset(n: number): number {
  if (n === 0) return 0;
  const magnitude = Math.ceil(n / 2);
  const sign = n % 2 === 1 ? 1 : -1;
  return magnitude * sign * DEP_NUDGE_STEP;
}

/** A dashed line with an open (unfilled) arrowhead and a guillemet label — the generic dependency-arrow shape shared by satisfy/verify/trace/allocate/derive. Tip at `toRect`. `tailNudge`/`tipNudge` spread out arrows sharing an endpoint (see `nudgeOffset`). */
function drawDependencyArrow(
  g: G,
  fromRect: Rect,
  toRect: Rect,
  label: string,
  tailNudge: number,
  tipNudge: number
): void {
  const fromCenter = rectCenter(fromRect);
  const toCenter = rectCenter(toRect);
  let tip = clipToRectBorder(toRect, fromCenter);
  let tail = clipToRectBorder(fromRect, toCenter);

  const dx = tip.x - tail.x;
  const dy = tip.y - tail.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;

  const tipOffset = nudgeOffset(tipNudge);
  const tailOffset = nudgeOffset(tailNudge);
  tip = { x: tip.x + px * tipOffset, y: tip.y + py * tipOffset };
  tail = { x: tail.x + px * tailOffset, y: tail.y + py * tailOffset };

  const backX = tip.x - ux * DEP_ARROW_LEN;
  const backY = tip.y - uy * DEP_ARROW_LEN;
  const leftX = backX + (px * DEP_ARROW_WIDTH) / 2;
  const leftY = backY + (py * DEP_ARROW_WIDTH) / 2;
  const rightX = backX - (px * DEP_ARROW_WIDTH) / 2;
  const rightY = backY - (py * DEP_ARROW_WIDTH) / 2;

  g.append('line')
    .attr('class', 'dependency-line')
    .attr('x1', tail.x)
    .attr('y1', tail.y)
    .attr('x2', tip.x)
    .attr('y2', tip.y);

  g.append('polyline')
    .attr('class', 'dependency-arrowhead')
    .attr('points', `${leftX},${leftY} ${tip.x},${tip.y} ${rightX},${rightY}`);

  g.append('text')
    .attr('class', 'dependency-label')
    .attr('x', (tail.x + tip.x) / 2)
    .attr('y', (tail.y + tip.y) / 2 - 4)
    .attr('text-anchor', 'middle')
    .attr('font-size', '9px')
    .text(label);
}

/** `satisfy req by target` / `verify req by target`: drawn from the satisfying/verifying element (`target`) to the requirement (`req`) — the element depends on fulfilling the requirement, per the spec's own dependency-arrow convention. `trace`/`allocate` point from source to target the same way their textual `to` reads. */
function traceabilityArrowEnds(t: { kind: TraceabilityNode['kind']; source: string; target: string }): {
  from: string;
  to: string;
  label: string;
} {
  if (t.kind === 'satisfy' || t.kind === 'verify') {
    return { from: t.target, to: t.source, label: `«${t.kind}»` };
  }
  return { from: t.source, to: t.target, label: `«${t.kind}»` };
}

function drawTraceabilityArrows(
  g: G,
  positioned: Positioned[],
  rectsByName: Map<string, Rect>,
  traceability: TraceabilityNode[]
): void {
  // Shared across every dependency arrow drawn here (satisfy/verify/trace/
  // allocate/derive alike), keyed by rect identity, so two different
  // relationships landing on the same box still fan out from one another —
  // see `nudgeOffset`.
  const nudgeCounts = new Map<Rect, number>();
  const nextNudge = (rect: Rect): number => {
    const n = nudgeCounts.get(rect) ?? 0;
    nudgeCounts.set(rect, n + 1);
    return n;
  };

  for (const t of traceability) {
    const { from, to, label } = traceabilityArrowEnds(t);
    const fromRect = rectsByName.get(lastPathSegment(from));
    const toRect = rectsByName.get(lastPathSegment(to));
    if (!fromRect || !toRect || fromRect === toRect) continue;
    drawDependencyArrow(g, fromRect, toRect, label, nextNudge(fromRect), nextNudge(toRect));
  }

  // A requirement usage's `:>` derivation — tip at the more general
  // requirement it narrows, same direction convention as specialization.
  for (const p of positioned) {
    if (p.def.kind !== 'requirementDef' || !p.def.derivedFrom) continue;
    const fromRect = rectsByName.get(p.def.name);
    const toRect = rectsByName.get(lastPathSegment(p.def.derivedFrom));
    if (!fromRect || !toRect || fromRect === toRect) continue;
    drawDependencyArrow(g, fromRect, toRect, '«derive»', nextNudge(fromRect), nextNudge(toRect));
  }
}

export const draw = (_text: string, id: string, _version: string): void => {
  try {
    const model = getModel();
    const conf = getConfig() as {
      securityLevel?: string;
      sysml?: { useMaxWidth?: boolean; wrapWidth?: number };
    };
    const useMaxWidth = conf.sysml?.useMaxWidth ?? true;
    const maxRowWidth = conf.sysml?.wrapWidth ?? 900;

    // Handle root and Document for when rendering in sandbox mode, same as mermaid's own diagrams.
    let sandboxElement: Selection<HTMLIFrameElement, unknown, HTMLElement, unknown> | undefined;
    if (conf.securityLevel === 'sandbox') {
      sandboxElement = select<HTMLIFrameElement, unknown>(`#i${id}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const root: any =
      conf.securityLevel === 'sandbox'
        ? select((sandboxElement!.node() as HTMLIFrameElement).contentDocument!.body)
        : select('body');

    const svg = root.select(`#${id}`) as Selection<SVGSVGElement, unknown, null, undefined>;
    svg.attr('aria-roledescription', 'sysml-v2');

    const accTitle = getAccTitle();
    const accDescription = getAccDescription();
    if (accTitle) svg.append('title').text(accTitle);
    if (accDescription) svg.append('desc').text(accDescription);

    const g = svg.append('g').attr('class', 'sysml-v2') as unknown as G;

    if (!model.definitions.length) {
      g.append('text')
        .attr('x', 0)
        .attr('y', 16)
        .attr('font-size', '13px')
        .text('No SysML v2 part/port/interface definitions found.');
      setupGraphViewbox(undefined, svg, 8, useMaxWidth);
      return;
    }

    const positioned = layout(toRenderList(model.definitions), maxRowWidth);
    for (const { box, x, y } of positioned) {
      const node = g.append('g').attr('class', 'node').attr('transform', `translate(${x},${y})`);
      if (box.doc) node.append('title').text(box.doc);
      box.render(node);
    }
    const rectsByName = buildRectsByName(positioned);
    drawSpecializationArrows(g, positioned, rectsByName);
    drawTraceabilityArrows(g, positioned, rectsByName, model.traceability);

    setupGraphViewbox(undefined, svg, 8, useMaxWidth);
  } catch (e) {
    log.error('Error while rendering SysML v2 diagram');
    log.error(e instanceof Error ? e.message : String(e));
    throw e;
  }
};

export default { draw };
