import * as vscode from 'vscode';

/** One live preview panel per `.sysml` document, keyed by URI. */
const panels = new Map<string, vscode.WebviewPanel>();

/** Builds the panel's HTML. Exported for unit testing — it has no dependency on the `vscode` runtime beyond the plain strings passed in. */
export function getPreviewHtml(options: { cspSource: string; scriptUri: string; nonce: string; title: string }): string {
  const { cspSource, scriptUri, nonce, title } = options;
  // `style-src 'unsafe-inline'` is required: mermaid emits inline <style> and style="" attributes in its SVG.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  body { padding: 0; margin: 0; }
  /* Mermaid's default theme is light-on-light, so draw it on a white canvas regardless of VS Code's theme (theme-following is a known limitation). */
  #root { background: #fff; color: #000; padding: 16px; min-height: 100vh; box-sizing: border-box; overflow: auto; }
  .sysml-v2-error { color: #b00020; white-space: pre-wrap; font-family: var(--vscode-editor-font-family, monospace); }
</style>
</head>
<body>
<div id="root"></div>
<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/** Opens (or reveals) a live preview of a `.sysml` document beside the editor. */
export function openSysmlPreview(context: vscode.ExtensionContext, document: vscode.TextDocument): void {
  const key = document.uri.toString();
  const existing = panels.get(key);
  if (existing) {
    existing.reveal(vscode.ViewColumn.Beside, true);
    return;
  }

  const distUri = vscode.Uri.joinPath(context.extensionUri, 'dist');
  const fileName = document.uri.path.split('/').pop() ?? 'model.sysml';
  const panel = vscode.window.createWebviewPanel('sysmlV2Preview', `Preview ${fileName}`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
    enableScripts: true,
    localResourceRoots: [distUri],
  });
  panels.set(key, panel);

  panel.webview.html = getPreviewHtml({
    cspSource: panel.webview.cspSource,
    scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'webview', 'index.js')).toString(),
    nonce: getNonce(),
    title: fileName,
  });

  const send = () => void panel.webview.postMessage({ type: 'update', text: document.getText() });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const subscriptions: vscode.Disposable[] = [
    // The webview posts 'ready' once its script has loaded — only then is it listening for updates.
    panel.webview.onDidReceiveMessage((message: { type?: string }) => {
      if (message?.type === 'ready') send();
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== key) return;
      clearTimeout(timer);
      timer = setTimeout(send, 250);
    }),
  ];

  panel.onDidDispose(() => {
    clearTimeout(timer);
    panels.delete(key);
    subscriptions.forEach((d) => d.dispose());
  });
}
