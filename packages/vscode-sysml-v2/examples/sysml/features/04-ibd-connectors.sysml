// Feature: containment *with* connectors renders as an internal-block-
// diagram-style container — port markers, orthogonal connector routing
// (one lane per connector so a hub with several connections stays legible),
// an arrowhead at the target, and a label for the conveyed item. The two
// h -> c flows below share one child.port pair and collapse into a single
// deduped line (labeled with whichever's item name is seen first).
private import ScalarValues::*;
part def RoomContext {
  part h : Hallway;
  part c : Classroom;
  part s : Storageroom;

  flow h.classExit.air to c.classEntry.air;
  flow h.classExit.student to c.classEntry.student;
  flow h.storageExit.air to s.storageEntry.air;
}

part def Hallway {
  port classExit : ~EntryEnvironment;
  port storageExit : ~EntryEnvironment;
}
part def Classroom {
  port classEntry : EntryEnvironment;
}
part def Storageroom {
  port storageEntry : EntryEnvironment;
}
port def EntryEnvironment {
  in air : Real;
  in student : Real;
}
