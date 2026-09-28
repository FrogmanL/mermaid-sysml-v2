import { describe, expect, it } from 'vitest';
import getStyles from '../src/styles.js';

// Regression: `.connector` and `.port` are classes on the <path>/<rect>
// elements themselves (see renderer.ts), not on a wrapping element. A
// selector written as `.connector path` or `.port rect` silently never
// matches anything — the elements then fall back to SVG's default black
// fill, turning connector lines into solid filled blobs. DOM-structure
// tests don't catch this (the elements and attributes are all correct;
// only the applied *style* is wrong), so this asserts the stylesheet
// string uses the element-then-class form instead.
describe('getStyles', () => {
  it('targets every element-classed shape directly, not as a descendant', () => {
    const css = getStyles({});
    const elementClassed: [string, string][] = [
      ['path', 'connector'],
      ['rect', 'port'],
      ['polygon', 'connector-arrow'],
      ['text', 'connector-label'],
      ['line', 'tree-line'],
      ['polygon', 'tree-diamond'],
      ['circle', 'connector-junction'],
      ['line', 'specialization-line'],
      ['polygon', 'specialization-arrow'],
      ['line', 'dependency-line'],
      ['polyline', 'dependency-arrowhead'],
      ['text', 'dependency-label'],
      ['circle', 'actor-icon'],
      ['line', 'actor-limb'],
      ['text', 'actor-label'],
      ['line', 'actor-association'],
      ['circle', 'action-start'],
      ['circle', 'action-done-outer'],
      ['circle', 'action-done-inner'],
      ['line', 'succession-line'],
      ['polygon', 'succession-arrow'],
      ['text', 'succession-label'],
      ['polygon', 'action-decision'],
      ['rect', 'action-fork-join'],
    ];
    for (const [el, cls] of elementClassed) {
      expect(css).toMatch(new RegExp(`${el}\\.${cls}\\s*\\{`));
      expect(css).not.toMatch(new RegExp(`\\.${cls}\\s+${el}`));
    }
  });
});
