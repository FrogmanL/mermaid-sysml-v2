// Beverage Vending Machine (BVM) — SysML v2 textual model
// Generated for MBSE-4 ("Generate SysML v2 model from example requirements using Claude"),
// input: MBSE-3-example-requirements.md
//
// Covers: structure (parts), interfaces (ports), behavior (state machine),
// and requirement traceability (satisfy/derive) back to REQ-001..013.

package BeverageVendingMachine {

    public import ScalarValues::*;

    // ---------------------------------------------------------------
    // Structure
    // ---------------------------------------------------------------

    part def BVM {
        part coinAcceptor : CoinAcceptor;
        part display : Display;
        part controlUnit : ControlUnit;
        part dispenser : ProductDispenser;
        part changeMechanism : ChangeMechanism;

        connect coinAcceptor.coinOut to controlUnit.coinIn;
        connect controlUnit.dispenseOut to dispenser.dispenseIn;
        connect controlUnit.changeOut to changeMechanism.changeIn;
        connect controlUnit.displayOut to display.displayIn;
    }

    part def CoinAcceptor {
        port coinOut : CoinPort;

        // REQ-008: standard-diameter coins, one at a time
        attribute acceptsOneAtATime : Boolean = true;
    }

    part def Display {
        port displayIn : DisplayPort;

        // REQ-009: at least 2 lines x 16 chars
        attribute lineCount : Integer = 2;
        attribute charsPerLine : Integer = 16;
    }

    part def ControlUnit {
        port coinIn : CoinPort;
        port dispenseOut : DispensePort;
        port changeOut : CoinPort;
        port displayOut : DisplayPort;

        attribute balance : Real;                    // REQ-013: persists across resets
        attribute selectedProduct : Product;
        attribute inventory : Product[8];                  // REQ-011: >= 8 slots

        state controlUnitStates : ControlUnitStateMachine;
    }

    part def ProductDispenser {
        port dispenseIn : DispensePort;

        // REQ-010: dispense within 5s of payment confirmation
        attribute maxDispenseLatency : Real = 5.0;    // seconds
    }

    part def ChangeMechanism {
        port changeIn : CoinPort;
    }

    attribute def Product {
        attribute id : String;
        attribute price : Real;
        attribute quantity : Integer;                  // REQ-006: 0 => not selectable
    }

    // ---------------------------------------------------------------
    // Interfaces / Ports
    // ---------------------------------------------------------------

    port def CoinPort {
        out attribute coin : Real;                          // coin value
    }

    port def DisplayPort {
        out attribute line1 : String;
        out attribute line2 : String;
    }

    port def DispensePort {
        out attribute productId : String;
        in attribute dispenseResult : DispenseResult;
    }

    enum def DispenseResult {
        enum success;
        enum failure;
    }

    // ---------------------------------------------------------------
    // Behavior — control unit state machine
    // (Idle -> Selecting -> AwaitingPayment -> Dispensing -> (Idle | OutOfService),
    //  with ReturningChange between Dispensing and Idle)
    // ---------------------------------------------------------------

    // Trigger types for the transitions below. `accept` types an implicit
    // payload feature, so it needs a classifier (occurrence def), not a
    // bare occurrence usage.
    occurrence def ProductSelected;
    occurrence def ProductConfirmed;
    occurrence def SufficientPaymentReceived;
    occurrence def DispenseSucceeded;
    occurrence def DispenseFailed;

    state def ControlUnitStateMachine {
        entry; then idle;

        state idle;
        state selecting;
        state awaitingPayment;
        state dispensing;
        state returningChange;
        state outOfService;

        transition idle_to_selecting
            first idle
            accept ProductSelected
            then selecting;

        transition selecting_to_awaitingPayment
            first selecting
            accept ProductConfirmed
            then awaitingPayment;

        transition awaitingPayment_to_dispensing
            first awaitingPayment
            accept SufficientPaymentReceived        // guarded by REQ-012 (balance >= price)
            then dispensing;

        transition dispensing_to_returningChange
            first dispensing
            accept DispenseSucceeded
            then returningChange;

        transition returningChange_to_idle
            first returningChange
            then idle;

        transition dispensing_to_outOfService
            first dispensing
            accept DispenseFailed                    // REQ-007
            then outOfService;
    }

    // ---------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------

    // Textually-authored so SysON can materialize it via "Create a new
    // Representation" on this ViewUsage — the UI's drag-to-populate flow
    // does not work for Interconnection View. See MBSE-8-syson-notes.md.
    view bvmInterconnectionView : StandardViewDefinitions::InterconnectionView {
        expose BVM;
        expose BVM::coinAcceptor;
        expose BVM::display;
        expose BVM::controlUnit;
        expose BVM::dispenser;
        expose BVM::changeMechanism;
    }

    view controlUnitStateTransitionView : StandardViewDefinitions::StateTransitionView {
        expose ControlUnitStateMachine;
        expose ControlUnitStateMachine::idle;
        expose ControlUnitStateMachine::selecting;
        expose ControlUnitStateMachine::awaitingPayment;
        expose ControlUnitStateMachine::dispensing;
        expose ControlUnitStateMachine::returningChange;
        expose ControlUnitStateMachine::outOfService;
        expose ControlUnitStateMachine::idle_to_selecting;
        expose ControlUnitStateMachine::selecting_to_awaitingPayment;
        expose ControlUnitStateMachine::awaitingPayment_to_dispensing;
        expose ControlUnitStateMachine::dispensing_to_returningChange;
        expose ControlUnitStateMachine::returningChange_to_idle;
        expose ControlUnitStateMachine::dispensing_to_outOfService;
    }

}

