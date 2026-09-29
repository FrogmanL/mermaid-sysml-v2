# mermaid-sysml-v2 (workspace)

An npm workspace with two packages:

- **[`packages/mermaid-sysml-v2`](packages/mermaid-sysml-v2/README.md)** — an
  external [Mermaid](https://mermaid.js.org) diagram plugin rendering a
  subset of the [SysML v2](https://www.omg.org/spec/SysMLv2/) textual
  notation. See its own README for scope, validation corpus, known
  limitations, and how to run its live demo.
- **[`packages/vscode-sysml-v2`](packages/vscode-sysml-v2/README.md)** — a VS
  Code extension that renders ```sysml-v2 fenced code blocks as diagrams
  inside VS Code's built-in Markdown preview, using the plugin above. See its
  own README for how it works and how to try it (F5 from within that folder).

## Why two packages, one repo

Both packages (and, eventually, a linter/language server sharing the same
parser — see `packages/vscode-sysml-v2/README.md`'s "Toward a future linter")
depend on the same SysML v2 parsing/rendering core. Keeping them in one npm
workspace means the VS Code extension can depend on the plugin package
directly (a workspace symlink, not a published npm version) while both still
get type-checked, tested, and built from one `npm install` at this root.

## Development

```bash
npm install                          # installs the whole workspace
npm run build --workspaces --if-present
npm test --workspaces --if-present
npm run typecheck --workspaces --if-present
```

To work on just one package, use `npm <script> -w <package-name>` (e.g.
`npm run dev -w mermaid-sysml-v2`) or `cd` into it directly.

## License

MIT — see [LICENSE](LICENSE).
