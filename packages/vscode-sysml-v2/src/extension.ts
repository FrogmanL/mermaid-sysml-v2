import type MarkdownIt from 'markdown-it';
import type * as vscode from 'vscode';
import { extendMarkdownItWithSysmlV2 } from './markdownIt.js';

/**
 * `activate` runs in the extension host (Node.js), not the preview webview.
 * Its only job is to hand VS Code's markdown engine an `extendMarkdownIt`
 * hook (enabled via `contributes.markdown.markdownItPlugins: true`) so a
 * ```sysml-v2 fence's raw source reaches the preview DOM untouched — the
 * actual diagram rendering happens client-side, via `contributes.markdown.
 * previewScripts` (see `preview-src/index.ts`), the same two-part split VS
 * Code's own built-in `mermaid-markdown-features` extension uses.
 */
export function activate(_context: vscode.ExtensionContext): {
  extendMarkdownIt(md: MarkdownIt): MarkdownIt;
} {
  return {
    extendMarkdownIt(md: MarkdownIt) {
      return extendMarkdownItWithSysmlV2(md);
    },
  };
}

export function deactivate(): void {}
