// Feature: use case diagrams — `use case def` (subject/actor members,
// objective), a `use case` usage (always drawn even body-less), stick-
// figure actors with a plain association line to the box (the one piece
// of classic use-case notation this subset draws that isn't just a
// compartment, per the actual spec convention), and a dashed «include»
// dependency arrow between two use cases — drawn for an explicit `include`
// *and* for a bare nested `use case` step chained with `then` (real usages
// idiomatically write both), since the outer use case's behavior includes
// either one either way.
//
// Grounded against the OMG's own training corpus: Systems-Modeling/
// SysML-v2-Release/sysml/src/training/"35. Use Cases". 'drive vehicle'
// below is that example's own idiom almost verbatim: a step with no
// separate `use case def`/usage declared elsewhere, whose own nested
// `include 'add fuel'...` is two levels deep — both the step itself and
// its own nested include are now resolved and drawn, each getting a box.
package UseCases {
  use case def 'Provide Transportation' {
    subject vehicle : Vehicle;
    actor driver : Person;
    actor passengers : Person[0..4];
    objective {
      doc /* Transport driver and passengers from starting location to ending location. */
    }
  }
  use case def 'Enter Vehicle' {
    subject vehicle : Vehicle;
    actor driver : Person;
  }
  use case def 'Exit Vehicle' {
    subject vehicle : Vehicle;
    actor driver : Person;
  }

  use case 'provide transportation' : 'Provide Transportation' {
    subject vehicle;
    first start;
    then include use case 'enter vehicle' : 'Enter Vehicle' {
      subject vehicle;
      actor driver = 'provide transportation'::driver;
    }
    then use case 'drive vehicle' {
      subject vehicle;
      actor driver = 'provide transportation'::driver;
      include 'add fuel'[0..*] {
        subject vehicle;
        actor fueler = driver;
      }
    }
    then include use case 'exit vehicle' : 'Exit Vehicle' {
      subject vehicle;
    }
    then done;
  }

  use case 'add fuel' {
    subject vehicle : Vehicle;
    actor fueler : Person;
  }

  part def Vehicle;
  part def Person;
}
