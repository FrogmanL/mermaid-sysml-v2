import type MarkdownIt from 'markdown-it';

/** The fenced-code-block language id this extension claims — deliberately its own, distinct from `mermaid`, so it never competes with VS Code's built-in `mermaid-markdown-features` extension for the same fence (that extension's own bundled mermaid instance has no way to learn about this plugin's `sysml-v2` diagram type; see the extension README). */
export const sysmlV2LanguageId = 'sysml-v2';

/** The class markdown-it emits for a matched fence — what `preview-src/index.ts` looks for client-side. */
export const sysmlV2DiagramClassName = 'sysml-v2-diagram';

/**
 * Extends markdown-it so a fenced ```sysml-v2 block's raw source survives
 * into the preview's DOM untouched (wrapped in a plain `<pre class="…">`),
 * instead of being run through normal syntax highlighting. All actual
 * diagram rendering happens later, client-side, in the preview webview (see
 * `preview-src/index.ts`) — same division of responsibility as VS Code's own
 * built-in `mermaid-markdown-features` extension uses for `mermaid` fences.
 *
 * Grounded directly against that extension's real source (as of VS Code
 * 1.121, which folded it into core —
 * `extensions/mermaid-markdown-features/src/markdownMermaid/markdownIt.ts`):
 * it hooks `md.options.highlight` rather than registering a fresh renderer
 * rule, so this coexists with every other markdown-it plugin's own highlight
 * hook (each one calls through to whatever `highlight` it received, falling
 * through when its own language doesn't match) instead of clobbering the
 * chain.
 */
export function extendMarkdownItWithSysmlV2(md: MarkdownIt): MarkdownIt {
  const highlight = md.options.highlight;
  md.options.highlight = (code: string, lang: string, attrs: string): string => {
    if (lang?.trim().toLowerCase() === sysmlV2LanguageId) {
      return `<pre class="${sysmlV2DiagramClassName}" style="all: unset;">${escapeHtml(code)}</pre>`;
    }
    return highlight?.(code, lang, attrs) ?? escapeHtml(code);
  };
  return md;
}

function escapeHtml(source: string): string {
  return source
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n+$/, '');
}
