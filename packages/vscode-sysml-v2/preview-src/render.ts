import mermaid from 'mermaid';
import sysmlV2Diagram from 'mermaid-sysml-v2';

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

/** Renders SysML v2 `source` into `container` as an SVG, or as an error message if it fails to parse. A leading `sysml-v2` header line is optional (the parser strips it if present; mermaid's detector needs it, so it's added when missing). */
export async function renderSysmlInto(container: HTMLElement, source: string): Promise<void> {
  await ensureReady();
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
