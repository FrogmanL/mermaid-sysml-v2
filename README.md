# mermaid-sysml-v2

An external [Mermaid](https://mermaid.js.org) diagram plugin that renders a
subset of the [SysML v2](https://www.omg.org/spec/SysMLv2/) textual notation
— `part def`, `port def`, `interface def`, and part containment/connectors —
matching the OMG's own graphical notation as closely as this subset's scope
allows: compartmented definition boxes, rounded usage boxes, a recursive
composition tree for plain containment, and an internal-block-diagram-style
container with connector lines where a part's containment also has
connectors.

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

## Scope (v3)

SysML v2's full grammar is large (block definition diagrams, internal block
diagrams, requirements, state, use case, action, and more). This slice
covers:

- `package Name { ... }`, including arbitrarily nested/sibling packages —
  flattened into one diagram, using the first package name seen as the title.
- `part def Name [:> Super] { attribute ...; port ...; part ...; connect ...; }`
  — a sharp-cornered box stereotyped «part def», per spec.
- A bare top-level (or nested-in-package) `part name [: Type] { ... }`
  **usage** with a body — e.g. `part roomContext { part c : Classroom; ... }`
  — a rounded-cornered box stereotyped «part», header "name : Type" rather
  than just "Name", also per spec. A body-less instantiation reference
  (`part bvm : BVM;`) has nothing of its own to draw and is skipped.
- **Containment** — `part child : Type [multiplicity];` nested inside a part
  (either order — type-then-multiplicity or multiplicity-then-type — and `:`
  or `:>` before the type). Renders one of two ways, matching two distinct
  diagrams in the spec's own graphical notation:
  - **No connectors**: a **composition tree** — a filled diamond under the
    parent, org-chart lines fanning down to each child's own box. Recursive:
    a child usage whose own type has further containment expands into its
    own subtree, however deep the data goes (cycle- and depth-guarded).
  - **With connectors** (`connect a.b to c.d;` and
    `flow [name] [from] a.b to c.d;`, either form, inside the part's body):
    an **internal-block-diagram-style container** — one child box per part
    with port markers, connector lines (orthogonal routing, one lane per
    connector so they stay legible when several share an endpoint) with an
    arrowhead at the target and a label for the conveyed item where one can
    be determined (only the connector path's first two segments resolve the
    endpoint, e.g. `h.exit.air` → child `h`, port `exit`; a trailing segment
    like `air` is used only as the label). One level deep only here — see
    "Known limitations".
- `port def Name { in/out [item|ref] name [:|:>] Type; }`, including a
  conjugated type (`~Type`).
- `interface def Name { end ...; flow a.b to c.d; }` (flows here stay inside
  the interface's own box as text, since an interface def has no part
  *usages* of its own to draw a line between).
- `doc /* ... */` comments (shown as a hover tooltip on the box).
- `import` statements and quoted (`'...'`) identifiers (parsed/tokenized
  correctly, then ignored).

Everything else — actions, requirements, state machines, views, `satisfy`,
n-ary/`::>`-bound connectors, port redefinition, expressions beyond a raw
right-hand side — is outside this subset. The parser skips unrecognized
constructs resiliently (structurally, brace-aware) rather than failing the
whole diagram, so a real file mixing supported and unsupported constructs
still renders what it can.

### Validation corpus

Checked visual notation choices (compartment layout, sharp-vs-rounded
corners, composition-tree vs. internal-block-diagram styles, connector
arrowheads/labels) against the OMG's own
[Intro to the SysML v2 Language — Graphical Notation](https://github.com/Systems-Modeling/SysML-v2-Release/blob/master/doc/Intro%20to%20the%20SysML%20v2%20Language-Graphical%20Notation.pdf)
deck — specifically its structural modules (pages 16–47: "Packages & Element
Names," "Definition Elements," "Usage Elements," "Part Decomposition," "Part
Interconnection," "Variability"); everything from page 48 on is behavior/
requirements/use-case notation, out of scope here.

Checked textual-syntax coverage against real `.sysml` files (read locally
during development, not vendored into this repo except where noted) from:

- **[Systems-Modeling/SysML-v2-Release](https://github.com/Systems-Modeling/SysML-v2-Release)**
  — the OMG reference implementation's own repo. Its
  [`sysml/src/examples`](https://github.com/Systems-Modeling/SysML-v2-Release/tree/master/sysml/src/examples)
  and `sysml/src/training` directories are canonical, spec-authors'-own
  models (used: `Room Model/RoomModel.sysml`, `training/17. Control/Camera.sysml`).
  `sysml.library/Systems Library/*.sysml` in the same repo is the standard
  library itself (`Parts.sysml`, `Ports.sysml`, etc.) rather than example
  models — useful for confirming exact library-defined keywords, less so
  as realistic usage to parse against.
- **[GfSE/SysML-v2-Models](https://github.com/GfSE/SysML-v2-Models)** — a
  community-curated collection (Gesellschaft für Systems Engineering),
  ranging from simple (`example_family/family.sysml`) to genuinely advanced
  (`SE_Models/VehicleModel.sysml`'s n-ary connectors and `::>`-bound ends,
  `SE_Models/Drone_BaseArchitecture.sysml`'s multi-package requirement
  traceability). The advanced end of this repo is where this subset's
  current limits (below) were found.
- `examples/vehicle.mmd` — transcribed from the code block in
  [mermaid-js/mermaid#6317](https://github.com/mermaid-js/mermaid/issues/6317)
  itself, not from either repo above.
- `examples/bvm.mmd` — not a found/published example; an LLM-generated
  model from an earlier session on the user's own MBSE project (its header
  comment says so), used here because it's real containment/connector usage
  the user actually produced, not because it's a citable outside source.

**Known limitations**, in rough order of how often they'd bite:

- **The connector container is one level deep**; only the composition tree
  recurses. A child inside an IBD-style container whose own type has further
  containment+connectors doesn't expand — it shows as a plain box with ports.
  A child's inline body (a usage written directly in place, e.g.
  `part battery { attribute capacity = 6000; }`) is parsed only far enough to
  skip it structurally either way — see `parsePartUsage` in
  `src/parser/parser.ts`.
- **A container or tree shows only its children**, not its own attributes/
  ports if it happens to have both containment and its own direct members —
  real containers in the corpus so far only had one or the other.
- Connector endpoints resolve only the `child.port` shape. Anything with
  `::>` reference bindings, parenthesized n-ary connector tuples
  (`connect (a ::> b, c ::> d);`), or a path outside the current container
  silently draws no line (the connector is still in the parsed model, just
  not visualized).
- **Composition vs. reference isn't distinguished.** The spec uses a filled
  diamond for composition and a hollow diamond for a non-owning reference
  (see the graphical-notation deck's "References," p. 37); this subset has no
  `ref`-part concept and always draws the filled (composition) diamond.
- **Specialization (`:>`) has no arrow.** `part def X :> Y` parses correctly
  and is kept on the node as `superType`, but isn't yet drawn as the spec's
  hollow-triangle inheritance arrow between two definition boxes.

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
style (a real beverage-vending-machine model — its `BVM` part shows the
connector container, its `ControlUnit` part shows the composition tree, since
it has containment but no connectors of its own), and `index.html` for a live
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

1. **Recursive containment for the connector container**, not just the
   composition tree — the tree already recurses (see "Scope" above); a child
   inside an IBD-style container whose own type has further containment and
   connectors currently just shows as a plain box with ports instead of
   expanding.
2. **Resolve more connector shapes** — at least the `::>`-bound-end form
   (`connect a ::> b to c ::> d;`), which showed up in a real family/adoption
   model alongside the plain `child.port` form this already handles.
3. **Specialization arrow** — draw `part def Foo :> Bar`'s hollow-triangle
   inheritance arrow between the two definition boxes; the relationship is
   already parsed and available as `superType`.
4. **Real text measurement** — the renderer currently estimates box width
   from character counts; swapping in `getBBox()`-based measurement (as
   mermaid's own class diagram does) would tighten box sizing.
5. Publishing to npm and registering in Mermaid's
   [community integrations list](https://mermaid.js.org/ecosystem/integrations-community.html),
   and linking this project from the GitHub issue, once it's further along.

## License

MIT
