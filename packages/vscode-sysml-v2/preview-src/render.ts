import mermaid from 'mermaid';
import sysmlV2Diagram from 'mermaid-sysml-v2';

let ready: Promise<void> | undefined;

/** The nested-item rendering layouts the plugin understands (mirrors `ItemLayout` in mermaid-sysml-v2). */
export type ItemLayout = 'tree' | 'containment';

/** Registers this plugin with mermaid — once per webview lifetime. Initialization (which carries per-render config like `itemLayout`) happens in `renderSysmlInto`, since the config can change between renders. (This doesn't yet follow VS Code's light/dark theme changes; see the extension README's "Known limitations".) */
function ensureReady(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await mermaid.registerExternalDiagrams([sysmlV2Diagram]);
    })();
  }
  return ready;
}

let renderCounter = 0;

/** Renders SysML v2 `source` into `container` as an SVG, or as an error message if it fails to parse. A leading `sysml-v2` header line is optional (the parser strips it if present; mermaid's detector needs it, so it's added when missing). `options.itemLayout` selects how nested payload items are drawn (default `'tree'`). */
export async function renderSysmlInto(
  container: HTMLElement,
  source: string,
  options: { itemLayout?: ItemLayout } = {}
): Promise<void> {
  await ensureReady();
  // Re-initialize each render so a changed `itemLayout` reaches the plugin
  // via mermaid's config; mermaid.initialize merges config on each call.
  // `sysml` is this plugin's own config namespace, not part of mermaid's
  // typed `MermaidConfig`, so cast past the excess-property check.
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    sysml: { itemLayout: options.itemLayout ?? 'tree' },
  } as Parameters<typeof mermaid.initialize>[0]);
  const trimmed = source.trim();
  const text = /^sysml-v2\s*(\n|$)/i.test(trimmed) ? trimmed : `sysml-v2\n${trimmed}`;
  const id = `sysml-v2-preview-${renderCounter++}`;
  try {
    const { svg, bindFunctions } = await mermaid.render(id, text);
    container.innerHTML = svg;
    bindFunctions?.(container);
  } catch (error) {
    container.innerHTML = `<pre class="sysml-v2-error">${escapeHtml(getErrorMessage(error))}</pre>`;
  }
}

/** Mermaid rejects parse/render failures with a plain `{ str, message, ... }` object, not a real `Error` — a naive `String(error)` would show the unhelpful `[object Object]` instead of the actual syntax error (same issue VS Code's own mermaid extension works around). */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; str?: unknown };
    if (typeof candidate.message === 'string' && candidate.message) return candidate.message;
    if (typeof candidate.str === 'string' && candidate.str) return candidate.str;
  }
  return String(error);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
