# mermaid-sysml-v2

An external [Mermaid](https://mermaid.js.org) diagram plugin that renders a
subset of the [SysML v2](https://www.omg.org/spec/SysMLv2/) textual notation
— `part def`, `port def`, `interface def`, `connection def`, `requirement def`,
`attribute def`, `enum def`, `use case def`, `action def`, every connector-
establishing form this subset resolves, specialization (`:>`)/subsetting
(`:>`)/redefinition (`:>>`), requirement/use-case traceability (`satisfy`/
`verify`/`trace`/`allocate`/`include`, plus requirement derivation), and
activity/action diagrams — succession (plain and guarded), start/done, data
flow, and the `decide`/`merge`/`fork`/`join` control-node vocabulary —
matching the OMG's own graphical notation as closely as this subset's scope
allows: compartmented definition boxes, rounded usage boxes, a recursive
composition tree for plain containment, an internal-block-diagram-style
container with connector lines (binary, `::>`-bound, or n-ary) where a part's
containment also has connectors, a hollow-triangle generalization arrow
between two definition boxes that specialize one another, dashed dependency
arrows for requirement/use-case traceability, stick-figure actors with a
plain association line for use cases, and a genuine flowchart — start/done
nodes, decision/merge diamonds, fork/join bars, solid succession arrows,
dashed data-flow arrows — for actions.

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
- `attribute def Name [:> Super] { attribute field ...; }` — a standalone
  value-type definition (e.g. a struct-like record type), a leaf box
  stereotyped «attribute def» with an "attributes" compartment. Confirmed
  against `examples/bvm.mmd`'s own `attribute def Product { ... }`, which was
  already referenced by name from things this subset rendered before this
  kind existed (`part inventory : Product[8];`, `attribute selectedProduct :
  Product;`) — those references now point at an actual box.
- `enum def Name [:> Super] { enum literal; ... }` — an enumeration, a leaf
  box stereotyped «enum def» with a "values" compartment listing each
  literal. Confirmed against `examples/bvm.mmd`'s own
  `enum def DispenseResult { enum success; enum failure; }`.
- **Requirements & traceability** — a subset of the spec's separate
  **Requirement Diagram** notation:
  - `requirement def Name [:> Super] { doc ...; subject name [: Type]; }` —
    a leaf box stereotyped «requirement def», with a "subject" compartment.
    `require constraint`/`assume constraint`/`objective`/`stakeholder` and
    other requirement-body constructs are out of scope, skipped resiliently
    like any other unsupported member.
  - A bare `requirement name [: Type] [:> derivedFrom];` **usage** — stereotyped
    «requirement», header "name : Type". Unlike a part usage, this always
    gets its own box even when body-less (the norm for a requirement usage),
    since the relationships below need something to point at.
  - **Requirement derivation** — SysML v2 has no standalone `deriveReqt`
    keyword; derivation is ordinary usage subsetting (confirmed against
    `examples/bvm.mmd`'s own
    `requirement req004 : ProductDispensingReq :> req012;`, which combines an
    instantiated type (`:`) and a derivation target (`:>`) on the same
    usage — kept as two separate fields, `usageType` and `derivedFrom`, so
    neither is lost). Drawn as a dashed «derive» arrow, tip at the more
    general requirement, the same directional convention as specialization.
  - `satisfy <req> by <target>;` and `verify <req> by <target>;` — a dashed
    dependency arrow from `target` to `req` (the element depends on
    fulfilling the requirement), labeled «satisfy»/«verify». Only `satisfy`
    is confirmed against a real corpus file (`examples/bvm.mmd`, REQ-001
    through REQ-013); `verify` follows the same grammar shape per spec.
  - `trace <a> to <b>;` and `allocate <a> to <b>;` — the same dashed-arrow
    shape, from `a` to `b`, labeled «trace»/«allocate». Neither is
    corpus-confirmed yet; implemented from the spec's grammar, which mirrors
    `satisfy`/`verify` closely enough that the same parser function handles
    both keyword pairs.
  - Every one of these dependency arrows resolves its endpoints by **simple
    name only** — see "Known limitations" for what that does and doesn't
    reach (a multi-segment instance path like `by bvm.coinAcceptor`, as
    `examples/bvm.mmd` itself uses throughout, does not resolve to a box
    today).
- **Use cases** — a subset of the spec's separate **Use Case Diagram**
  notation, grounded against the OMG's own training corpus
  (`Systems-Modeling/SysML-v2-Release/sysml/src/training/"35. Use Cases"`):
  - `use case def Name [:> Super] { subject s [: Type]; actor a [: Type]; objective { doc ...; } }`
    — a leaf box stereotyped «use case def», with a "subject" compartment;
    `objective`'s doc text is folded into the box's tooltip alongside any of
    its own. `require constraint`-style bodies aren't part of use cases, but
    other unrecognized members are skipped resiliently as usual.
  - A bare `use case name [: Type] { ... }` **usage** — stereotyped «use
    case», always kept even body-less, same rationale as a requirement
    usage: `include` needs a box to point at.
  - **Actors** — each `actor` member draws as a small stick-figure icon
    beside the box (in a column, one per actor) with a plain, undirected
    association line to it — the one piece of this diagram type's notation
    that isn't just a compartment, matching the spec's actual convention
    rather than a text-list shortcut. A usage's `actor x = existingActor;`
    (redefining an inherited actor by reference, rather than giving it a
    fresh type) shows as `x = existingActor` on the icon's label.
  - **`include`** — `include use case [name] [: Target] { ... };` (full
    form) or the shorthand `include name[multiplicity] { ... };` (the bare
    name itself is the target) — a dashed «include» dependency arrow from
    the including use case to the included one. A leading `then` (real
    usages idiomatically chain their steps this way) is consumed and
    discarded.
  - **A bare nested `use case [name] { ... }` step** (no `include` keyword —
    a use case usage performing a sub-use-case as one of its steps) draws
    the same «include» arrow *and* gets promoted to its own box, so a
    step's own nested relationships have something to draw against.
    Confirmed necessary against the OMG's own `Use Case Usage Example.sysml`:
    `'drive vehicle'` is exactly this — a step declared nowhere else, whose
    own nested `include 'add fuel'...` is two levels deep. Both now resolve.
    Still out of scope: the `first`/`then`/`done`/`decide`/`fork`/`join`
    activity-style *sequencing* between steps — the relationship each step
    implies is captured, but not the order they run in (see "Known
    limitations").
- **Activity/action diagrams** — grounded against the OMG's own training
  corpus (`Systems-Modeling/SysML-v2-Release/sysml/src/training/
  "14. Action Definitions"` through `"17. Control"`):
  - `action def Name [:> Super] { in/out params; nested action usages; flow ...; first/then succession; decide/merge/fork/join; done; }`,
    or a bare `action name : Type { ... }` usage (discarded when body-less,
    like a part usage). With no flowchart content (no succession/start/done/
    nested actions/control nodes), it's a plain leaf box («action def»/
    «action») showing just its parameters — same "one level deep" convention
    as the connector container otherwise: a nested `action name : Type { ... }`
    becomes one flowchart node, not expanded recursively.
  - With flowchart content, a genuine flowchart: a filled **start** node
    (`first start;`), a bordered "final" **done** node (`then done;`),
    rounded action nodes, unfilled **decision/merge diamonds**, filled
    **fork/join bars**, and solid succession arrows between them — laid out
    top-to-bottom by longest-path-from-start layering (a plain layered
    layout, no edge-crossing minimization).
  - **Succession** — `first A [if guard] then B;`, the bare `[if guard]
    then B;` shorthand (implicit predecessor: whichever action/control node
    was most recently declared or succeeded — the idiom the OMG's own
    examples use), and the `then action B: Type { ... }` declaration-
    succession shorthand. A guard shows as a bracketed label (`[guard]`) on
    the arrow.
  - **`decide`/`fork`** — a branch point: several sibling statements
    immediately following it (`if g1 then X; if g2 then Y;` for `decide`, or
    bare `then A; then B;` for `fork`) all fan out from the *same* node
    rather than chaining to each other (confirmed necessary against the
    OMG's own `Decision Example.sysml`/`Fork Join Example.sysml` — an
    earlier version of this got it wrong). Unnamed in the source (as both
    usually are), so each gets a synthesized id (`__decide1__`, `__fork1__`,
    ...) — internal only, never shown.
  - **`merge`/`join`** — a convergence point: `then merge name;`/
    `join name;` declares it, and any later bare `then name;` elsewhere in
    the body (including a "loop-back" edge from further down the flow, as
    in `Decision Example.sysml`) adds another incoming edge to the *same*
    node, found by that name regardless of declaration order.
  - **`loop [action] name { ... } [until cond];`** — its own body is skipped
    structurally (one level deep, same as a nested action's) but still
    becomes its own flowchart node, labeled `loop <name>`; the `until`
    condition is kept but not yet shown on the node (see "Known
    limitations").
  - **Flow** — `flow [name] from a.b to c.d;` between two nested actions'
    items, drawn as a dashed arrow (reusing the same shape built for
    satisfy/verify/trace/allocate/include/derive), distinct from a solid
    succession arrow.
  - **Deliberately out of scope**: `bind` (data binding — parsed and
    discarded, not drawn) and expanding a `loop`'s own body.
- `doc /* ... */` comments (shown as a hover tooltip on the box).
- `import` statements and quoted (`'...'`) identifiers (parsed/tokenized
  correctly, then ignored).

Everything else — `bind`, a `loop`'s own body, sequence diagrams, state
machines, views, `copy`, variability modeling (`variation`/`variant`),
sequence-style `message ... to` interactions, port redefinition, expressions
beyond a raw right-hand side — is outside this subset. The parser skips
unrecognized constructs resiliently (structurally, brace-aware) rather than
failing the whole diagram, so a real file mixing
supported and unsupported constructs still renders what it can.

### Validation corpus

Checked visual notation choices (compartment layout, sharp-vs-rounded
corners, composition-tree vs. internal-block-diagram styles, connector
arrowheads/labels) against the OMG's own
[Intro to the SysML v2 Language — Graphical Notation](https://github.com/Systems-Modeling/SysML-v2-Release/blob/master/doc/Intro%20to%20the%20SysML%20v2%20Language-Graphical%20Notation.pdf)
deck — specifically its structural modules (pages 16–47: "Packages & Element
Names," "Definition Elements," "Usage Elements," "Part Decomposition," "Part
Interconnection," "Variability"). The requirement-traceability support above
is *not* checked against that deck's own Requirement Diagram notation
(page 48 on, a distinct visual language of its own); it reuses this subset's
existing compartmented-box and dependency-arrow conventions instead, which is
close in spirit but not a verified match to the spec's dedicated requirement
box style. The use-case support's stick-figure actors and association lines
*are* the spec's actual convention (a well-established, stable part of the
UML/SysML visual language, not something this subset invented), but the
use-case box's own compartmented-rectangle style — like the requirement
box — wasn't independently checked against this deck's own Use Case Diagram
pages. The action flowchart's node shapes (filled start circle, bordered
"final" circle, rounded action box, unfilled decision/merge diamond, filled
fork/join bar, solid succession arrow) follow the standard, stable UML/SysML
activity-diagram convention rather than this subset's own invention, same
reasoning as the use-case actors — but, also like use cases, wasn't
independently checked against this deck's own Action/Activity Diagram pages.
Everything else from page 48 on (remaining behavior notation, plus sequence
diagrams entirely) is still out of scope here.

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
  as realistic usage to parse against. Its `training/"35. Use Cases"`
  directory (`Use Case Definition Example.sysml`, `Use Case Usage Example.sysml`)
  is what grounded `use case def`/usage/`actor`/`include`; its
  `training/"14. Action Definitions"` through `"17. Control"` (action defs,
  succession, conditional succession, decision/fork/join/merge) drove all of
  the activity/action-diagram support above, start to finish —
  `Action Definition Example.sysml`, `Action Succession Example-1/2.sysml`,
  `Action Shorthand Example.sysml`, and `Conditional Succession
  Example-1/2.sysml` for plain/guarded succession and start/done;
  `Decision Example.sysml` and `Fork Join Example.sysml` for `decide`/
  `merge` and `fork`/`join` respectively (both parse and render end to end
  now — see the regression tests citing them); `Control Structures
  Example.sysml` for `loop`. `"18. Action Performance"` through
  `"22. Opaque Actions"` weren't read; likely more out-of-scope territory.
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
  the user actually produced, not because it's a citable outside source. Its
  own `BVMRequirements` package (REQ-001 through REQ-013) is also what drove
  this subset's requirements/traceability support — including the discovery
  that `deriveReqt` isn't a real keyword — and its `attribute def Product`/
  `enum def DispenseResult` drove `attribute def`/`enum def` support.

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
  (A `requirement` usage is the one exception — see "Scope" above, it keeps
  both deliberately, since that combination is exactly what a real
  requirement derivation looks like.)
- **A traceability arrow's endpoints resolve by simple name only** — the
  last segment of a `satisfy`/`verify`/`trace`/`allocate` path is matched
  against a top-level box's own name, with no resolution through an
  instance's type. `examples/bvm.mmd`'s own `satisfy req001 by
  bvm.coinAcceptor;` doesn't draw an arrow today: `bvm` is a body-less
  top-level usage (discarded, so its type is never recorded), and even if it
  were, `coinAcceptor` names a *child inside* `BVM`'s own rendered box, not a
  top-level one. `examples/features/09-requirements.mmd` demonstrates the
  case that *does* resolve — a `by`/`to` target that's a plain top-level name.
- **Dependency arrows sharing an endpoint fan out from its center** (so a
  requirement with both a `satisfy` and a `verify` landing on it stays
  legible) but otherwise use the same straight-line-to-border approach as the
  specialization arrow, with the same crossing caveat in a dense layout.
- `verify`/`trace`/`allocate` are implemented from the spec's grammar, not
  confirmed against a real corpus file the way `satisfy` and requirement
  derivation are (both evidenced in `examples/bvm.mmd`) — flag it if real
  usage doesn't match.
- **`attribute def`/`enum def` are only recognized at the top/package
  level**, same as every other `X def` kind here — one nested inside a
  `part def`'s body is skipped structurally rather than rendered as its own
  box (see `parsePartBody` in `src/parser/parser.ts`). Not seen nested in
  the corpus so far, but worth knowing if a real model does this.
- **A use case's `include` target must match a box by its own declared
  name, not by resolving through a usage's type.** `include use case
  'enter vehicle' : 'Enter Vehicle';` looks for a box literally named
  `Enter Vehicle` (a `use case def` or a usage that happens to share that
  exact name) — a sibling usage named `'enter vehicle'` (lowercase, typed
  `: 'Enter Vehicle'`) is a *different* name and won't match. This mirrors
  the same "simple name only" resolution every other dependency arrow uses.
- **A use case usage's `first`/`then`/`done` control-flow markers are still
  parsed past, not modeled.** A bare nested `use case` step and an explicit
  `include` both draw as «include» relationships now (see "Scope" above),
  but the *order* they run in — which one is first, which follow which —
  isn't captured or shown; every step and include just becomes its own
  arrow, independent of the others.
- **A use case box's own bounding rect (used by cross-box arrows) includes
  its actor column**, not just the compartmented rectangle — an
  include/specialization/derive arrow pointing at a use case with actors
  may anchor closer to the actor column than to the box itself.
- **`bind` (data binding) is parsed and discarded, not drawn.** A parameter
  wired via `bind a.b = c;` shows no line at all — only `flow` produces the
  dashed data-flow arrow.
- **A `loop`'s own body is skipped structurally, not expanded** — same
  one-level-deep convention as a nested action's. Its `until` condition is
  parsed and kept on the node (`ActionUsageNode.until`) but not yet shown
  anywhere in the drawing; only the node's `loop <name>` label appears.
- **A `decide`/`fork` node only stays a branch point across *consecutive*
  sibling statements.** `then decide; if a then X; if b then Y;` correctly
  fans out both branches from the same diamond; if something else (an
  unrelated action declaration, say) sits between the two `if` statements,
  the second one would no longer resolve against the decide node — not seen
  in the corpus, but worth knowing if a real model interleaves them.
- **A long guard label on a short vertical arrow can visually overlap the
  arrowhead** (see `examples/features/12-action-flowcharts.mmd`'s
  `focus -> shoot` arrow, or the decide/fork diamonds in
  `examples/features/13-decision-fork-join-loop.mmd`) — same category of
  straight-line/no-real-routing limitation as the specialization and
  dependency arrows above; with several branches converging on one small
  diamond or bar, labels and lines can visually crowd each other.
- **Action containment is one level deep**, same convention as the
  connector container: a nested `action name : Type { ... }` becomes one
  flowchart node showing just its name, not its own further-nested actions,
  successions, or flows.

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
it has containment but no connectors of its own, its `BVMRequirements`
package for requirements/traceability, though none of its `satisfy`
statements draw an arrow — see "Known limitations" — and its `Product`/
`DispenseResult` for `attribute def`/`enum def`). `examples/features/` has
one small file per feature cluster (definition/usage styling, the
composition tree, the connector container, nested packages, resilience
against unsupported constructs, every connector form, specialization
arrows/subsets/redefines, requirements/traceability, attribute def/enum def,
use cases, action flowcharts, and decide/merge/fork/join/loop) for a quick
visual tour of the whole plugin; `index.html`'s dropdown has a "Feature
showcase" group listing them all.

## Development

```bash
npm install
npm run dev     # live demo at http://localhost:5173 — pick an example from the dropdown, edits re-render
npm test        # vitest: parser + renderer tests, including every example and feature file end to end
npm run build   # emits dist/mermaid-sysml-v2.core.mjs + .d.ts files
```

## Extending this

Natural next steps, roughly in order of value:

1. **Sequence diagrams** — not scoped at all yet; the next diagram type to
   ground against real examples (the OMG's own training corpus almost
   certainly has one, same as every other diagram kind here) before
   designing anything. Likely its own rendering concern again — lifelines
   and messages over time, not a flowchart or a compartmented box.
2. **Order/sequencing between a use case's steps** — each `include`/nested
   `use case` step now draws its own relationship (see "Scope" above), but
   not the `first`/`then`/`done` order they actually run in. Reusing the
   activity control-flow layout already built for actions is the likely
   path here, once it's worth the cost of a second flowchart-shaped
   rendering path for what's still fundamentally a use-case diagram.
3. **Resolve a `by`/`to` traceability path through an instance's type**, not
   just a simple name — `examples/bvm.mmd`'s own `satisfy req001 by
   bvm.coinAcceptor;` needs this to ever draw an arrow: look up `bvm`'s
   recorded type (currently discarded, since a body-less top-level part
   usage has nothing else worth keeping today), then resolve `coinAcceptor`
   as a child within that type's own rendered container/tree box.
4. **Recursive containment for the connector container**, not just the
   composition tree — the tree already recurses (see "Scope" above); a child
   inside an IBD-style container whose own type has further containment and
   connectors currently just shows as a plain box with ports instead of
   expanding.
5. **Real edge routing for the specialization/dependency/succession
   arrows**, instead of a straight line clipped to each box's border — would
   fix the visual crossing noted in "Known limitations" for a dense grid
   layout.
6. **A subsetting/redefinition arrow between two usages**, distinct from the
   definition-level specialization arrow already drawn — the spec shows this
   as a separate dashed relationship line.
7. **Requirement body constructs** — `require constraint`/`assume
   constraint`/`objective`/`stakeholder`, and inline requirement text shown
   in the box itself rather than only as a hover tooltip (would need real
   text wrapping — see item 9).
8. **Hollow diamond for a reference (non-owning) containment**, contrasted
   with the filled diamond already drawn for composition.
9. **Real text measurement** — the renderer currently estimates box width
   from character counts; swapping in `getBBox()`-based measurement (as
   mermaid's own class diagram does) would tighten box sizing and enable
   wrapping long requirement text (see item 7) and fixing the guard-label
   crowding noted in "Known limitations."
10. Publishing to npm and registering in Mermaid's
   [community integrations list](https://mermaid.js.org/ecosystem/integrations-community.html),
   and linking this project from the GitHub issue, once it's further along.

## License

MIT
