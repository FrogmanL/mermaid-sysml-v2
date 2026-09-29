import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { extendMarkdownItWithSysmlV2, sysmlV2DiagramClassName } from '../src/markdownIt.js';

describe('extendMarkdownItWithSysmlV2', () => {
  it('wraps a ```sysml-v2 fence in a plain <pre class="sysml-v2-diagram">, untouched by syntax highlighting', () => {
    const md = extendMarkdownItWithSysmlV2(new MarkdownIt());
    const html = md.render('```sysml-v2\nsysml-v2\npart def Vehicle;\n```\n');
    expect(html).toContain(`<pre class="${sysmlV2DiagramClassName}"`);
    expect(html).toContain('part def Vehicle;');
    expect(html).not.toContain('<code');
  });

  it('leaves an ordinary fenced code block (a different language) alone', () => {
    const md = extendMarkdownItWithSysmlV2(new MarkdownIt());
    const html = md.render('```js\nconst x = 1;\n```\n');
    expect(html).not.toContain(sysmlV2DiagramClassName);
    expect(html).toContain('<pre><code');
  });

  // Regression: an earlier draft registered a fresh `md.renderer.rules` entry
  // instead of wrapping `md.options.highlight`, which would silently discard
  // whatever highlighter another markdown-it plugin (or VS Code's own
  // built-in one, for a different language) had already installed.
  it("chains through a highlighter installed before it, instead of replacing it", () => {
    const priorHighlight = (code: string, lang: string) => `<pre class="prior-highlighter" data-lang="${lang}">${code}</pre>`;
    const md = new MarkdownIt({ highlight: priorHighlight });
    extendMarkdownItWithSysmlV2(md);
    const html = md.render('```js\nconst x = 1;\n```\n');
    expect(html).toContain('prior-highlighter');
  });

  it('escapes HTML-significant characters in the diagram source (a guard label can contain `<`/`>`)', () => {
    const md = extendMarkdownItWithSysmlV2(new MarkdownIt());
    const html = md.render('```sysml-v2\nsysml-v2\n// guard: x < 5 && y > 0\n```\n');
    expect(html).toContain('x &lt; 5 &amp;&amp; y &gt; 0');
  });
});
