// Feature: arbitrarily nested/sibling packages flatten into one diagram.
// Widget and WidgetPort are declared three packages deep; Assembly (in a
// sibling package) still resolves and references Widget by its bare name.
package Outer {
  package Definitions {
    package Parts {
      part def Widget;
    }
    package Ports {
      port def WidgetPort;
    }
  }
  package Usage {
    part def Assembly {
      part w : Widget;
    }
  }
}
