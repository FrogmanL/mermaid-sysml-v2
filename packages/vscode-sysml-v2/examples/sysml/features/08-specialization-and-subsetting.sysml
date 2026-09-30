// Feature: specialization arrows between definitions, and subsets/redefines
// display on usages.
//
// Vehicle :> Machine and FrontAxle :> Axle each draw a hollow-triangle
// generalization arrow (tip at the supertype), matching the spec's own
// graphical notation — this applies to any definition kind, not just
// `part def`: AxleMountIF :> BaseMountIF shows the same arrow between two
// port defs.
//
// Family's `socialService :>> adultMember` usage shows the actual `:>>`
// (redefines) operator in its composition-tree label instead of collapsing
// it to a plain `:` — likewise Vehicle's `mass :> ISQ::mass` attribute shows
// `:>` (subsets), not `:`. ISQ::mass itself isn't a box in this diagram, so
// no arrow is drawn for it — only a supertype actually present as its own
// definition gets one (see Vehicle/Machine and FrontAxle/Axle above).
package SpecializationAndSubsetting {
  part def Machine {
    attribute totalMass;
  }
  part def Vehicle :> Machine {
    attribute mass :> ISQ::mass;
  }

  part def Axle {
    attribute mass;
  }
  part def FrontAxle :> Axle {
    attribute steeringAngle;
  }

  port def BaseMountIF;
  port def AxleMountIF :> BaseMountIF {
    out transferredTorque : Real;
  }

  part def Family {
    part adultMember : Person;
    part socialService :>> adultMember;
  }
  part def Person;
}
