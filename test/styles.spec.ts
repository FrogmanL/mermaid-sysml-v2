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
  it('targets the connector path and port rect directly, not as a descendant', () => {
    const css = getStyles({});
    expect(css).toMatch(/path\.connector\s*\{/);
    expect(css).toMatch(/rect\.port\s*\{/);
    expect(css).not.toMatch(/\.connector\s+path/);
    expect(css).not.toMatch(/\.port\s+rect/);
  });
});
