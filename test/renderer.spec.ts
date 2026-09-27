import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { select } from 'd3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as db from '../src/db.js';
import { injectUtils } from '../src/mermaidUtils.js';
import { draw } from '../src/renderer.js';

const vehicleSource = readFileSync(join(process.cwd(), 'examples/vehicle.mmd'), 'utf-8');

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
});
