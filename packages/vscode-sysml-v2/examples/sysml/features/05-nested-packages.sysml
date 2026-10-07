// Feature: arbitrarily nested/sibling packages flatten into one diagram.
// Widget and WidgetPort are declared three packages deep; Assembly (in a
// sibling package) reaches Widget through a wildcard import of Parts.
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
    private import Definitions::Parts::*;
    part def Assembly {
      part w : Widget;
    }
  }
}
