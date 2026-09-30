// Feature: `send`/`accept` — the asynchronous-messaging vocabulary this
// subset draws as special flowchart node shapes (a concave pentagon for
// accept, a convex pentagon for send — the standard UML/SysML shapes for
// these action kinds), participating in the same succession chain as any
// other action node.
//
// Grounded against the OMG's own training corpus: Systems-Modeling/
// SysML-v2-Release/sysml/src/training/"21. Asynchronous Messaging"/
// Messaging Example.sysml, verbatim, including its own `item def`
// declarations below — Scene/Image/Picture each get their own box (see
// examples/features/10-attribute-and-enum-defs.mmd for `item def`'s sibling
// `attribute def`/`enum def`). This is also the first real building block
// of a genuine sequence/interaction view — `screen` is the message's
// addressee, but this round doesn't draw a cross-box arrow to it (only the
// "to screen" text on the send node) since `screen` sits outside
// `takePicture`'s own flowchart namespace; see README "Extending this" for
// what a real Sequence View would need on top of this.
package SendAccept {
  action def Focus { in item scene : Scene; out item image : Image; }
  action def Shoot { in item image : Image; out item picture : Picture; }
  action def TakePicture;

  action screen;

  action takePicture : TakePicture {
    action trigger accept scene : Scene;

    then action focus : Focus {
      in item scene = trigger.scene;
      out item image;
    }

    flow from focus.image to shoot.image;

    then action shoot : Shoot {
      in item image;
      out item picture;
    }

    then send new Show(shoot.picture) to screen;
  }

  item def Scene;
  item def Image;
  item def Picture;
  attribute def Show {
    item picture : Picture;
  }
}
