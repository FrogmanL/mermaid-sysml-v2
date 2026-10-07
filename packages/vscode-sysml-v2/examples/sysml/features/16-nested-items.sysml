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
            port :>> hdmiOut {
                out item :>> video {
                    item param1 :> parameter;
                    item param2 :> parameter;
                    item param3 :> parameter;
                }
            }
        }
        part capture  : VideoCapture {
            port :>> usbOut {
                out item :>> data {
                    item header :> videoFrame { item header_param1 :> parameter; }
                    item frame1 :> videoFrame { item param1 :> parameter; item param2 :> parameter; item param3 :> parameter; }
                }
            }
        }
        part computer : Computer;

        flow from dvd.hdmiOut.video  to capture.hdmiIn.video;
        flow from capture.usbOut.data to computer.usbIn.data;

        // USB repacks the HDMI parameters: each frame1 parameter depends on its HDMI counterpart.
        dependency from capture::usbOut::data::frame1::param1 to dvd::hdmiOut::video::param1;
        dependency from capture::usbOut::data::frame1::param2 to dvd::hdmiOut::video::param2;
        dependency from capture::usbOut::data::frame1::param3 to dvd::hdmiOut::video::param3;
    }
}