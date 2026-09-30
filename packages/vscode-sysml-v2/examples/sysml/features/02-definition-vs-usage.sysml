// Feature: a `part def` renders sharp-cornered, stereotyped «part def»,
// header just the name. A bare `part` usage with a body renders
// rounded-cornered, stereotyped «part», header "name : Type" — per spec.
part def Vehicle {
  attribute mass :> ISQ::mass;
}

part myVehicle : Vehicle {
  attribute topSpeed = 220;
}
