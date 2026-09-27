import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/detector.ts',
      name: 'mermaidSysmlV2',
      fileName: () => 'mermaid-sysml-v2.core.mjs',
      formats: ['es'],
    },
    rollupOptions: {
      external: ['mermaid'],
      output: {
        // Published as a single file (matching @mermaid-js/mermaid-example-diagram
        // and @mermaid-js/mermaid-zenuml), so inline the dynamically-imported
        // diagram-definition chunk instead of code-splitting it out.
        inlineDynamicImports: true,
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
});
