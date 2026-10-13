// Nested port payload, convention B: "payload bound to port".
//
// Same system as 16-nested-items-in-port.sysml. There, each port's payload item
// is nested *inside* the port, so its nested data structure can't be drawn
// without rendering it inside the port symbol. Here the payload is instead an
// item usage declared alongside the port and tied to it with a binding
// connector (`bind video = hdmiOut.video`). The binding asserts the external
// item *is* the port's payload, so the two files model the same thing — but the
// externalized item renders as its own box, nested structure and all.
//
package SubSystemDefinitions { part def Subsystem; }
package DataElements {
    private import ScalarValues::*;
    item def ParameterDef {
        attribute bitOffset : Integer;
        attribute dataFormat : String;
        attribute size : Integer;
    }
    item def FrameDef      { item parameter : ParameterDef [1..*]; }
    item def HDMIMessage   { item parameter : ParameterDef [1..*]; }
    item def USBMessage    { item videoFrame : FrameDef [1..*]; }
}
package PortDefinitions {
    private import DataElements::*;
    // Payload stays in the port def (same as convention A) so there is a feature
    // to bind to — `hdmiOut.video` / `usbOut.data` must resolve.
    port def HDMI { out item video : HDMIMessage; }
    port def USB  { out item data  : USBMessage; }
}
package VideoCaptureSystem {
    private import PortDefinitions::*;
    private import DataElements::*;
    private import SubSystemDefinitions::*;

    part def DVDPlayer :> Subsystem   { port hdmiOut : HDMI; }
    part def VideoCapture :> Subsystem { port hdmiIn : ~HDMI;  port usbOut : USB; }
    part def Computer :> Subsystem    { port usbIn : ~USB; }

    part def VideoSystem {
        part dvd      : DVDPlayer {
            item video : HDMIMessage {
                item param1 :> parameter;
                item param2 :> parameter;
                item param3 :> parameter;
            }
            bind video = hdmiOut.video;
        }
        part capture  : VideoCapture {
            item data : USBMessage {
                item header :> videoFrame { item header_param1 :> parameter; }
                item frame1 :> videoFrame { item param1 :> parameter; item param2 :> parameter; item param3 :> parameter; }
            }
            bind data = usbOut.data;
        }
        part computer : Computer;

        flow from dvd.hdmiOut.video  to capture.hdmiIn.video;
        flow from capture.usbOut.data to computer.usbIn.data;

        // USB repacks the HDMI parameters: each frame1 parameter depends on its HDMI counterpart.
        // These stay as `dependency` — they are genuine traceability between payload
        // fields across the repacking, not the item-to-port tether.
        dependency from capture::data::frame1::param1 to dvd::video::param1;
        dependency from capture::data::frame1::param2 to dvd::video::param2;
        dependency from capture::data::frame1::param3 to dvd::video::param3;
    }
}
