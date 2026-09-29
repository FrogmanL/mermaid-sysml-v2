import { renderSysmlInto } from './render.js';

/** Entry point for the standalone `.sysml` preview panel (see `src/sysmlPreview.ts`): the extension host posts `{ type: 'update', text }` whenever the document changes, and this re-renders the whole model into `#root`. */
const root = document.getElementById('root')!;
let pending: string | undefined;
let rendering = false;

async function drain(): Promise<void> {
  if (rendering) return;
  rendering = true;
  try {
    while (pending !== undefined) {
      const text = pending;
      pending = undefined;
      await renderSysmlInto(root, text);
    }
  } finally {
    rendering = false;
  }
}

window.addEventListener('message', (event: MessageEvent<{ type?: string; text?: string }>) => {
  if (event.data?.type !== 'update' || typeof event.data.text !== 'string') return;
  pending = event.data.text;
  void drain();
});

acquireVsCodeApi().postMessage({ type: 'ready' });

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
