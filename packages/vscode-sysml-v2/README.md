# vscode-sysml-v2

A VS Code extension that renders ```sysml-v2 fenced code blocks as diagrams
inside VS Code's **built-in** Markdown preview, using the
[`mermaid-sysml-v2`](../mermaid-sysml-v2) plugin from this same workspace.

This exists because `mermaid-sysml-v2` being an *external* Mermaid plugin
means nothing else that embeds Mermaid — including VS Code's own built-in
Markdown preview, which bundles its own private Mermaid instance and has no
public API for a third-party extension to add to it — picks it up
automatically. This extension is the workaround: its own small, separate
Mermaid instance, contributed into VS Code's preview via the two real
extension points that exist for exactly this.

## Try it

This package isn't published; running it means launching an Extension
Development Host from source.

1. In VS Code, **open this folder** (`packages/vscode-sysml-v2`) directly as
   the workspace root — not the monorepo root. (VS Code's extension tooling
   expects `package.json` at the workspace root it's launched from.)
2. Press **F5** (`Run Extension`). This builds the extension first (see
   `.vscode/tasks.json`) and opens a second VS Code window with the
   extension loaded.
3. In that new window, open `examples/demo.md` and open its preview
   (`Ctrl+Shift+V` / `Cmd+Shift+V`). The two ```sysml-v2 fenced blocks should
   render as diagrams instead of plain text.

I can't launch a VS Code GUI from here to verify this myself — the build
(`npm run build`, below) and the markdown-it unit tests are checked, but the
actual "does it render in a real preview" step needs a human to press F5.

```bash
npm install        # from the monorepo root — installs the whole workspace,
                    # and its root "prepare" script builds mermaid-sysml-v2
                    # automatically (see "Build order" below)
npm run build -w vscode-sysml-v2
npm test -w vscode-sysml-v2
npm run typecheck -w vscode-sysml-v2
```

## How it works

Grounded directly against VS Code's own built-in Mermaid support (as of VS
Code 1.121, which folded the formerly-separate `bierner.markdown-mermaid`
extension into core as `mermaid-markdown-features` —
`microsoft/vscode/extensions/mermaid-markdown-features`), since that's the
real, current reference implementation of "render a custom diagram type
inside VS Code's built-in Markdown preview." The same two extension points,
used the same way:

- **`contributes.markdown.markdownItPlugins: true`** + an `extendMarkdownIt`
  hook returned from `activate()` (`src/extension.ts`, `src/markdownIt.ts`).
  This runs in the extension host (Node.js) and does *not* render anything —
  it only makes sure a ```sysml-v2 fence's raw source text reaches the
  preview's HTML untouched (`<pre class="sysml-v2-diagram">...</pre>`)
  instead of being run through normal syntax highlighting. It hooks
  `md.options.highlight` rather than replacing a renderer rule outright, so
  it coexists with every other markdown-it plugin's own highlight hook
  (including VS Code's own, for plain ```mermaid fences) instead of
  clobbering the chain.
- **`contributes.markdown.previewScripts`** (`preview-src/index.ts`). This
  runs client-side, inside the preview's webview — a real browser context —
  and is where `mermaid` and `mermaid-sysml-v2` actually get bundled in and
  used: find every `.sysml-v2-diagram` container, call `mermaid.render()`,
  swap in the resulting SVG. Re-run on load and on the real
  `vscode.markdown.updateContent` window event VS Code's own preview
  dispatches after any content change (also confirmed against that same
  built-in extension's own preview script, not guessed).

Deliberately **not** used: riding on a plain ```mermaid fence and having
mermaid's own internal `sysml-v2` detector (the same one
`mermaid-sysml-v2/src/detector.ts` registers in the browser demo) pick it up.
VS Code's built-in extension owns the `mermaid` fence with its *own* bundled
Mermaid instance, which has no way to learn about this plugin — a
```mermaid fence containing sysml-v2 source would hit that instance instead
and fail to parse. Using a distinct fence language (`sysml-v2`) sidesteps
this entirely instead of fighting over one fence language.

## Known limitations

- **No theme-following.** VS Code's own Mermaid extension re-resolves a
  light/dark Mermaid theme from live CSS variables on every re-render; this
  extension initializes Mermaid once with the default theme and doesn't
  track VS Code's color theme at all yet.
- **No syntax highlighting in the *editor*** for a ```sysml-v2 fence (no
  TextMate grammar contributed) — only the *preview* renders it specially.
- **No pan/zoom, no "open in editor," no copy-source context menu** — the
  polish VS Code's own Mermaid extension has. This round is just "does the
  diagram show up at all."
- **Build order**: `vscode-sysml-v2` bundles `mermaid-sysml-v2`'s *built*
  `dist/` output (a workspace dependency, not source), so `mermaid-sysml-v2`
  must be built first. This is enforced, not just incidental: the monorepo
  root's `package.json` has a `prepare` script (`npm run build -w
  mermaid-sysml-v2`) that npm runs automatically after every `npm install`/
  `npm ci` at the root — found the hard way, when CI's own "Type-check" step
  failed on a clean checkout with "Cannot find module 'mermaid-sysml-v2'"
  because typecheck ran before anything had been built yet.
- **Only the client-side render step is unit-tested** (`test/markdownIt.spec.ts`
  covers the markdown-it hook). The preview script's actual DOM-swapping
  behavior, and the extension end to end, can only really be verified by
  running it in a real VS Code Extension Development Host — see "Try it."

## Toward a future linter / language server

The user's own framing for this workspace: expect to eventually add linting
and IDE-style tooling on top of the same SysML v2 support, not just this
preview. Nothing here builds that yet, but the shape is meant to make it
straightforward when it's time:

- `mermaid-sysml-v2`'s parser (`packages/mermaid-sysml-v2/src/parser/`) is
  already a clean, renderer-independent module — a future
  `packages/sysml-v2-language-server` could depend on it directly, the same
  way this extension depends on the diagram plugin.
- It's closer to "diagnostics-ready" than it looks: every `Token` already
  carries a character offset (`pos` in `lexer.ts`), but `SysmlParseError`
  (`parser.ts`) doesn't surface it yet — today it's message-only. Threading
  `pos` through into a line/column and attaching it to thrown errors is the
  actual gap, not a lexer rewrite.
- This extension's own `activate()` is already a natural place to also
  register a `vscode.languages.registerDocumentDiagnosticsProvider` (or a
  full Language Server Protocol client, if it grows past what fits in-process)
  once that parser-side work lands — no restructuring of this package would
  be needed, just an addition to it.
