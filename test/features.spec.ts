import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { select } from 'd3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as db from '../src/db.js';
import { injectUtils } from '../src/mermaidUtils.js';
import { draw } from '../src/renderer.js';

const featuresDir = join(process.cwd(), 'examples/features');
const files = readdirSync(featuresDir).filter((f) => f.endsWith('.mmd'));

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

// Each file under examples/features/ demonstrates one feature cluster for
// visual review (see index.html's "Feature showcase" dropdown group). This
// just guards against a future change silently breaking one of them — the
// actual visual review happens in the browser, not here.
describe('feature showcase examples', () => {
  it('found at least one feature file', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} parses and renders without throwing, and draws at least one node`, () => {
      const source = readFileSync(join(featuresDir, file), 'utf-8');
      db.parse(source);
      expect(db.getModel().definitions.length).toBeGreaterThan(0);

      const id = `sysml-feature-${file.replace(/\W/g, '-')}`;
      select(document.body).append('svg').attr('id', id);

      expect(() => draw('', id, '0.0.0')).not.toThrow();
      expect(document.querySelectorAll(`#${id} .node`).length).toBeGreaterThan(0);
    });
  }
});
