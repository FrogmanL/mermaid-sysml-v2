import { renderSysmlInto, type ItemLayout } from './render.js';

/** Entry point for the standalone `.sysml` preview panel (see `src/sysmlPreview.ts`): the extension host posts `{ type: 'update', text, itemLayout }` whenever the document (or the `sysml-v2.itemLayout` setting) changes, and this re-renders the whole model into `#root`. */
const root = document.getElementById('root')!;
let pending: { text: string; itemLayout: ItemLayout } | undefined;
let rendering = false;

async function drain(): Promise<void> {
  if (rendering) return;
  rendering = true;
  try {
    while (pending !== undefined) {
      const { text, itemLayout } = pending;
      pending = undefined;
      await renderSysmlInto(root, text, { itemLayout });
    }
  } finally {
    rendering = false;
  }
}

window.addEventListener(
  'message',
  (event: MessageEvent<{ type?: string; text?: string; itemLayout?: ItemLayout }>) => {
    if (event.data?.type !== 'update' || typeof event.data.text !== 'string') return;
    pending = { text: event.data.text, itemLayout: event.data.itemLayout === 'containment' ? 'containment' : 'tree' };
    void drain();
  }
);

acquireVsCodeApi().postMessage({ type: 'ready' });

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
