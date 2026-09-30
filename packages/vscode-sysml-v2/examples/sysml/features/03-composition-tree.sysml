// Feature: containment with no connectors renders as a composition tree —
// a filled diamond under the parent, org-chart lines down to each child.
// Recursive: engine and chassis each have their own containment, so the
// tree expands two levels deep. Multiplicities show as "[n]" on the child.
part def Vehicle {
  part engine : Engine;
  part chassis : Chassis;
  part wheels : Wheel [4];
}
part def Engine {
  part cylinder : Cylinder [4];
}
part def Cylinder;
part def Chassis {
  part frontAxle : Axle;
  part rearAxle : Axle;
}
part def Axle;
part def Wheel;
