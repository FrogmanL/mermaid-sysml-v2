import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSysml } from '../src/parser/parser.js';

const vehicleSource = readFileSync(join(process.cwd(), 'examples/vehicle.mmd'), 'utf-8');

describe('parseSysml', () => {
  it('parses the package name and strips the sysml-v2 header', () => {
    const model = parseSysml(vehicleSource);
    expect(model.packageName).toBe('VehicleDefinitions');
  });

  it('captures the package-level doc comment', () => {
    const model = parseSysml(vehicleSource);
    expect(model.doc).toContain('Example vehicle definitions model');
  });

  it('parses every part def, port def, and interface def in the vehicle example', () => {
    const model = parseSysml(vehicleSource);
    const names = model.definitions.map((d) => d.name);
    expect(names).toEqual([
      'Vehicle',
      'Transmission',
      'AxleAssembly',
      'Axle',
      'Wheel',
      'Lugbolt',
      'DriveIF',
      'AxleMountIF',
      'WheelHubIF',
      'Mounting',
    ]);
  });

  it('parses a part def attribute with a :> type reference', () => {
    const model = parseSysml(vehicleSource);
    const vehicle = model.definitions.find((d) => d.name === 'Vehicle');
    expect(vehicle?.kind).toBe('partDef');
    if (vehicle?.kind !== 'partDef') throw new Error('expected partDef');
    expect(vehicle.attributes).toEqual([{ name: 'mass', type: 'ISQ::mass', value: undefined }]);
  });

  it('parses ports on a part def', () => {
    const model = parseSysml(vehicleSource);
    const axle = model.definitions.find((d) => d.name === 'Axle');
    if (axle?.kind !== 'partDef') throw new Error('expected partDef');
    expect(axle.ports).toEqual([
      { name: 'leftMountingPoint', type: 'AxleMountIF' },
      { name: 'rightMountingPoint', type: 'AxleMountIF' },
    ]);
  });

  it('parses a part def with no body (semicolon-terminated)', () => {
    const model = parseSysml(vehicleSource);
    const transmission = model.definitions.find((d) => d.name === 'Transmission');
    if (transmission?.kind !== 'partDef') throw new Error('expected partDef');
    expect(transmission.attributes).toEqual([]);
    expect(transmission.ports).toEqual([]);
  });

  it('parses port def fields with direction and type', () => {
    const model = parseSysml(vehicleSource);
    const axleMountIF = model.definitions.find((d) => d.name === 'AxleMountIF');
    if (axleMountIF?.kind !== 'portDef') throw new Error('expected portDef');
    expect(axleMountIF.fields).toEqual([
      { direction: 'out', name: 'transferredTorque', type: 'ISQ::torque' },
    ]);
  });

  it('parses interface def ends, doc, and flows', () => {
    const model = parseSysml(vehicleSource);
    const mounting = model.definitions.find((d) => d.name === 'Mounting');
    if (mounting?.kind !== 'interfaceDef') throw new Error('expected interfaceDef');
    expect(mounting.doc).toContain('mounting a Wheel to an Axle');
    expect(mounting.ends).toEqual([
      { name: 'axleMount', type: 'AxleMountIF' },
      { name: 'hub', type: 'WheelHubIF' },
    ]);
    expect(mounting.flows).toEqual([
      { from: 'axleMount.transferredTorque', to: 'hub.appliedTorque' },
    ]);
  });

  it('parses attribute value expressions after =', () => {
    const model = parseSysml(`sysml-v2
part def Vehicle {
  attribute mass = engine.mass+transmission.mass;
}`);
    const vehicle = model.definitions[0];
    if (vehicle.kind !== 'partDef') throw new Error('expected partDef');
    expect(vehicle.attributes[0].value).toBe('engine.mass + transmission.mass');
  });

  it('handles a bare definition list with no wrapping package', () => {
    const model = parseSysml(`sysml-v2
part def Foo {
  port p: Bar;
}
port def Bar {
  in x :> ISQ::torque;
}`);
    expect(model.packageName).toBeUndefined();
    expect(model.definitions.map((d) => d.name)).toEqual(['Foo', 'Bar']);
  });

  it('does not throw on unsupported SysML v2 constructs (part usages, actions), skipping them', () => {
    const model = parseSysml(`sysml-v2
part def Vehicle {
  attribute mass :> ISQ::mass;
  perform providePower;
  part engine : Engine;
}
action providePower {
  action generateTorque;
}`);
    const vehicle = model.definitions.find((d) => d.name === 'Vehicle');
    if (vehicle?.kind !== 'partDef') throw new Error('expected partDef');
    expect(vehicle.attributes).toEqual([{ name: 'mass', type: 'ISQ::mass', value: undefined }]);
  });
});
