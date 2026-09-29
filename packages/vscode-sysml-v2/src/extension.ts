import type MarkdownIt from 'markdown-it';
import * as vscode from 'vscode';
import { extendMarkdownItWithSysmlV2 } from './markdownIt.js';
import { openSysmlPreview } from './sysmlPreview.js';

/**
 * `activate` runs in the extension host (Node.js), not the preview webview.
 * Its only job is to hand VS Code's markdown engine an `extendMarkdownIt`
 * hook (enabled via `contributes.markdown.markdownItPlugins: true`) so a
 * ```sysml-v2 fence's raw source reaches the preview DOM untouched — the
 * actual diagram rendering happens client-side, via `contributes.markdown.
 * previewScripts` (see `preview-src/index.ts`), the same two-part split VS
 * Code's own built-in `mermaid-markdown-features` extension uses.
 */
export function activate(context: vscode.ExtensionContext): {
  extendMarkdownIt(md: MarkdownIt): MarkdownIt;
} {
  // Separately from the markdown preview, `.sysml` files get their own live preview panel (see `sysmlPreview.ts`).
  context.subscriptions.push(
    vscode.commands.registerCommand('sysml-v2.openPreview', (uri?: vscode.Uri) => {
      const document = uri
        ? vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString())
        : vscode.window.activeTextEditor?.document;
      if (document) {
        openSysmlPreview(context, document);
      } else if (uri) {
        void vscode.workspace.openTextDocument(uri).then((d) => openSysmlPreview(context, d));
      } else {
        void vscode.window.showInformationMessage('Open a .sysml file first.');
      }
    }),
  );
  return {
    extendMarkdownIt(md: MarkdownIt) {
      return extendMarkdownItWithSysmlV2(md);
    },
  };
}

export function deactivate(): void {}
