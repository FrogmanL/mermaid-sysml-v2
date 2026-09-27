# mermaid-sysml-v2

An external [Mermaid](https://mermaid.js.org) diagram plugin that renders a
subset of the [SysML v2](https://www.omg.org/spec/SysMLv2/) textual notation
— `part def`, `port def`, `interface def`, and their nested members — as
compartmented boxes, in the style of a SysML v2 block/interface definition
diagram.

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

## Scope (v1)

SysML v2's full grammar is large (block definition diagrams, internal block
diagrams, requirements, state, use case, action, and more). This first slice
covers only:

- `package Name { ... }` (optional wrapper)
- `part def Name { attribute ...; port ...; }`
- `port def Name { in/out ...; }`
- `interface def Name { end ...; flow a.b to c.d; }`
- `doc /* ... */` comments (shown as a hover tooltip on the box)
- `import` statements (parsed and ignored)

Everything else — part/attribute *usages* (as opposed to *definitions*),
actions, requirements, state machines, expressions beyond a raw right-hand
side — is outside this subset. The parser skips unrecognized constructs
resiliently rather than failing the whole diagram, so a source file with a
mix of supported and unsupported constructs still renders what it can.

Each `part def` / `port def` / `interface def` is drawn as its own box; there
is no cross-box connection layer yet (e.g. an interface's `flow` is shown
inside that interface's own box, not as an arrow between two part boxes).
See "Extending this" below for where that would go.

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
package VehicleDefinitions {
  part def Vehicle {
    attribute mass :> ISQ::mass;
  }
  part def Axle {
    port leftMountingPoint: AxleMountIF;
    port rightMountingPoint: AxleMountIF;
  }
  port def AxleMountIF {
    out transferredTorque :> ISQ::torque;
  }
  interface def Mounting {
    end axleMount: AxleMountIF;
    end hub: WheelHubIF;
    flow axleMount.transferredTorque to hub.appliedTorque;
  }
}
```
````

See `examples/vehicle.mmd` for the full worked example (the same one posted
in the GitHub issue), and `index.html` for a live editable demo.

## Development

```bash
npm install
npm run dev     # live demo at http://localhost:5173, edits to examples/vehicle.mmd source re-render
npm test        # vitest: parser + renderer smoke tests
npm run build   # emits dist/mermaid-sysml-v2.core.mjs + .d.ts files
```

## Extending this

Natural next steps, roughly in order of value:

1. **Cross-box connections.** Render an arrow between two part boxes when an
   interface's `flow` (or a `connect ... to ...` usage statement) references
   ports that belong to concrete part *usages*, not just definitions.
2. **Part/attribute usages**, e.g. `part engine : Engine;` inside another
   part — needed for the nested internal-block-diagram style shown in the
   INCOSE reference material linked from the issue.
3. **Generalization/specialization** (`part def Foo :> Bar`) drawn as an
   inheritance arrow, and **multiplicities** on ports/attributes.
4. **Real text measurement** — the renderer currently estimates box width
   from character counts; swapping in `getBBox()`-based measurement (as
   mermaid's own class diagram does) would tighten box sizing.
5. Publishing to npm and registering in Mermaid's
   [community integrations list](https://mermaid.js.org/ecosystem/integrations-community.html),
   and linking this project from the GitHub issue, once it's further along.

## License

MIT
