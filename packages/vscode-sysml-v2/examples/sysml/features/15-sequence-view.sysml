// Feature: Sequence View — SysML v2's actual multi-participant `message
// [name] [of Type] from <path> to <path>;` construct, drawn as a genuine
// multi-lifeline sequence diagram: one small «part»-stereotyped header box
// per participant, a dashed lifeline below each, and a solid arrow per
// message in time order (a same-lifeline message loops back on itself
// instead of a degenerate zero-length arrow).
//
// Grounded against the OMG's own training corpus: Systems-Modeling/
// SysML-v2-Release/sysml/src/training/"27. Occurrences"/Interaction
// Example-1.sysml (the `occurrence def`/`ref part` form below, trimmed to
// this subset's scope — its own `Interaction Realization-1.sysml` companion
// adds a redefinition-heavy `occurrence` *usage* this subset doesn't parse)
// and `examples/Interaction Sequencing Examples/ServerSequenceModel.sysml`
// (the `part def`-with-`message` form, verbatim). `sensedSpeedMessage`
// below is a real example of the "resolve by first path segment" limitation
// — both its endpoints sit under `vehicle`, so it draws as a self-message
// loop rather than a cross-lifeline arrow. See README "Extending this" for
// what's still missing on top of this first real basis.
package SequenceViewExample {
  item def SetSpeed;
  item def SensedSpeed;
  item def FuelCommand;

  occurrence def CruiseControlInteraction {
    ref part :>> driver;
    ref part :>> vehicle;

    message setSpeedMessage of SetSpeed
      from driver.setSpeedSent to vehicle.cruiseController.setSpeedReceived;

    message sensedSpeedMessage of SensedSpeed
      from vehicle.speedometer.sensedSpeedSent to vehicle.cruiseController.sensedSpeedReceived;

    message fuelCommandMessage of FuelCommand
      from vehicle.cruiseController.fuelCommandSent to vehicle.engine.fuelCommandReceived;

    first setSpeedMessage then sensedSpeedMessage;
  }

  part def PubSubSequence {
    part producer[1] {
      event occurrence publish_source_event;
    }

    message publish_message from producer.publish_source_event to server.publish_target_event;

    part server[1] {
      event occurrence subscribe_target_event;
      then event occurrence publish_target_event;
      then event occurrence deliver_source_event;
    }

    message subscribe_message from consumer.subscribe_source_event to server.subscribe_target_event;
    message deliver_message from server.deliver_source_event to consumer.deliver_target_event;

    part consumer {
      event occurrence subscribe_source_event;
      then event occurrence deliver_target_event;
    }
  }
}
