import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { select } from 'd3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as db from '../src/db.js';
import { injectUtils } from '../src/mermaidUtils.js';
import { draw } from '../src/renderer.js';

const vehicleSource = readFileSync(join(process.cwd(), 'examples/vehicle.mmd'), 'utf-8');
const bvmSource = readFileSync(join(process.cwd(), 'examples/bvm.mmd'), 'utf-8');

const noop = () => undefined;

beforeEach(() => {
  db.clear();
  document.body.innerHTML = '';
  injectUtils(
    { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop },
    noop,
    () => ({ sysml: {} }),
    (s: string) => s,
    vi.fn(),
    () => ({})
  );
});

describe('renderer.draw', () => {
  it('draws one node per parsed definition', () => {
    db.parse(vehicleSource);
    select(document.body).append('svg').attr('id', 'sysml-test-1');

    draw('', 'sysml-test-1', '0.0.0');

    const nodes = document.querySelectorAll('#sysml-test-1 .node');
    expect(nodes.length).toBe(db.getModel().definitions.length);
  });

  it('renders a fallback message when there are no definitions', () => {
    db.parse('sysml-v2\n');
    select(document.body).append('svg').attr('id', 'sysml-test-2');

    draw('', 'sysml-test-2', '0.0.0');

    expect(document.querySelector('#sysml-test-2 .node')).toBeNull();
    expect(document.querySelector('#sysml-test-2')?.textContent).toContain(
      'No SysML v2 part/port/interface definitions found.'
    );
  });

  it('renders the interface def flows compartment with the parsed arrow text', () => {
    db.parse(vehicleSource);
    select(document.body).append('svg').attr('id', 'sysml-test-3');

    draw('', 'sysml-test-3', '0.0.0');

    const texts = Array.from(document.querySelectorAll('#sysml-test-3 .member')).map(
      (el) => el.textContent
    );
    expect(texts).toContain('axleMount.transferredTorque → hub.appliedTorque');
  });

  // BVM's ControlUnit is itself a (single-child) container, since it
  // contains `part inventory : Product [8];` — so these tests scope to the
  // BVM node specifically rather than counting `.child`/`.connector` across
  // the whole document.
  function findNodeByTitle(root: ParentNode, title: string): Element {
    const node = Array.from(root.querySelectorAll('.node')).find(
      (n) => n.querySelector(':scope > .title')?.textContent === title
    );
    if (!node) throw new Error(`no top-level node titled "${title}"`);
    return node;
  }

  it('draws a container box with one child per contained part and a connector per connect statement', () => {
    db.parse(bvmSource);
    select(document.body).append('svg').attr('id', 'sysml-test-4');

    draw('', 'sysml-test-4', '0.0.0');

    const bvmNode = findNodeByTitle(document.querySelector('#sysml-test-4')!, 'BVM');
    const children = bvmNode.querySelectorAll(':scope > .child');
    expect(children.length).toBe(5);

    const connectors = bvmNode.querySelectorAll(':scope > .connector');
    expect(connectors.length).toBe(4);

    const childLabels = Array.from(children)
      .flatMap((child) => Array.from(child.querySelectorAll('.member')))
      .map((el) => el.textContent);
    expect(childLabels).toContain('coinAcceptor : CoinAcceptor');
  });

  it('draws a port marker labeled with the port name on each child that resolves one', () => {
    db.parse(bvmSource);
    select(document.body).append('svg').attr('id', 'sysml-test-5');

    draw('', 'sysml-test-5', '0.0.0');

    const bvmNode = findNodeByTitle(document.querySelector('#sysml-test-5')!, 'BVM');
    const portLabels = Array.from(bvmNode.querySelectorAll('.child .compartment-label')).map(
      (el) => el.textContent
    );
    expect(portLabels).toEqual(
      expect.arrayContaining(['coinOut', 'coinIn', 'dispenseOut', 'changeOut', 'displayOut'])
    );
  });
});
