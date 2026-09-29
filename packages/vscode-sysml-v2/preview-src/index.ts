import { sysmlV2DiagramClassName } from '../src/markdownIt.js';
import { renderSysmlInto } from './render.js';

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
  const containers = document.body.querySelectorAll<HTMLElement>(`.${sysmlV2DiagramClassName}:not([data-sysml-v2-rendered])`);
  for (const container of Array.from(containers)) {
    // Mark before the first await so an overlapping renderAll() (load + updateContent) can't pick it up too.
    container.dataset.sysmlV2Rendered = 'true';
    const source = (container.textContent ?? '').trim();
    if (!source) continue;
    await renderSysmlInto(container, source);
  }
}

window.addEventListener('vscode.markdown.updateContent', () => {
  void renderAll();
});
void renderAll();
