import mermaid from 'mermaid';
import sysmlV2Diagram from 'mermaid-sysml-v2';
import { sysmlV2DiagramClassName } from '../src/markdownIt.js';

let ready: Promise<void> | undefined;

/** Registers this plugin with mermaid and initializes it — once per webview lifetime, not on every re-render (unlike VS Code's own mermaid extension, this doesn't yet follow VS Code's light/dark theme changes; see the extension README's "Known limitations"). */
function ensureReady(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await mermaid.registerExternalDiagrams([sysmlV2Diagram]);
      mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
    })();
  }
  return ready;
}

let renderCounter = 0;

/**
 * Finds every unrendered `.sysml-v2-diagram` container (see `markdownIt.ts`)
 * in the preview DOM and replaces its raw source text with the rendered SVG.
 * Re-run on load and on `vscode.markdown.updateContent` — the real, current
 * event VS Code's built-in preview dispatches after any content update
 * (confirmed against `mermaid-markdown-features`'s own preview script, which
 * this mirrors); there is no documented public API for this, so if a future
 * VS Code release renames it, diagrams would stop live-updating (existing
 * ones would still have rendered correctly on the initial load).
 */
async function renderAll(): Promise<void> {
  await ensureReady();
  const containers = document.body.querySelectorAll<HTMLElement>(`.${sysmlV2DiagramClassName}:not([data-sysml-v2-rendered])`);
  for (const container of Array.from(containers)) {
    // Mark before the first await so an overlapping renderAll() (load + updateContent) can't pick it up too.
    container.dataset.sysmlV2Rendered = 'true';
    const source = (container.textContent ?? '').trim();
    if (!source) continue;
    const id = `sysml-v2-preview-${renderCounter++}`;
    try {
      const { svg, bindFunctions } = await mermaid.render(id, source);
      container.innerHTML = svg;
      bindFunctions?.(container);
    } catch (error) {
      container.innerHTML = `<pre class="sysml-v2-error">${escapeHtml(getErrorMessage(error))}</pre>`;
    }
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

window.addEventListener('vscode.markdown.updateContent', () => {
  void renderAll();
});
void renderAll();
