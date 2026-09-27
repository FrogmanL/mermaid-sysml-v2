import { select } from 'd3';
import type { Selection } from 'd3';
import { log, getConfig, setupGraphViewbox } from './mermaidUtils.js';
import { getModel, getAccTitle, getAccDescription } from './db.js';
import type { DefinitionNode } from './parser/ast.js';

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

interface RenderCompartment {
  label?: string;
  lines: string[];
}

interface RenderBox {
  stereotype: 'part' | 'port' | 'interface';
  name: string;
  doc?: string;
  compartments: RenderCompartment[];
}

function toBoxes(definitions: DefinitionNode[]): RenderBox[] {
  return definitions.map((def): RenderBox => {
    if (def.kind === 'partDef') {
      const compartments: RenderCompartment[] = [];
      if (def.attributes.length) {
        compartments.push({
          label: 'attributes',
          lines: def.attributes.map((a) =>
            a.value !== undefined
              ? `${a.name} = ${a.value}`
              : a.type
                ? `${a.name} : ${a.type}`
                : a.name
          ),
        });
      }
      if (def.ports.length) {
        compartments.push({
          label: 'ports',
          lines: def.ports.map((p) => (p.type ? `${p.name} : ${p.type}` : p.name)),
        });
      }
      return { stereotype: 'part', name: def.name, doc: def.doc, compartments };
    }
    if (def.kind === 'portDef') {
      const compartments: RenderCompartment[] = [];
      if (def.fields.length) {
        compartments.push({
          label: 'flow properties',
          lines: def.fields.map(
            (f) => `${f.direction} ${f.name}${f.type ? ` : ${f.type}` : ''}`
          ),
        });
      }
      return { stereotype: 'port', name: def.name, doc: def.doc, compartments };
    }
    // interfaceDef
    const compartments: RenderCompartment[] = [];
    if (def.ends.length) {
      compartments.push({
        label: 'ends',
        lines: def.ends.map((e) => (e.type ? `${e.name} : ${e.type}` : e.name)),
      });
    }
    if (def.flows.length) {
      compartments.push({
        label: 'flows',
        lines: def.flows.map((f) => `${f.from} → ${f.to}`),
      });
    }
    return { stereotype: 'interface', name: def.name, doc: def.doc, compartments };
  });
}

function estimateTextWidth(text: string, fontSize: number, bold = false): number {
  return text.length * fontSize * (bold ? 0.66 : 0.6);
}

function measureBox(box: RenderBox): { width: number; height: number } {
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

interface PositionedBox extends RenderBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function layout(boxes: RenderBox[], maxRowWidth: number): PositionedBox[] {
  const positioned: PositionedBox[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;

  for (const box of boxes) {
    const { width, height } = measureBox(box);
    if (x > 0 && x + width > maxRowWidth) {
      x = 0;
      y += rowHeight + GAP_Y;
      rowHeight = 0;
    }
    positioned.push({ ...box, x, y, width, height });
    x += width + GAP_X;
    rowHeight = Math.max(rowHeight, height);
  }

  return positioned;
}

function drawBox(parent: Selection<SVGGElement, unknown, null, undefined>, box: PositionedBox): void {
  const node = parent
    .append('g')
    .attr('class', 'node')
    .attr('transform', `translate(${box.x},${box.y})`);

  node.append('rect').attr('x', 0).attr('y', 0).attr('width', box.width).attr('height', box.height);

  if (box.doc) {
    node.append('title').text(box.doc);
  }

  let cy = PAD;

  node
    .append('text')
    .attr('class', 'stereotype')
    .attr('x', box.width / 2)
    .attr('y', cy + STEREOTYPE_H * 0.75)
    .attr('text-anchor', 'middle')
    .attr('font-size', '11px')
    .text(`«${box.stereotype}»`);
  cy += STEREOTYPE_H;

  node
    .append('text')
    .attr('class', 'title')
    .attr('x', box.width / 2)
    .attr('y', cy + TITLE_H * 0.68)
    .attr('text-anchor', 'middle')
    .attr('font-size', '13px')
    .text(box.name);
  cy += TITLE_H + PAD;

  for (const comp of box.compartments) {
    node
      .append('line')
      .attr('class', 'divider')
      .attr('x1', 0)
      .attr('y1', cy)
      .attr('x2', box.width)
      .attr('y2', cy);
    cy += DIVIDER_GAP;

    if (comp.label) {
      node
        .append('text')
        .attr('class', 'compartment-label')
        .attr('x', PAD)
        .attr('y', cy + LABEL_H * 0.75)
        .attr('font-size', '10.5px')
        .text(comp.label);
      cy += LABEL_H;
    }

    for (const line of comp.lines) {
      node
        .append('text')
        .attr('class', 'member')
        .attr('x', PAD)
        .attr('y', cy + ITEM_H * 0.75)
        .attr('font-size', '11.5px')
        .text(line);
      cy += ITEM_H;
    }
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

    const g = svg.append('g').attr('class', 'sysml-v2');

    if (!model.definitions.length) {
      g.append('text')
        .attr('x', 0)
        .attr('y', 16)
        .attr('font-size', '13px')
        .text('No SysML v2 part/port/interface definitions found.');
      setupGraphViewbox(undefined, svg, 8, useMaxWidth);
      return;
    }

    const boxes = layout(toBoxes(model.definitions), maxRowWidth);
    for (const box of boxes) {
      drawBox(g as unknown as Selection<SVGGElement, unknown, null, undefined>, box);
    }

    setupGraphViewbox(undefined, svg, 8, useMaxWidth);
  } catch (e) {
    log.error('Error while rendering SysML v2 diagram');
    log.error(e instanceof Error ? e.message : String(e));
    throw e;
  }
};

export default { draw };