// ---------------------------------------------------------------
// Requirements and traceability
// ---------------------------------------------------------------

package BVMRequirements {

    private import BeverageVendingMachine::*;

    // Concrete BVM instance that requirement usages below trace to.
    part bvm : BVM;

    // ---------------------------------------------------------------
    // Requirement definitions (text + generic subject)
    // ---------------------------------------------------------------

    requirement def CoinPaymentReq {
        doc /* REQ-001 — Coin Payment
             * The BVM shall accept coins as a form of payment.
             * Rationale: Primary payment mechanism for the reference scope;
             *            card/contactless out of scope.
             * Verification: Test */
        subject sys001 : CoinAcceptor;
    }

    requirement def ProductDisplayReq {
        doc /* REQ-002 — Product Display
             * The BVM shall display the currently selected product and its price.
             * Verification: Demonstration */
        subject sys002 : Display;
    }

    requirement def ProductSelectionReq {
        doc /* REQ-003 — Product Selection
             * The BVM shall allow the user to select exactly one product from the
             * available inventory per transaction.
             * Verification: Test */
        subject sys003 : ControlUnit;
    }

    requirement def NoUnpaidDispensingReq {
        doc /* REQ-012 — No Unpaid Dispensing
             * The BVM shall not dispense a product unless payment received for the
             * current transaction is greater than or equal to the selected
             * product's price.
             * Rationale: Top-level safety/business constraint other functional
             *            requirements derive from.
             * Verification: Test */
        subject sys012 : ProductDispenser;
    }

    requirement def ProductDispensingReq :> NoUnpaidDispensingReq {
        doc /* REQ-004 — Product Dispensing
             * The BVM shall dispense the selected product once payment equal to
             * or greater than its price has been received.
             * Verification: Test */
        subject sys004 :>> sys012 : ProductDispenser;
    }

    requirement def ChangeReturnReq {
        doc /* REQ-005 — Change Return
             * The BVM shall return change equal to the difference between payment
             * received and product price, if payment exceeds price.
             * Verification: Test */
        subject sys005 : ChangeMechanism;
    }

    requirement def OutOfStockPreventionReq {
        doc /* REQ-006 — Out-of-Stock Prevention
             * The BVM shall prevent selection of a product whose inventory count
             * is zero.
             * Verification: Test */
        subject sys006 : ControlUnit;
    }

    requirement def DispenseFailureRecoveryReq :> NoUnpaidDispensingReq {
        doc /* REQ-007 — Dispense-Failure Recovery
             * If the BVM cannot dispense a paid-for product (e.g. mechanical jam),
             * it shall enter an Out-of-Service state, display a service message,
             * and return the payment received for that transaction.
             * Verification: Test */
        subject sys007 :>> sys012 : ProductDispenser;
    }

    requirement def CoinSlotInterfaceReq {
        doc /* REQ-008 — Coin Slot Interface
             * The BVM shall provide a coin slot interface capable of accepting
             * standard-diameter coins one at a time.
             * Verification: Inspection */
        subject sys008 : CoinAcceptor;
    }

    requirement def DisplayInterfaceReq {
        doc /* REQ-009 — Display Interface
             * The BVM shall provide a user display interface capable of showing
             * at least two lines of text of at least 16 characters each.
             * Verification: Inspection */
        subject sys009 : Display;
    }

    requirement def DispenseLatencyReq {
        doc /* REQ-010 — Dispense Latency
             * The BVM shall dispense a product within 5 seconds of successful
             * payment confirmation.
             * Verification: Test */
        subject sys010 : ProductDispenser;
    }

    requirement def InventoryCapacityReq {
        doc /* REQ-011 — Inventory Capacity
             * The BVM shall support a product inventory of at least 8 distinct
             * product slots.
             * Verification: Inspection */
        subject sys011 : ControlUnit;
    }

    requirement def BalancePersistenceReq {
        doc /* REQ-013 — Balance Persistence
             * The BVM shall retain the current transaction's coin balance across
             * a display refresh or transient control-unit reset, without loss of
             * the accumulated amount.
             * Verification: Test */
        subject sys013 : ControlUnit;
    }

    // ---------------------------------------------------------------
    // Requirement usages — instances of the defs above, bound to `bvm`.
    // satisfy/derive need a feature (usage) on both sides, not a
    // requirement def, so these exist purely to give the relationships
    // below something valid to reference.
    // ---------------------------------------------------------------

    requirement req001 : CoinPaymentReq;
    requirement req002 : ProductDisplayReq;
    requirement req003 : ProductSelectionReq;
    // req004, req007 subset req012 below (per MBSE-3: REQ-004 derives from
    // REQ-012, REQ-007 satisfies REQ-012) — see note there for why.
    requirement req005 : ChangeReturnReq;
    requirement req006 : OutOfStockPreventionReq;
    requirement req008 : CoinSlotInterfaceReq;
    requirement req009 : DisplayInterfaceReq;
    requirement req010 : DispenseLatencyReq;
    requirement req011 : InventoryCapacityReq;
    requirement req012 : NoUnpaidDispensingReq;
    requirement req013 : BalancePersistenceReq;

    // ---------------------------------------------------------------
    // req004, req007 — modeled via subsetting (`:>`), not a `derive`/
    // `derived` relationship keyword. No such standalone keyword exists
    // in this grammar (confirmed after 7 failed attempts — see
    // MBSE-4-prompting-notes.md); requirement derivation is modeled as
    // usage subsetting instead. This also matches modern SysML v2
    // guidance that specialization/subsetting is the preferred way to
    // express requirement derivation (superseding SysML v1's deriveReqt).
    // A more specific requirement (req004/req007) subsets the general
    // constraint it narrows (req012) — same construct as `part engine1[1]
    // :> engines`, just applied to requirement usages.
    //
    // req007 is re-modeled from the source doc's "REQ-007 satisfies
    // REQ-012": `satisfy`'s `by` target must conform to a part type, and
    // req007 is itself a requirement, so subsetting is the right relation
    // here too, not `satisfy`.
    // ---------------------------------------------------------------

    requirement req004 : ProductDispensingReq :> req012;         // REQ-004 derives from REQ-012
    requirement req007 : DispenseFailureRecoveryReq :> req012;   // REQ-007 (re-modeled from "satisfies") derives from REQ-012

    // Traceability — functional requirements satisfied by parts
    // ---------------------------------------------------------------

    satisfy req001 by bvm.coinAcceptor;
    satisfy req002 by bvm.display;
    satisfy req003 by bvm.controlUnit;
    satisfy req004 by bvm.dispenser;
    satisfy req005 by bvm.changeMechanism;
    satisfy req006 by bvm.controlUnit;
    satisfy req007 by bvm.dispenser;
    satisfy req008 by bvm.coinAcceptor;
    satisfy req009 by bvm.display;
    satisfy req010 by bvm.dispenser;
    satisfy req011 by bvm.controlUnit;
    satisfy req012 by bvm.dispenser;
    satisfy req013 by bvm.controlUnit;

    // ---------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------

    // No view block here for the Requirements Table View: unlike General/
    // Interconnection/State Transition View, it has no corresponding type
    // in StandardViewDefinitions (confirmed by inspecting the library
    // directly — only GeneralView, InterconnectionView, ActionFlowView,
    // StateTransitionView, SequenceView, GeometryView, GridView, and
    // BrowserView exist). It's a SysON-specific table representation with
    // no textual/expose equivalent found so far. See MBSE-8-syson-notes.md.

}
