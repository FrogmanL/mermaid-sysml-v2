# mermaid-sysml-v2

An external [Mermaid](https://mermaid.js.org) diagram plugin that renders a
subset of the [SysML v2](https://www.omg.org/spec/SysMLv2/) textual notation
— `part def`, `port def`, `interface def`, `connection def`, every
connector-establishing form this subset resolves, and specialization
(`:>`)/subsetting (`:>`)/redefinition (`:>>`) — matching the OMG's own
graphical notation as closely as this subset's scope allows: compartmented
definition boxes, rounded usage boxes, a recursive composition tree for plain
containment, an internal-block-diagram-style container with connector lines
(binary, `::>`-bound, or n-ary) where a part's containment also has
connectors, and a hollow-triangle generalization arrow between two definition
boxes that specialize one another.

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
  - **With connectors**: an **internal-block-diagram-style container** — one
    child box per part with port markers, connector lines (orthogonal
    routing, one lane per connector so they stay legible when several share
    an endpoint), an arrowhead at the target, and a label for the conveyed
    item where one can be determined. One level deep only here — see "Known
    limitations".
- **Connectors** — every connector-establishing form this subset resolves,
  each contributing to the container view above:
  - `connect a.b to c.d;` and `flow [name] [from] a.b to c.d;`, inside a
    part's body. Only the endpoint's first two segments resolve it (e.g.
    `h.exit.air` → child `h`, port `exit`); a trailing segment, if any, is
    used only as the drawn line's label.
  - A `::>`-bound end on either form (`connect A ::> x.y to B ::> z.w;`) —
    the local end name (`A`/`B`) is discarded; only the bound-to path draws.
  - An n-ary `connect (a ::> x, b ::> y, c ::> z);` — drawn as a small
    junction dot with one branch per end, no arrowhead (undirected).
  - A `connection [name] [: Type] { end m ::> x; end f ::> y; }` **usage**
    (inside a part's body, or nested inside another `connection`) — its own
    redefined ends collectively form a connector, folded into the enclosing
    part's connectors once 2 or more are found. A bare (portless) endpoint —
    `end m ::> someChild;`, no `.port` segment — anchors to that child's own
    box directly, which is what makes a plain part-to-part connection (no
    ports at all) drawable.
  - A bare top-level `connection` usage (not nested in any part) is parsed
    but has no box to draw against in this subset, so it's discarded.
- **Specialization, subsetting, and redefinition** — the same `:>`/`:>>`
  syntax means something different depending on what it's attached to, and
  this subset keeps the two apart rather than collapsing everything to a
  plain `:`:
  - On a **definition** (`part def X :> Y`, `port def X :> Y`,
    `interface def X :> Y`, `connection def X :> Y`) it's specialization —
    kept as `superType`, and drawn as a hollow-triangle generalization arrow
    from X to Y (tip at the supertype), matching the spec's own notation. The
    arrow only appears when Y is itself a box in the same diagram; a
    supertype naming something outside it (a standard-library type like
    `ISQ::PhysicalObject`) is parsed and kept on the node, but has nothing to
    point at, so no arrow is drawn for it.
  - On a **usage or attribute** (a part/port/attribute/connection-end
    reference), `:>`/the `subsets` keyword narrows an inherited feature and
    `:>>`/the `redefines` keyword overrides one — these display with the
    actual operator that introduced them (`name :> base`, `name :>> base`)
    rather than always showing a plain colon, but (unlike definition-level
    specialization) don't get their own arrow — see "Known limitations".
- `port def Name { in/out [item|ref] name [:|:>] Type; }`, including a
  conjugated type (`~Type`).
- `interface def Name { end ...; flow a.b to c.d; }` (flows here stay inside
  the interface's own box as text, since an interface def has no part
  *usages* of its own to draw a line between).
- `connection def Name { end [part] a [:Type]; ...; attribute ...; }` — like
  `interface def` but for a plain part-to-part link with no port-compatibility
  requirement; renders the same way (a leaf box with "attributes"/"ends"
  compartments).
- `doc /* ... */` comments (shown as a hover tooltip on the box).
- `import` statements and quoted (`'...'`) identifiers (parsed/tokenized
  correctly, then ignored).

Everything else — actions, requirements, state machines, views, `satisfy`,
variability modeling (`variation`/`variant`), sequence-style `message ... to`
interactions, port redefinition, expressions beyond a raw right-hand side —
is outside this subset. The parser skips unrecognized constructs resiliently
(structurally, brace-aware) rather than failing the whole diagram, so a real
file mixing supported and unsupported constructs still renders what it can.

## Requirements & traceability (a separate diagram, not covered here)

SysML v2's requirements/traceability constructs — `requirement def`, a
`requirement` usage bound to a `subject`, and the cross-cutting relationship
keywords `satisfy ... by ...`, `verify`, `trace`, `allocate`, and `copy` —
belong to a different diagram type from the ones above: the **Requirement
Diagram**, with its own graphical notation (a compartmented requirement box
showing id/text/subject, and dashed dependency arrows labeled
«satisfy»/«verify»/«trace»/etc.), not the definition/usage/interconnection
notation this subset renders. The OMG's own graphical-notation deck (see
"Validation corpus" below) covers it starting at page 48 — already noted as
out of scope in "Everything else" above.

This subset already parses past these constructs structurally rather than
failing, so a real model mixing them with supported constructs still renders
what it can. `examples/bvm.mmd`'s own `requirement def`/`requirement`/
`satisfy` section (REQ-001 through REQ-013, modeling the BVM's requirements
and which parts satisfy them) is a real instance of exactly that — it parses
cleanly, just contributes nothing to the diagram today. One thing worth
noting from that file: **`deriveReqt` isn't a standalone keyword in the
textual grammar.** SysML v2 models requirement derivation as ordinary usage
subsetting instead —
`requirement req004 : ProductDispensingReq :> req012;` — the same `:>`
construct already covered under "Specialization, subsetting, and
redefinition" above, not a distinct traceability relationship. So a future
requirement-derivation arrow would reuse the same usage-level subsetting
relationship this subset already parses today (see "Known limitations" — a
usage's `:>`/`:>>` is currently shown as text only, with no arrow of its
own yet).

Adding requirement-diagram support would mean new parsing and rendering work
of its own — a `requirement def`/`requirement` usage box (id + text +
subject compartments, per the spec), and a dashed dependency-arrow renderer
for `satisfy`/`verify`/`trace`/`allocate`/`copy`, each labeled with its own
guillemet stereotype — rather than an extension of the definition/usage/
connector/specialization rendering already built here.

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
  ranging from simple (`example_family/family.sysml`) to genuinely advanced.
  `family.sysml` alone is what drove this subset's connector coverage — its
  `::>`-bound ends, n-ary `connect (...)`, and `connection` usages/defs are
  all now handled; its bodyless usage-with-inline-connect and variability
  modeling (`variation`/`variant`) are where this subset's current limits
  (below) were found. `SE_Models/Drone_BaseArchitecture.sysml` exercises
  multi-package requirement traceability.
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
- A connector endpoint resolves only against a sibling child within the
  *same* container (a `child.port`, `::>`-bound, or bare-part path) — a path
  pointing outside the current container silently draws no line (the
  connector is still in the parsed model, just not visualized).
- **A bodyless usage-with-inline-statement isn't parsed** — e.g.
  `interface name : Type connect A ::> x to B ::> y;` (no braces at all, a
  single statement). Seen once, in the same advanced family/adoption model
  that has the `::>`/n-ary forms above; it's skipped structurally like any
  other unrecognized construct rather than crashing, but its connector isn't
  extracted.
- **Composition vs. reference isn't distinguished.** The spec uses a filled
  diamond for composition and a hollow diamond for a non-owning reference
  (see the graphical-notation deck's "References," p. 37); this subset has no
  `ref`-part concept and always draws the filled (composition) diamond.
- **The specialization arrow uses a straight line clipped to each box's
  border**, not real edge routing — in a dense grid layout it can visually
  cross an unrelated box sitting between the two ends (see
  `examples/features/08-specialization-and-subsetting.mmd`'s AxleMountIF →
  BaseMountIF arrow). The relationship is still correct; only the line's path
  can look busy.
- **Subsetting/redefinition on a usage (`:>`/`:>>`, or `subsets`/`redefines`)
  has no arrow of its own** — only definition-level specialization does (see
  "Scope" above). A usage's relation shows correctly as text (`name :> base`,
  `name :>> base`), but the spec's own dashed subsetting/redefinition arrow
  between two usages isn't drawn.
- **At most one type-introducing relation is kept per usage.** A usage
  combining a defining type with a subsets/redefines target on the same
  declaration (`part x : Type :> base;`) hasn't turned up in this subset's
  validation corpus; if it occurs, only the last relation parsed is kept.

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
it has containment but no connectors of its own). `examples/features/`
has one small file per feature cluster (definition/usage styling, the
composition tree, the connector container, nested packages, resilience
against unsupported constructs, every connector form, and specialization
arrows/subsets/redefines) for a quick visual tour of the whole plugin;
`index.html`'s dropdown has a "Feature showcase" group listing them all.

## Development

```bash
npm install
npm run dev     # live demo at http://localhost:5173 — pick an example from the dropdown, edits re-render
npm test        # vitest: parser + renderer tests, including every example and feature file end to end
npm run build   # emits dist/mermaid-sysml-v2.core.mjs + .d.ts files
```

## Extending this

Natural next steps, roughly in order of value:

1. **Recursive containment for the connector container**, not just the
   composition tree — the tree already recurses (see "Scope" above); a child
   inside an IBD-style container whose own type has further containment and
   connectors currently just shows as a plain box with ports instead of
   expanding.
2. **Real edge routing for the specialization arrow**, instead of a straight
   line clipped to each box's border — would fix the visual crossing noted
   in "Known limitations" for a dense grid layout.
3. **A subsetting/redefinition arrow between two usages**, distinct from the
   definition-level specialization arrow already drawn — the spec shows this
   as a separate dashed relationship line.
4. **Hollow diamond for a reference (non-owning) containment**, contrasted
   with the filled diamond already drawn for composition.
5. **Real text measurement** — the renderer currently estimates box width
   from character counts; swapping in `getBBox()`-based measurement (as
   mermaid's own class diagram does) would tighten box sizing.
6. Publishing to npm and registering in Mermaid's
   [community integrations list](https://mermaid.js.org/ecosystem/integrations-community.html),
   and linking this project from the GitHub issue, once it's further along.

## License

MIT
