# SysML v2 Preview demo

Open this file's preview (`Ctrl+Shift+V` / `Cmd+Shift+V`) with the extension's
"Run Extension" launch config active to see the fenced block below render as
a diagram instead of plain text.

```sysml-v2
sysml-v2
part def Vehicle {
  attribute mass : Real;
}

part def Wheel {
  port hub: WheelHubIF;
}

port def WheelHubIF {
  in appliedTorque : Real;
}

part def AxleAssembly {
  part frontAxle : Vehicle;
  part wheel1 : Wheel;
  part wheel2 : Wheel;
}
```

A second block, to confirm multiple diagrams on one page each render
independently:

```sysml-v2
sysml-v2
action def Focus { in item scene; out item image; }
action def Shoot { in item image; out item picture; }

action takePicture {
  first start;
  then action focus : Focus;
  then action shoot : Shoot;
  then done;
}
```
