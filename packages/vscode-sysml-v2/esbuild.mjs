import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');
// Unminified in watch mode (fast rebuilds, readable stack traces); mermaid
// alone pushes the preview bundle well into multi-MB territory unminified,
// so a real (non-watch) build should minify rather than ship that as-is.
const minify = !watch;

/** The extension host bundle — runs in Node.js inside VS Code itself. */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: true,
  minify,
};

/** The preview bundle — runs in the Markdown preview webview (a browser context), so this is where `mermaid` and `mermaid-sysml-v2` actually get bundled in. */
const previewConfig = {
  entryPoints: ['preview-src/index.ts'],
  outfile: 'dist/preview/index.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2020',
  sourcemap: true,
  minify,
};

async function run() {
  if (watch) {
    const contexts = await Promise.all([context(extensionConfig), context(previewConfig)]);
    await Promise.all(contexts.map((c) => c.watch()));
    console.log('esbuild watching (extension + preview)...');
  } else {
    await Promise.all([build(extensionConfig), build(previewConfig)]);
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
