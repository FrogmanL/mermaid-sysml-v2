// Feature: requirements & traceability — `requirement def`, a `requirement`
// usage (always drawn even body-less, since satisfy/verify/dependency/allocate
// /derive need a box to point at), a dashed dependency arrow for each of
// `satisfy` / `verify` / `dependency` / `allocate`, and a `«derive»` arrow for
// a requirement usage's `:>` derivation. All of it is standard SysML v2:
//  - `satisfy req by part;` — the satisfying element must be a usage.
//  - verification is a `verification def` whose `objective { verify req; }`
//    names the requirement (there is no `verify req by x;` statement).
//  - SysML v2 has no `trace` keyword; a trace link is a plain
//    `dependency name from a to b;`.
//  - `allocate a to b;` relates two usages.
//  - derivation is usage subsetting; the derived requirement def specializes
//    the original and redefines its subject (two unrelated subjects are an
//    error), which validates against the OMG Pilot Implementation.
//
// Every arrow here resolves because each target is a single top-level name —
// bvm.mmd's own satisfy statements use a multi-segment instance path
// (`by bvm.coinAcceptor`) instead, which this subset doesn't resolve to a box
// (see README "Known limitations").
package Requirements {
  requirement def NoUnpaidDispensingReq {
    doc /* REQ-012 — top-level safety constraint other requirements derive from. */
    subject sys012 : ProductDispenser;
  }
  requirement def ProductDispensingReq :> NoUnpaidDispensingReq {
    doc /* REQ-004 — dispense once payment is received. */
    subject sys004 :>> sys012 : ProductDispenser;
  }

  requirement req012 : NoUnpaidDispensingReq;
  requirement req004 : ProductDispensingReq :> req012;

  part def ProductDispenser;
  part def ControlSoftware;
  part def DesignDoc;

  part dispenser : ProductDispenser;
  part software : ControlSoftware;
  part designDoc : DesignDoc;

  satisfy req004 by dispenser;
  dependency trace004 from req004 to designDoc;
  allocate software to dispenser;

  verification def AcceptanceTest {
    subject unit : ProductDispenser;
    objective { verify req004; }
  }
}
