// Feature: activity/action diagrams, round 2 — the decide/merge/fork/join/
// loop control-node vocabulary. Round 1 (see 12-action-flowcharts.mmd) had
// to drop every succession that ran through one of these; round 2 draws
// them as real flowchart nodes (decision/merge diamonds, fork/join bars)
// so nothing is lost.
//
// ChargeBattery is the OMG's own Decision Example.sysml almost verbatim: a
// merge node with a loop-back edge (addCharge -> continueCharging), and a
// decide node with two guarded branches. Brake is Fork Join Example.sysml:
// one fork fanning out to three parallel actions, all converging on one
// join, plus two data flows into the final action. ChargeWithLoop is
// Control Structures Example.sysml's loop idiom — the loop's own body is
// parsed only far enough to skip it (one level deep, same as any other
// nested action), but it still gets a node of its own.
private import ScalarValues::*;
package DecisionForkJoinLoop {
  action def MonitorBattery { out charge : Real; }
  action def AddCharge { in charge : Real; }
  action def EndCharging;

  action def ChargeBattery {
    first start;
    then merge continueCharging;
    then action monitor : MonitorBattery { out batteryCharge : Real; }
    then decide;
      if monitor.batteryCharge < 100 then addCharge;
      if monitor.batteryCharge >= 100 then endCharging;
    action addCharge : AddCharge { in charge = monitor.batteryCharge; }
    then continueCharging;
    action endCharging : EndCharging;
    then done;
  }

  action def MonitorBrakePedal { out pressure : BrakePressure; }
  action def MonitorTraction { out modFreq : Real; }
  action def Braking { in brakePressure : BrakePressure; in modulationFrequency : Real; }

  action def Brake {
    action turnOn : TurnOn;
    then fork;
      then monitorBrakePedal;
      then monitorTraction;
      then braking;

    action monitorBrakePedal : MonitorBrakePedal { out brakePressure; }
    then joinNode;

    action monitorTraction : MonitorTraction { out modulationFrequency; }
    then joinNode;

    flow from monitorBrakePedal.brakePressure to braking.brakePressure;
    flow from monitorTraction.modulationFrequency to braking.modulationFrequency;

    action braking : Braking { in brakePressure; in modulationFrequency; }
    then joinNode;

    join joinNode;
    then done;
  }

  action def ChargeWithLoop {
    loop action charging {
      action monitor : MonitorBattery { out charge; }
      then if monitor.charge < 100 {
        action addCharge : AddCharge { in charge = monitor.charge; }
      }
    } until charging.monitor.charge >= 100;
    then action endCharging : EndCharging;
    then done;
  }

  attribute def BrakePressure;
  action def TurnOn;
}
