# mermaid-sysml-v2

An external [Mermaid](https://mermaid.js.org) diagram plugin that renders a
subset of the [SysML v2](https://www.omg.org/spec/SysMLv2/) textual notation
— `part def`, `port def`, `interface def`, and part containment/connectors —
as compartmented boxes in the style of a SysML v2 block definition diagram,
or as an internal-block-diagram-style container with connector lines where a
part has nested parts.

## Why this exists

[mermaid-js/mermaid#6317](https://github.com/mermaid-js/mermaid/issues/6317)
asks for native SysML v2 support in Mermaid. As of writing, the issue has
been approved for Mermaid's roadmap but has no implementation or open PR —
maintainers have said new diagram types like this should be built as an
**external diagram plugin** via `mermaid.registerExternalDiagrams`, the same
pattern used for [ZenUML](https://github.com/mermaid-js/mermaid/tree/develop/packages/mermaid-zenuml)
and recommended for a similar Pikchr proposal
([mermaid-js/mermaid#6305](https://github.com/mermaid-js/mermaid/issues/6305)).

This package is that plugin, kept outside the mermaid-js/mermaid repo, so
projects blocked on #6317 have something usable now.

## Scope (v2)

SysML v2's full grammar is large (block definition diagrams, internal block
diagrams, requirements, state, use case, action, and more). This slice
covers:

- `package Name { ... }`, including arbitrarily nested/sibling packages —
  flattened into one diagram, using the first package name seen as the title.
- `part def Name { attribute ...; port ...; part ...; connect ...; }`
- A bare top-level (or nested-in-package) `part name { ... }` **usage** with a
  body — e.g. `part roomContext { part c : Classroom; ... }` — rendered the
  same way as a `part def`. A body-less instantiation reference
  (`part bvm : BVM;`) has nothing of its own to draw and is skipped.
- **Containment**: `part child : Type [multiplicity];` nested inside a part
  (either order — type-then-multiplicity or multiplicity-then-type — and `:`
  or `:>` before the type). A part with nested parts renders as a container
  box holding one child box per part, instead of the plain compartmented box.
- **Connectors**: `connect a.b to c.d;` and `flow [name] [from] a.b to c.d;`
  (both forms, inside a part's body) resolve to a line between two children's
  port markers, drawn as a curve beneath the row. Only the first two segments
  of each path are used (`h.exit.air` resolves to child `h`, port `exit`) —
  SysML v2's per-item granularity isn't modeled, so several item flows over
  the same structural connector correctly collapse into one drawn line.
- `port def Name { in/out [item|ref] name [:|:>] Type; }`, including a
  conjugated type (`~Type`).
- `interface def Name { end ...; flow a.b to c.d; }` (unchanged from v1 —
  flows here stay inside the interface's own box as text, since an interface
  def has no part *usages* of its own to draw a line between).
- `doc /* ... */` comments (shown as a hover tooltip on the box).
- `import` statements and quoted (`'...'`) identifiers (parsed/tokenized
  correctly, then ignored).

Everything else — actions, requirements, state machines, views, `satisfy`,
n-ary/`::>`-bound connectors, port redefinition, expressions beyond a raw
right-hand side — is outside this subset. The parser skips unrecognized
constructs resiliently (structurally, brace-aware) rather than failing the
whole diagram, so a real file mixing supported and unsupported constructs
still renders what it can. This was validated against several real files:
the vehicle example from the GitHub issue, a hand-written beverage-vending-
machine model (`examples/bvm.mmd`), and the official SysML v2 spec's and
GfSE's own public example repos.

**Known limitations**, in rough order of how often they'd bite:

- **Containment is one level deep.** A child's own nested parts aren't drawn
  (its inline body, if any, is parsed only far enough to skip it structurally
  — see `parsePartUsage` in `src/parser/parser.ts`). Seen in the wild (a
  drone model nesting a battery inside a part usage) but not yet supported.
- **A container shows only its children**, not its own attributes/ports if it
  happens to have both containment and its own direct members — real
  containers in the corpus so far only had one or the other.
- Connector endpoints resolve only the `child.port` shape. Anything with
  `::>` reference bindings, parenthesized n-ary connector tuples
  (`connect (a ::> b, c ::> d);`), or a path outside the current container
  silently draws no line (the connector is still in the parsed model, just
  not visualized).

## Usage

```bash
npm install mermaid-sysml-v2
```

```js
import mermaid from 'mermaid';
import sysmlV2Diagram from 'mermaid-sysml-v2';

mermaid.registerExternalDiagrams([sysmlV2Diagram]);
mermaid.initialize({ startOnLoad: true });
```

Then write a diagram starting with the `sysml-v2` keyword:

````markdown
```mermaid
sysml-v2
part def BVM {
  part coinAcceptor : CoinAcceptor;
  part controlUnit : ControlUnit;
  connect coinAcceptor.coinOut to controlUnit.coinIn;
}
part def CoinAcceptor {
  port coinOut : CoinPort;
}
part def ControlUnit {
  port coinIn : CoinPort;
}
port def CoinPort {
  out item coin : Real;
}
```
````

See `examples/vehicle.mmd` for the part/port/interface-def style (the example
from the GitHub issue) and `examples/bvm.mmd` for the containment/connector
style (a real beverage-vending-machine model), and `index.html` for a live
editable demo of both.

## Development

```bash
npm install
npm run dev     # live demo at http://localhost:5173 — pick an example from the dropdown, edits re-render
npm test        # vitest: parser + renderer tests, including the two example files end to end
npm run build   # emits dist/mermaid-sysml-v2.core.mjs + .d.ts files
```

## Extending this

Natural next steps, roughly in order of value:

1. **Recursive containment** — draw a child's own nested parts instead of
   stopping one level deep (see "Known limitations" above).
2. **Resolve more connector shapes** — at least the `::>`-bound-end form
   (`connect a ::> b to c ::> d;`), which showed up in a real family/adoption
   model alongside the plain `child.port` form this already handles.
3. **Generalization/specialization** (`part def Foo :> Bar`) drawn as an
   inheritance arrow.
4. **Real text measurement** — the renderer currently estimates box width
   from character counts; swapping in `getBBox()`-based measurement (as
   mermaid's own class diagram does) would tighten box sizing.
5. Publishing to npm and registering in Mermaid's
   [community integrations list](https://mermaid.js.org/ecosystem/integrations-community.html),
   and linking this project from the GitHub issue, once it's further along.

## License

MIT
