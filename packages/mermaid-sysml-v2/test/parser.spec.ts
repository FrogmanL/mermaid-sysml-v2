import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSysml } from '../src/parser/parser.js';

const vehicleSource = readFileSync(join(process.cwd(), 'examples/vehicle.mmd'), 'utf-8');
const bvmSource = readFileSync(join(process.cwd(), 'examples/bvm.mmd'), 'utf-8');

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
    expect(vehicle.attributes).toEqual([
      { name: 'mass', type: 'ISQ::mass', typeKind: ':>', value: undefined },
    ]);
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
      { direction: 'out', name: 'transferredTorque', type: 'ISQ::torque', typeKind: ':>' },
    ]);
  });

  it('parses `out attribute name : Type` port def fields (valid per the Pilot Implementation)', () => {
    const model = parseSysml('port def CoinPort { out attribute coin : Real; in attribute x : String; }');
    const def = model.definitions[0];
    if (def?.kind !== 'portDef') throw new Error('expected portDef');
    expect(def.fields).toEqual([
      { direction: 'out', name: 'coin', type: 'Real', typeKind: undefined },
      { direction: 'in', name: 'x', type: 'String', typeKind: undefined },
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
      { ends: ['axleMount.transferredTorque', 'hub.appliedTorque'] },
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

  it('does not throw on unsupported SysML v2 constructs (perform, actions), skipping them', () => {
    const model = parseSysml(`sysml-v2
part def Vehicle {
  attribute mass :> ISQ::mass;
  perform providePower;
}
action providePower {
  action generateTorque;
}`);
    const vehicle = model.definitions.find((d) => d.name === 'Vehicle');
    if (vehicle?.kind !== 'partDef') throw new Error('expected partDef');
    expect(vehicle.attributes).toEqual([
      { name: 'mass', type: 'ISQ::mass', typeKind: ':>', value: undefined },
    ]);
  });

  // Regression: skipUnknownMember used to keep consuming tokens after closing
  // its own brace on a construct like `attribute def X { ... }` (unsupported
  // at the time), since only a top-level `;` or an unmatched `}` told it to
  // stop — so it swallowed every sibling member up to the next unrelated
  // `}`. Caught against the real BVM model, where this silently ate three
  // `port def`s hiding behind one preceding `attribute def`. `attribute def`
  // and `action def` are both supported now (see below), so this uses
  // `state def` — still genuinely out of scope — to keep exercising the
  // same skip-recovery path.
  it('stops skipping right after a braced-but-unsupported construct closes, not at the next unrelated brace', () => {
    const model = parseSysml(`sysml-v2
package X {
  state def DoSomething {
    state step1;
  }
  port def CoinPort {
    out item coin : Real;
  }
}`);
    expect(model.definitions.map((d) => d.name)).toEqual(['CoinPort']);
  });

  it('parses an attribute type introduced by plain : as well as :>, including alongside a value', () => {
    const model = parseSysml(`sysml-v2
part def ControlUnit {
  attribute balance : Real;
  attribute lineCount : Integer = 2;
}`);
    const def = model.definitions[0];
    if (def.kind !== 'partDef') throw new Error('expected partDef');
    expect(def.attributes).toEqual([
      { name: 'balance', type: 'Real', value: undefined },
      { name: 'lineCount', type: 'Integer', value: '2' },
    ]);
  });

  it('skips an optional item/ref modifier keyword between a port field direction and its name', () => {
    const model = parseSysml(`sysml-v2
port def CoinPort {
  out item coin : Real;
}
port def EntryWay {
  in ref student : Student;
}`);
    const coinPort = model.definitions.find((d) => d.name === 'CoinPort');
    const entryWay = model.definitions.find((d) => d.name === 'EntryWay');
    if (coinPort?.kind !== 'portDef' || entryWay?.kind !== 'portDef') {
      throw new Error('expected portDef');
    }
    expect(coinPort.fields).toEqual([{ direction: 'out', name: 'coin', type: 'Real' }]);
    expect(entryWay.fields).toEqual([{ direction: 'in', name: 'student', type: 'Student' }]);
  });

  it('parses a conjugated port type (~Type)', () => {
    const model = parseSysml(`sysml-v2
part def Hallway {
  port exitToClassroom : ~EntryWay;
}`);
    const def = model.definitions[0];
    if (def.kind !== 'partDef') throw new Error('expected partDef');
    expect(def.ports).toEqual([{ name: 'exitToClassroom', type: '~EntryWay' }]);
  });

  it('parses nested part containment and connect statements', () => {
    const model = parseSysml(`sysml-v2
part def BVM {
  part coinAcceptor : CoinAcceptor;
  part controlUnit : ControlUnit;
  connect coinAcceptor.coinOut to controlUnit.coinIn;
}`);
    const def = model.definitions[0];
    if (def.kind !== 'partDef') throw new Error('expected partDef');
    expect(def.parts).toEqual([
      { name: 'coinAcceptor', type: 'CoinAcceptor', multiplicity: undefined },
      { name: 'controlUnit', type: 'ControlUnit', multiplicity: undefined },
    ]);
    expect(def.connectors).toEqual([{ ends: ['coinAcceptor.coinOut', 'controlUnit.coinIn'] }]);
  });

  it('parses a part usage multiplicity in either order relative to its type', () => {
    const model = parseSysml(`sysml-v2
part def ControlUnit {
  part inventory : Product [8];
}
part def Family {
  part adult[*] : Person;
}`);
    const controlUnit = model.definitions.find((d) => d.name === 'ControlUnit');
    const family = model.definitions.find((d) => d.name === 'Family');
    if (controlUnit?.kind !== 'partDef' || family?.kind !== 'partDef') {
      throw new Error('expected partDef');
    }
    expect(controlUnit.parts).toEqual([{ name: 'inventory', type: 'Product', multiplicity: '8' }]);
    expect(family.parts).toEqual([{ name: 'adult', type: 'Person', multiplicity: '*' }]);
  });

  it('parses a named flow with an explicit from keyword the same as a bare connect', () => {
    const model = parseSysml(`sysml-v2
part def RoomContext {
  part h : Hallway;
  part c : Classroom;
  flow HallToClass_Air from h.exit.air to c.entry.air;
}`);
    const def = model.definitions[0];
    if (def.kind !== 'partDef') throw new Error('expected partDef');
    expect(def.connectors).toEqual([
      { name: 'HallToClass_Air', ends: ['h.exit.air', 'c.entry.air'] },
    ]);
  });

  it('flattens arbitrarily nested packages into one definitions list, using the first package name seen', () => {
    const model = parseSysml(`sysml-v2
package Outer {
  package Middle {
    package Inner {
      part def Leaf;
    }
  }
  port def TopPort;
}`);
    expect(model.packageName).toBe('Outer');
    expect(model.definitions.map((d) => d.name)).toEqual(['Leaf', 'TopPort']);
  });

  it('renders a bare top-level part usage with a body, but not a body-less instantiation reference', () => {
    const model = parseSysml(`sysml-v2
package RoomModel {
  part def Classroom;
  part roomContext {
    part c : Classroom;
  }
  part bvm : BVM;
}`);
    expect(model.definitions.map((d) => d.name)).toEqual(['Classroom', 'roomContext']);
    const roomContext = model.definitions.find((d) => d.name === 'roomContext');
    if (roomContext?.kind !== 'partDef') throw new Error('expected partDef');
    expect(roomContext.parts).toEqual([{ name: 'c', type: 'Classroom', multiplicity: undefined }]);
  });

  it('recovers cleanly from an unnamed part usage (redefinition form), without corrupting later members', () => {
    const model = parseSysml(`sysml-v2
part def Family {
  part :>> socialService;
  part woman : Person;
}`);
    const def = model.definitions[0];
    if (def.kind !== 'partDef') throw new Error('expected partDef');
    expect(def.parts).toEqual([{ name: 'woman', type: 'Person', multiplicity: undefined }]);
  });

  it('parses the real BVM model end to end: containment, connectors, and port defs after a preceding attribute def', () => {
    const model = parseSysml(bvmSource);
    const bvm = model.definitions.find((d) => d.name === 'BVM');
    if (bvm?.kind !== 'partDef') throw new Error('expected partDef');
    expect(bvm.parts.map((p) => p.name)).toEqual([
      'coinAcceptor',
      'display',
      'controlUnit',
      'dispenser',
      'changeMechanism',
    ]);
    expect(bvm.connectors).toHaveLength(4);
    expect(model.definitions.map((d) => d.name)).toContain('CoinPort');
    expect(model.definitions.map((d) => d.name)).toContain('DisplayPort');
    expect(model.definitions.map((d) => d.name)).toContain('DispensePort');
  });

  // Regression: found while reviewing the OMG's own graphical-notation deck
  // (page 26/34, "Specialization") against the GfSE VehicleModel.sysml file,
  // which has `part def FrontAxle :> Axle { ... }`. The old code only
  // checked plain `:` for a definition's supertype, not `:>` — so it left
  // the parser mid-statement, corrupting FrontAxle into an empty def and
  // losing its body to the outer skip-recovery logic.
  it('parses `part def X :> Y` specialization without losing the body or a following sibling', () => {
    const model = parseSysml(`sysml-v2
part def Axle {
  attribute mass;
}
part def FrontAxle :> Axle {
  attribute steeringAngle;
}
part def RearAxle;`);
    const frontAxle = model.definitions.find((d) => d.name === 'FrontAxle');
    if (frontAxle?.kind !== 'partDef') throw new Error('expected partDef');
    expect(frontAxle.superType).toBe('Axle');
    expect(frontAxle.attributes.map((a) => a.name)).toEqual(['steeringAngle']);
    expect(model.definitions.map((d) => d.name)).toEqual(['Axle', 'FrontAxle', 'RearAxle']);
  });

  it('parses `:>` on a port def / interface def as specialization too, not just part def', () => {
    const model = parseSysml(`sysml-v2
port def BasePort;
port def SubPort :> BasePort;
interface def BaseIF;
interface def SubIF :> BaseIF;`);
    const subPort = model.definitions.find((d) => d.name === 'SubPort');
    const subIF = model.definitions.find((d) => d.name === 'SubIF');
    if (subPort?.kind !== 'portDef') throw new Error('expected portDef');
    if (subIF?.kind !== 'interfaceDef') throw new Error('expected interfaceDef');
    expect(subPort.superType).toBe('BasePort');
    expect(subIF.superType).toBe('BaseIF');
  });

  // Regression: `:>>` (redefines) mis-lexed exactly like `::>` used to — the
  // lexer only recognized `:>` (2 chars), so the trailing `>` fell through
  // to "unknown char, skip" and vanished before the parser ever saw it.
  // Confirmed by checking the local end name is fully discarded and only the
  // redefined-to path survives, which wouldn't be distinguishable from a
  // mis-lexed `:>` if the third character had been silently dropped.
  it('tokenizes and parses :>> (redefines) as its own relation, distinct from :>', () => {
    const model = parseSysml(`sysml-v2
part def Family {
  part adultMember : Person;
  part socialService :>> adultMember;
}
part def Person;`);
    const def = model.definitions[0];
    if (def.kind !== 'partDef') throw new Error('expected partDef');
    expect(def.parts).toEqual([
      { name: 'adultMember', type: 'Person', multiplicity: undefined },
      { name: 'socialService', type: 'adultMember', typeKind: ':>>', multiplicity: undefined },
    ]);
  });

  it('accepts the subsets/redefines keyword forms as equivalent to :>/:>> shorthand', () => {
    const model = parseSysml(`sysml-v2
part def Family {
  part base : Person;
  part viaSubsets subsets base;
  part viaRedefines redefines base;
}
part def Person;`);
    const def = model.definitions[0];
    if (def.kind !== 'partDef') throw new Error('expected partDef');
    const bySubsets = def.parts.find((p) => p.name === 'viaSubsets');
    const byRedefines = def.parts.find((p) => p.name === 'viaRedefines');
    expect(bySubsets).toEqual({ name: 'viaSubsets', type: 'base', typeKind: ':>', multiplicity: undefined });
    expect(byRedefines).toEqual({
      name: 'viaRedefines',
      type: 'base',
      typeKind: ':>>',
      multiplicity: undefined,
    });
  });

  it('marks a part def as not a usage, and a bare top-level part usage as one, with its type captured separately', () => {
    const model = parseSysml(`sysml-v2
part def Classroom;
part roomContext {
  part c : Classroom;
}
part drone : Drone {
  attribute totalMass = 750;
}`);
    const classroom = model.definitions.find((d) => d.name === 'Classroom');
    const roomContext = model.definitions.find((d) => d.name === 'roomContext');
    const drone = model.definitions.find((d) => d.name === 'drone');
    if (classroom?.kind !== 'partDef' || roomContext?.kind !== 'partDef' || drone?.kind !== 'partDef') {
      throw new Error('expected partDef');
    }
    expect(classroom.isUsage).toBeUndefined();
    expect(roomContext.isUsage).toBe(true);
    expect(roomContext.usageType).toBeUndefined();
    expect(drone.isUsage).toBe(true);
    expect(drone.usageType).toBe('Drone');
  });

  it('resolves a ::>-bound connector end to just the bound-to path, on both ends', () => {
    const model = parseSysml(`sysml-v2
part def Family {
  connect communicationPartnerA ::> woman.verbalExchange to communicationPartnerB ::> man.verbalExchange;
}`);
    const def = model.definitions[0];
    if (def.kind !== 'partDef') throw new Error('expected partDef');
    expect(def.connectors).toEqual([
      { ends: ['woman.verbalExchange', 'man.verbalExchange'] },
    ]);
  });

  it('parses an n-ary connect() with ::>-bound ends', () => {
    const model = parseSysml(`sysml-v2
part def Family {
  connect (parent1 ::> woman, adoptiveParent_1 ::> adult, certifiedChild ::> child);
}`);
    const def = model.definitions[0];
    if (def.kind !== 'partDef') throw new Error('expected partDef');
    expect(def.connectors).toEqual([{ ends: ['woman', 'adult', 'child'] }]);
  });

  it('folds a connection usage\'s redefined ends into one connector on the enclosing part', () => {
    const model = parseSysml(`sysml-v2
part def Family {
  part woman : Person;
  part man : Person;
  connection child : Child {
    end mother ::> woman[1];
    end father ::> man[1];
  }
}
part def Person;`);
    const def = model.definitions[0];
    if (def.kind !== 'partDef') throw new Error('expected partDef');
    expect(def.connectors).toEqual([{ name: 'child', ends: ['woman', 'man'] }]);
  });

  it('folds a nested connection usage inside another connection usage', () => {
    const model = parseSysml(`sysml-v2
part def Family {
  connection outer {
    connection inner : Child {
      end mother ::> woman;
      end father ::> man;
    }
  }
}`);
    const def = model.definitions[0];
    if (def.kind !== 'partDef') throw new Error('expected partDef');
    expect(def.connectors).toEqual([{ name: 'inner', ends: ['woman', 'man'] }]);
  });

  it('discards a top-level connection usage (no enclosing part to draw it against) without crashing', () => {
    const model = parseSysml(`sysml-v2
connection child : Child {
  end mother ::> woman;
  end father ::> man;
}
part def Person;`);
    expect(model.definitions.map((d) => d.name)).toEqual(['Person']);
  });

  it('parses a connection def with named ends and attributes, like interface def but part-to-part', () => {
    const model = parseSysml(`sysml-v2
connection def DeviceConn {
  end part hub : Hub;
  end part device : Device;
  attribute bandwidth : Real;
}
part def Hub;
part def Device;`);
    const conn = model.definitions.find((d) => d.name === 'DeviceConn');
    if (conn?.kind !== 'connectionDef') throw new Error('expected connectionDef');
    expect(conn.ends).toEqual([
      { name: 'hub', type: 'Hub' },
      { name: 'device', type: 'Device' },
    ]);
    expect(conn.attributes).toEqual([{ name: 'bandwidth', type: 'Real', value: undefined }]);
  });

  it('does not throw on the full family.sysml connector idioms mixed with unsupported ones', () => {
    // A trimmed excerpt of GfSE/SysML-v2-Models' family.sysml, combining
    // ::>-bound binary connects, a connection usage with redefined ends, and
    // an n-ary connect inside a variant — the last of which (variation
    // modeling) stays out of scope and should just be skipped structurally.
    expect(() =>
      parseSysml(`sysml-v2
package Family {
  part woman[1] : Person;
  part man[1] : Person;
  connection child : Child {
    end mother ::> woman[1];
    end father ::> man[1];
  }
  interface verbalAdultCommunicationActionWoman : VerbalCommunication
    connect communicationPartnerA ::> woman.verbalExchange to communicationPartnerB ::> man.verbalExchange;
  variation part adoption_certificate : Adoption_Certificate {
    variant connection adoption_certificate_TypeC : Adoption_Certificate
      connect (parent1 ::> woman, parent2 ::> man, certifiedChild ::> child);
  }
}
part def Person;`)
    ).not.toThrow();
  });

  it('parses a requirement def with doc and subject', () => {
    const model = parseSysml(`sysml-v2
requirement def CoinPaymentReq {
  doc /* REQ-001 — Coin Payment
       * The BVM shall accept coins as a form of payment. */
  subject sys001 : CoinAcceptor;
}`);
    const def = model.definitions[0];
    if (def.kind !== 'requirementDef') throw new Error('expected requirementDef');
    expect(def.isUsage).toBeUndefined();
    expect(def.doc).toContain('Coin Payment');
    expect(def.subject).toEqual({ name: 'sys001', type: 'CoinAcceptor' });
  });

  it('keeps a bare body-less requirement usage (unlike a part usage, which is discarded)', () => {
    const model = parseSysml(`sysml-v2
requirement def CoinPaymentReq;
requirement req001 : CoinPaymentReq;`);
    expect(model.definitions.map((d) => d.name)).toEqual(['CoinPaymentReq', 'req001']);
    const req001 = model.definitions.find((d) => d.name === 'req001');
    if (req001?.kind !== 'requirementDef') throw new Error('expected requirementDef');
    expect(req001.isUsage).toBe(true);
    expect(req001.usageType).toBe('CoinPaymentReq');
  });

  // Regression: found against examples/bvm.mmd's own
  // `requirement req004 : ProductDispensingReq :> req012;` — SysML v2 has no
  // standalone `deriveReqt` keyword, so derivation is modeled as ordinary
  // usage subsetting. This combines a `:` type AND a `:>` relation on the
  // SAME usage, which is exactly the combo the generic part-usage
  // `type`/`typeKind` fields can't hold at once — requirement usages keep
  // them as two separate fields (`usageType`/`derivedFrom`) specifically so
  // this doesn't lose one or the other.
  it('parses a requirement usage combining an instantiated type (:) and a derivation target (:>)', () => {
    const model = parseSysml(`sysml-v2
requirement req012 : NoUnpaidDispensingReq;
requirement req004 : ProductDispensingReq :> req012;`);
    const req004 = model.definitions.find((d) => d.name === 'req004');
    if (req004?.kind !== 'requirementDef') throw new Error('expected requirementDef');
    expect(req004.usageType).toBe('ProductDispensingReq');
    expect(req004.derivedFrom).toBe('req012');
  });

  it('parses a top-level satisfy statement', () => {
    const model = parseSysml(`sysml-v2
requirement req001 : CoinPaymentReq;
satisfy req001 by bvm.coinAcceptor;`);
    expect(model.traceability).toEqual([{ kind: 'satisfy', source: 'req001', target: 'bvm.coinAcceptor' }]);
  });

  it('parses verify/trace/allocate with the same shape as satisfy', () => {
    const model = parseSysml(`sysml-v2
verify req001 by testCase1;
trace req001 to designDoc;
allocate softwareModule to controlUnit;`);
    expect(model.traceability).toEqual([
      { kind: 'verify', source: 'req001', target: 'testCase1' },
      { kind: 'trace', source: 'req001', target: 'designDoc' },
      { kind: 'allocate', source: 'softwareModule', target: 'controlUnit' },
    ]);
  });

  it('parses the real BVM requirements package end to end: defs, usages, derivation, and satisfy', () => {
    const model = parseSysml(bvmSource);
    const names = model.definitions.map((d) => d.name);
    expect(names).toContain('CoinPaymentReq');
    expect(names).toContain('req001');
    expect(names).toContain('req004');

    const req004 = model.definitions.find((d) => d.name === 'req004');
    if (req004?.kind !== 'requirementDef') throw new Error('expected requirementDef');
    expect(req004.usageType).toBe('ProductDispensingReq');
    expect(req004.derivedFrom).toBe('req012');

    expect(model.traceability).toHaveLength(13);
    expect(model.traceability[0]).toEqual({ kind: 'satisfy', source: 'req001', target: 'bvm.coinAcceptor' });
  });

  it('parses an attribute def with its own attribute members', () => {
    const model = parseSysml(`sysml-v2
attribute def Product {
  attribute id : String;
  attribute price : Real;
  attribute quantity : Integer;
}`);
    const def = model.definitions[0];
    if (def?.kind !== 'attributeDef') throw new Error('expected attributeDef');
    expect(def.name).toBe('Product');
    expect(def.attributes).toEqual([
      { name: 'id', type: 'String', value: undefined },
      { name: 'price', type: 'Real', value: undefined },
      { name: 'quantity', type: 'Integer', value: undefined },
    ]);
  });

  it('parses an enum def with its enumerated values', () => {
    const model = parseSysml(`sysml-v2
enum def DispenseResult {
  enum success;
  enum failure;
}`);
    const def = model.definitions[0];
    if (def?.kind !== 'enumDef') throw new Error('expected enumDef');
    expect(def.name).toBe('DispenseResult');
    expect(def.values).toEqual(['success', 'failure']);
  });

  it('parses attribute def / enum def specialization (:>) the same way as other definition kinds', () => {
    const model = parseSysml(`sysml-v2
attribute def Base;
attribute def Derived :> Base;
enum def BaseEnum;
enum def DerivedEnum :> BaseEnum;`);
    const derived = model.definitions.find((d) => d.name === 'Derived');
    const derivedEnum = model.definitions.find((d) => d.name === 'DerivedEnum');
    if (derived?.kind !== 'attributeDef') throw new Error('expected attributeDef');
    if (derivedEnum?.kind !== 'enumDef') throw new Error('expected enumDef');
    expect(derived.superType).toBe('Base');
    expect(derivedEnum.superType).toBe('BaseEnum');
  });

  // Regression: `attribute`'s member check inside a part body had no `def`
  // guard (unlike `port`/`part`/`connection`, which all check
  // `p.peek(1).value !== 'def'`) — so a nested `attribute def` would have
  // been misread as a plain attribute literally named "def", corrupting the
  // rest of the body. Fixed alongside adding top-level `attribute def`
  // support, since both now sit in the same neighborhood of the parser.
  it('does not corrupt a part body when an (unsupported, nested) attribute def appears inside it', () => {
    const model = parseSysml(`sysml-v2
part def Vehicle {
  attribute def Nested {
    attribute x : Real;
  }
  attribute mass : Real;
}`);
    const vehicle = model.definitions.find((d) => d.name === 'Vehicle');
    if (vehicle?.kind !== 'partDef') throw new Error('expected partDef');
    expect(vehicle.attributes).toEqual([{ name: 'mass', type: 'Real', value: undefined }]);
  });

  it('parses the real BVM Product/DispenseResult defs, referenced elsewhere in the same file', () => {
    const model = parseSysml(bvmSource);
    const product = model.definitions.find((d) => d.name === 'Product');
    const dispenseResult = model.definitions.find((d) => d.name === 'DispenseResult');
    if (product?.kind !== 'attributeDef') throw new Error('expected attributeDef');
    if (dispenseResult?.kind !== 'enumDef') throw new Error('expected enumDef');
    expect(product.attributes.map((a) => a.name)).toEqual(['id', 'price', 'quantity']);
    expect(dispenseResult.values).toEqual(['success', 'failure']);

    const controlUnit = model.definitions.find((d) => d.name === 'ControlUnit');
    if (controlUnit?.kind !== 'partDef') throw new Error('expected partDef');
    // `inventory` is an attribute typed by the attribute def Product (a part may not be typed by an attribute def in SysML v2).
    expect(controlUnit.attributes.find((a) => a.name === 'inventory')?.type).toBe('Product');
  });

  it('parses a bare item def, same shape as attribute def (Messaging Example)', () => {
    const model = parseSysml(`sysml-v2
item def Scene;
item def Image;
item def Picture;`);
    expect(model.definitions.map((d) => d.name)).toEqual(['Scene', 'Image', 'Picture']);
    for (const def of model.definitions) {
      expect(def.kind).toBe('itemDef');
    }
  });

  it('parses an item def with attribute members and specialization (:>)', () => {
    const model = parseSysml(`sysml-v2
item def Base;
item def Derived :> Base {
  attribute id : String;
}`);
    const derived = model.definitions.find((d) => d.name === 'Derived');
    if (derived?.kind !== 'itemDef') throw new Error('expected itemDef');
    expect(derived.superType).toBe('Base');
    expect(derived.attributes).toEqual([{ name: 'id', type: 'String', value: undefined }]);
  });

  // Regression: `attribute def`'s (and `item def`'s) body loop only
  // recognized `attribute` members, not a bare `item name : Type;` member —
  // confirmed a real gap against the OMG's own Messaging Example.sysml,
  // where `attribute def Show { item picture : Picture; }` silently lost
  // `picture` entirely (fell to the generic skip). Both keywords now
  // produce the same `AttributeNode` shape, shown in the same compartment.
  it('parses a bare `item name : Type;` member inside an attribute def, same as attribute', () => {
    const model = parseSysml(`sysml-v2
item def Picture;
attribute def Show {
  item picture : Picture;
}`);
    const show = model.definitions.find((d) => d.name === 'Show');
    if (show?.kind !== 'attributeDef') throw new Error('expected attributeDef');
    expect(show.attributes).toEqual([{ name: 'picture', type: 'Picture', value: undefined }]);
  });

  // `perform`/`references` grammar below is grounded against the OMG's own
  // training corpus: Systems-Modeling/SysML-v2-Release/sysml/src/training/
  // "18. Action Performance"/Action Performance Example.sysml. Parsed as
  // groundwork for a future multi-lifeline Sequence View — not rendered yet.

  it('parses `perform action <name> [mult] ordered references <path>;` as a new performed-action usage', () => {
    const model = parseSysml(`sysml-v2
part def Camera;
part camera : Camera {
  perform action takePhoto[*] ordered
      references takePicture;
}`);
    const camera = model.definitions.find((d) => d.name === 'camera');
    if (camera?.kind !== 'partDef') throw new Error('expected partDef');
    expect(camera.performs).toEqual([{ name: 'takePhoto', target: 'takePicture', ordered: true }]);
  });

  it('parses a bare `perform <path>;` as directly performing a sub-action of an already-declared one', () => {
    const model = parseSysml(`sysml-v2
part def AutoFocus;
part f : AutoFocus {
  perform takePhoto.focus;
}`);
    const f = model.definitions.find((d) => d.name === 'f');
    if (f?.kind !== 'partDef') throw new Error('expected partDef');
    expect(f.performs).toEqual([{ name: undefined, target: 'takePhoto.focus', ordered: undefined }]);
  });

  // The real example nests `f`/`i` one level inside `camera`'s body. A nested
  // part usage's own body sits outside this subset's containment depth (see
  // the "one level deep" limitation noted throughout this file and the
  // README), so their `perform` statements are skipped along with the rest
  // of that inline body — only `camera`'s own top-level `performs` survive.
  // This documents that existing, deliberate scope boundary rather than a
  // new bug.
  it('parses the full Action Performance Example: top-level performs captured, nested ones skipped (one level deep)', () => {
    const model = parseSysml(`sysml-v2
package 'Action Performance Example' {
    private import 'Action Decomposition'::*;
    part def Camera;
    part def AutoFocus;
    part def Imager;
    part camera : Camera {
        perform action takePhoto[*] ordered
            references takePicture;
        part f : AutoFocus {
            perform takePhoto.focus;
        }
        part i : Imager {
            perform takePhoto.shoot;
        }
    }
}`);
    const camera = model.definitions.find((d) => d.name === 'camera');
    if (camera?.kind !== 'partDef') throw new Error('expected partDef');
    expect(camera.performs).toEqual([{ name: 'takePhoto', target: 'takePicture', ordered: true }]);
    expect(camera.parts.map((p) => p.name)).toEqual(['f', 'i']);
  });

  // Sequence View grammar below is grounded against the OMG's own training
  // corpus (`"27. Occurrences"/Interaction Example-1.sysml`) and its own
  // `examples/Interaction Sequencing Examples/ServerSequenceModel.sysml` —
  // SysML v2's actual multi-participant `message ... from ... to ...;`
  // construct, the real basis for a Sequence View (see README).

  it('parses an occurrence def with ref parts, messages, and a first/then order chain (Interaction Example-1)', () => {
    const model = parseSysml(`sysml-v2
item def SetSpeed;
item def SensedSpeed;
item def FuelCommand;

occurrence def CruiseControlInteraction {
    ref part :>> driver;
    ref part :>> vehicle;

    message setSpeedMessage of SetSpeed
        from driver.setSpeedSent to vehicle.cruiseController.setSpeedReceived;

    message sensedSpeedMessage of SensedSpeed
        from vehicle.speedometer.sensedSpeedSent to vehicle.cruiseController.sensedSpeedReceived;

    message fuelCommandMessage of FuelCommand
        from vehicle.cruiseController.fuelCommandSent to vehicle.engine.fuelCommandReceived;

    first setSpeedMessage then sensedSpeedMessage;
}`);
    const occ = model.definitions.find((d) => d.name === 'CruiseControlInteraction');
    if (occ?.kind !== 'occurrenceDef') throw new Error('expected occurrenceDef');
    expect(occ.participants).toEqual(['driver', 'vehicle']);
    expect(occ.messages).toEqual([
      {
        name: 'setSpeedMessage',
        itemType: 'SetSpeed',
        from: 'driver.setSpeedSent',
        to: 'vehicle.cruiseController.setSpeedReceived',
      },
      {
        name: 'sensedSpeedMessage',
        itemType: 'SensedSpeed',
        from: 'vehicle.speedometer.sensedSpeedSent',
        to: 'vehicle.cruiseController.sensedSpeedReceived',
      },
      {
        name: 'fuelCommandMessage',
        itemType: 'FuelCommand',
        from: 'vehicle.cruiseController.fuelCommandSent',
        to: 'vehicle.engine.fuelCommandReceived',
      },
    ]);
    expect(occ.order).toEqual([['setSpeedMessage', 'sensedSpeedMessage']]);
  });

  it('parses `message ... from ... to ...;` directly inside a part def body, alongside nested parts (ServerSequenceModel)', () => {
    const model = parseSysml(`sysml-v2
part def PubSubSequence {
    part producer[1] {
        event occurrence publish_source_event;
    }

    message publish_message from producer.publish_source_event to server.publish_target_event;

    part server[1] {
        event occurrence subscribe_target_event;
        then event occurrence publish_target_event;
        then event occurrence deliver_source_event;
    }

    message subscribe_message from consumer.subscribe_source_event to server.subscribe_target_event;
    message deliver_message from server.deliver_source_event to consumer.deliver_target_event;

    part consumer {
        event occurrence subscribe_source_event;
        then event occurrence deliver_target_event;
    }
}`);
    const pubSub = model.definitions.find((d) => d.name === 'PubSubSequence');
    if (pubSub?.kind !== 'partDef') throw new Error('expected partDef');
    expect(pubSub.parts.map((p) => p.name)).toEqual(['producer', 'server', 'consumer']);
    expect(pubSub.messages).toEqual([
      { name: 'publish_message', itemType: undefined, from: 'producer.publish_source_event', to: 'server.publish_target_event' },
      { name: 'subscribe_message', itemType: undefined, from: 'consumer.subscribe_source_event', to: 'server.subscribe_target_event' },
      { name: 'deliver_message', itemType: undefined, from: 'server.deliver_source_event', to: 'consumer.deliver_target_event' },
    ]);
  });

  it('parses an anonymous `message of Type from ... to ...;` with bare (non-dotted) endpoints, per the graphical-notation deck\'s own Sequence View slide', () => {
    const model = parseSysml(`sysml-v2
action startVehicle1 {
    event occurrence doorClosed;
    event occurrence driverReady;
    first doorClosed then driverReady;

    message of VehicleStart from turnVehicleOn to trigger1;
    message of EngineStatus from sendStatus to trigger2;
}`);
    const action = model.definitions.find((d) => d.name === 'startVehicle1');
    if (action?.kind !== 'actionDef') throw new Error('expected actionDef');
    // `message` inside an *action* body (as opposed to a part def or
    // occurrence def) isn't captured today — this is out of scope for this
    // round (see README "Known limitations"): it would need to resolve
    // which enclosing part performs each named action to know the right
    // lifelines, not just the message statements themselves. This test
    // documents that the parser doesn't crash on it and skips it
    // resiliently, same as any other unrecognized member.
    expect((action as { messages?: unknown }).messages).toBeUndefined();
  });

  // Use case def/usage grammar below is grounded against the OMG's own
  // training corpus: Systems-Modeling/SysML-v2-Release/sysml/src/training/
  // "35. Use Cases"/{Use Case Definition Example, Use Case Usage Example}.sysml.

  it('parses a use case def with subject, actors, and an objective', () => {
    const model = parseSysml(`sysml-v2
use case def 'Provide Transportation' {
  subject vehicle : Vehicle;
  actor driver : Person;
  actor passengers : Person[0..4];
  objective {
    doc /* Transport driver and passengers from starting location to ending location. */
  }
}`);
    const def = model.definitions[0];
    if (def?.kind !== 'useCaseDef') throw new Error('expected useCaseDef');
    expect(def.isUsage).toBeUndefined();
    expect(def.subject).toEqual({ name: 'vehicle', type: 'Vehicle' });
    expect(def.actors).toEqual([
      { name: 'driver', type: 'Person', value: undefined },
      { name: 'passengers', type: 'Person', value: undefined },
    ]);
    expect(def.objective).toContain('Transport driver and passengers');
  });

  it('keeps a bare body-less use case usage (like a requirement usage, unlike a part usage)', () => {
    const model = parseSysml(`sysml-v2
use case def 'Provide Transportation';
use case 'provide transportation' : 'Provide Transportation';`);
    expect(model.definitions.map((d) => d.name)).toEqual([
      'Provide Transportation',
      'provide transportation',
    ]);
    const usage = model.definitions.find((d) => d.name === 'provide transportation');
    if (usage?.kind !== 'useCaseDef') throw new Error('expected useCaseDef');
    expect(usage.isUsage).toBe(true);
    expect(usage.usageType).toBe('Provide Transportation');
  });

  it('parses an actor redefined by reference (actor x = existingActor;) in a usage', () => {
    const model = parseSysml(`sysml-v2
use case 'enter vehicle' : 'Enter Vehicle' {
  subject vehicle;
  actor driver = 'provide transportation'::driver;
}`);
    const def = model.definitions[0];
    if (def?.kind !== 'useCaseDef') throw new Error('expected useCaseDef');
    expect(def.subject).toEqual({ name: 'vehicle', type: undefined });
    expect(def.actors).toEqual([{ name: 'driver', type: undefined, value: 'provide transportation::driver' }]);
  });

  it('parses the full `include use case name : Target { ... }` form as an include relationship', () => {
    const model = parseSysml(`sysml-v2
use case 'provide transportation' {
  then include use case 'enter vehicle' : 'Enter Vehicle' {
    subject vehicle;
  }
}`);
    expect(model.traceability).toEqual([
      { kind: 'include', source: 'provide transportation', target: 'Enter Vehicle' },
    ]);
  });

  it('parses the shorthand `include name[mult] { ... }` form, using the bare name as the target', () => {
    const model = parseSysml(`sysml-v2
use case 'drive vehicle' {
  include 'add fuel'[0..*] {
    subject vehicle;
  }
}`);
    expect(model.traceability).toEqual([{ kind: 'include', source: 'drive vehicle', target: 'add fuel' }]);
  });

  it('parses use case def specialization (:>) the same way as any other definition kind', () => {
    const model = parseSysml(`sysml-v2
use case def Base;
use case def Derived :> Base;`);
    const derived = model.definitions.find((d) => d.name === 'Derived');
    if (derived?.kind !== 'useCaseDef') throw new Error('expected useCaseDef');
    expect(derived.superType).toBe('Base');
  });

  // A trimmed excerpt of the OMG's own Use Case Usage Example.sysml — real
  // idioms this subset doesn't fully model (a bare nested `use case` step,
  // `first start;`/`then done;` control markers) mixed with ones it does
  // (two `then include use case ...` relationships). Should parse without
  // throwing and extract exactly the two direct includes — the nested
  // 'add fuel' include (two levels deep, inside the skipped 'drive vehicle'
  // step) is a documented limitation, not extracted.
  // Regression: a bare nested `use case` step (no `include` keyword) used to
  // be skipped structurally, along with everything inside it — losing
  // 'drive vehicle' entirely and, two levels deep, its own
  // `include 'add fuel'...`. Both are now extracted: the step itself
  // becomes its own box (promoted to a top-level definition) and an
  // include-like relationship from whichever use case contains it.
  it('parses the real Use Case Usage Example end to end, including a step nested two levels deep', () => {
    const model = parseSysml(`sysml-v2
package 'Use Case Usage Example' {
  use case 'provide transportation' : 'Provide Transportation' {
    subject vehicle;

    first start;

    then include use case 'enter vehicle' : 'Enter Vehicle' {
      subject vehicle;
      actor driver = 'provide transportation'::driver;
    }

    then use case 'drive vehicle' {
      subject vehicle;
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
}`);
    expect(model.definitions.map((d) => d.name)).toEqual([
      'drive vehicle',
      'provide transportation',
      'add fuel',
    ]);
    const driveVehicle = model.definitions.find((d) => d.name === 'drive vehicle');
    if (driveVehicle?.kind !== 'useCaseDef') throw new Error('expected useCaseDef');
    expect(driveVehicle.isUsage).toBe(true);
    expect(model.traceability).toEqual([
      { kind: 'include', source: 'provide transportation', target: 'Enter Vehicle' },
      { kind: 'include', source: 'drive vehicle', target: 'add fuel' },
      { kind: 'include', source: 'provide transportation', target: 'drive vehicle' },
      { kind: 'include', source: 'provide transportation', target: 'Exit Vehicle' },
    ]);
  });

  // Action def/usage grammar below is grounded against the OMG's own
  // training corpus: Systems-Modeling/SysML-v2-Release/sysml/src/training/
  // "14. Action Definitions" through "17. Control".

  it('parses an action def with in/out params and nested action usages (Action Definition Example)', () => {
    const model = parseSysml(`sysml-v2
action def Focus { in scene : Scene; out image : Image; }
action def Shoot { in image: Image; out picture : Picture; }
action def TakePicture { in scene : Scene; out picture : Picture;
  bind focus.scene = scene;
  action focus: Focus { in scene; out image; }
  flow from focus.image to shoot.image;
  action shoot: Shoot { in image; out picture; }
  bind shoot.picture = picture;
}`);
    const takePicture = model.definitions.find((d) => d.name === 'TakePicture');
    if (takePicture?.kind !== 'actionDef') throw new Error('expected actionDef');
    expect(takePicture.params).toEqual([
      { direction: 'in', name: 'scene', type: 'Scene', value: undefined },
      { direction: 'out', name: 'picture', type: 'Picture', value: undefined },
    ]);
    expect(takePicture.actions).toEqual([
      { name: 'focus', type: 'Focus' },
      { name: 'shoot', type: 'Shoot' },
    ]);
    expect(takePicture.flows).toEqual([{ ends: ['focus.image', 'shoot.image'] }]);
    // `bind` is parsed past (not lost, not crashing) but not modeled.
    expect(takePicture.successions).toEqual([]);
  });

  it('parses `first A then B;` succession (Action Succession Example-1)', () => {
    const model = parseSysml(`sysml-v2
action def TakePicture {
  action focus: Focus { in scene; out image; }
  first focus then shoot;
  action shoot: Shoot { in image; out picture; }
}`);
    const def = model.definitions[0];
    if (def.kind !== 'actionDef') throw new Error('expected actionDef');
    expect(def.successions).toEqual([{ from: 'focus', to: 'shoot', guard: undefined }]);
  });

  it('parses the `then action B: Type {...}` declaration-succession shorthand (Action Shorthand Example)', () => {
    const model = parseSysml(`sysml-v2
action def TakePicture {
  action focus: Focus {
    in item scene = TakePicture::scene;
    out item image;
  }
  flow from focus.image to shoot.image;
  then action shoot: Shoot {
    in item;
    out item picture = TakePicture::picture;
  }
}`);
    const def = model.definitions[0];
    if (def.kind !== 'actionDef') throw new Error('expected actionDef');
    expect(def.actions.map((a) => a.name)).toEqual(['focus', 'shoot']);
    expect(def.successions).toEqual([{ from: 'focus', to: 'shoot' }]);
  });

  it('parses a bare `in item;` param, omitting the name entirely (positional redefinition shorthand)', () => {
    const model = parseSysml(`sysml-v2
action def TakePicture {
  action shoot: Shoot {
    in item;
    out item picture = TakePicture::picture;
  }
}`);
    const def = model.definitions[0];
    if (def.kind !== 'actionDef') throw new Error('expected actionDef');
    expect(def.actions).toEqual([{ name: 'shoot', type: 'Shoot' }]);
  });

  it('parses `first A if guard then B;` (Conditional Succession Example-1)', () => {
    const model = parseSysml(`sysml-v2
action def TakePicture {
  action focus : Focus { in scene; out image; }
  first focus
    if focus.image.isWellFocused then shoot;
  action shoot : Shoot { in image; out picture; }
}`);
    const def = model.definitions[0];
    if (def.kind !== 'actionDef') throw new Error('expected actionDef');
    expect(def.successions).toEqual([
      { from: 'focus', to: 'shoot', guard: 'focus.image.isWellFocused' },
    ]);
  });

  it('parses a bare `if guard then B;` with no leading first (Conditional Succession Example-2)', () => {
    const model = parseSysml(`sysml-v2
action def TakePicture {
  action focus : Focus { in scene; out image; }
  if focus.image.isWellFocused then shoot;
  action shoot : Shoot { in image; out picture; }
}`);
    const def = model.definitions[0];
    if (def.kind !== 'actionDef') throw new Error('expected actionDef');
    expect(def.successions).toEqual([
      { from: 'focus', to: 'shoot', guard: 'focus.image.isWellFocused' },
    ]);
  });

  it('recognizes `first start;` and `then done;` as pseudo-endpoints', () => {
    const model = parseSysml(`sysml-v2
action def ChargeBattery {
  first start;
  then action monitor : MonitorBattery { out charge; }
  then done;
}`);
    const def = model.definitions[0];
    if (def.kind !== 'actionDef') throw new Error('expected actionDef');
    expect(def.hasStart).toBe(true);
    expect(def.hasDone).toBe(true);
    expect(def.successions).toEqual([
      { from: '__start__', to: 'monitor' },
      { from: 'monitor', to: '__done__' },
    ]);
  });

  // A trimmed excerpt of the OMG's own Decision Example.sysml — real idioms
  // this subset doesn't model (decide/merge control nodes) mixed with ones
  // it does (first/then succession). Should parse without throwing; a
  // succession running through `decide`/`merge` is simply not recorded
  // (the chain breaks there), not misattributed to the wrong node.
  it('parses the real Decision Example end to end: merge, decide, and the loop-back all as real graph edges', () => {
    const model = parseSysml(`sysml-v2
package 'Decision Example' {
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
}`);
    const def = model.definitions.find((d) => d.name === 'ChargeBattery');
    if (def?.kind !== 'actionDef') throw new Error('expected actionDef');
    expect(def.hasStart).toBe(true);
    expect(def.hasDone).toBe(true);
    expect(def.controlNodes).toEqual([
      { id: 'continueCharging', kind: 'merge' },
      { id: '__decide1__', kind: 'decide' },
    ]);
    // The full graph, including the merge's loop-back edge and both of
    // decide's guarded branches (not chained to each other) — round 2 keeps
    // every one of these, unlike round 1, which had to drop everything that
    // ran through merge/decide.
    expect(def.successions).toEqual([
      { from: '__start__', to: 'continueCharging', guard: undefined },
      { from: 'continueCharging', to: 'monitor' },
      { from: 'monitor', to: '__decide1__', guard: undefined },
      { from: '__decide1__', to: 'addCharge', guard: 'monitor.batteryCharge < 100' },
      { from: '__decide1__', to: 'endCharging', guard: 'monitor.batteryCharge >= 100' },
      { from: 'addCharge', to: 'continueCharging', guard: undefined },
      { from: 'endCharging', to: '__done__' },
    ]);
  });

  // Regression: `<`/`>=` (and `==`/`!=`/`&&`/`||`) weren't in the lexer's
  // punctuation set at all — `>` in particular fell through to "unknown
  // char, skip" the same way `::>`'s trailing `>` once did, silently
  // corrupting a guard's text (`monitor.batteryCharge >= 100` became just
  // `monitor.batteryCharge = 100`). Found while adding the Decision Example
  // test above.
  it('preserves comparison operators in a guard expression, not silently dropping them', () => {
    const model = parseSysml(`sysml-v2
action def TakePicture {
  action focus : Focus { in scene; out image; }
  if focus.count >= 3 then shoot;
  action shoot : Shoot { in image; out picture; }
}`);
    const def = model.definitions[0];
    if (def.kind !== 'actionDef') throw new Error('expected actionDef');
    expect(def.successions).toEqual([{ from: 'focus', to: 'shoot', guard: 'focus.count >= 3' }]);
  });

  // Regression: two guarded branches sitting side by side right after an
  // unmodeled control node (`if a then X; if b then Y;`, as in the real
  // Decision Example above) were incorrectly chained to each other — the
  // second branch's `from` became the first branch's `to`, as if X caused
  // Y, when both actually branch off the same (unmodeled) decision. Fixed
  // by only recording a successor's own name as the next `lastActionName`
  // when it had a known `from` itself, rather than always propagating
  // forward.
  // Regression: two guarded branches sitting side by side after a `decide`
  // must both fan out from the *same* decision node, not chain off each
  // other (the first branch's target becoming the second branch's source).
  it('fans out two guarded branches from the same decide node, not chained to each other', () => {
    const model = parseSysml(`sysml-v2
action def ChargeBattery {
  then decide;
    if a then addCharge;
    if b then endCharging;
  action addCharge : AddCharge;
  action endCharging : EndCharging;
}`);
    const def = model.definitions[0];
    if (def.kind !== 'actionDef') throw new Error('expected actionDef');
    expect(def.controlNodes).toEqual([{ id: '__decide1__', kind: 'decide' }]);
    expect(def.successions).toEqual([
      { from: '__decide1__', to: 'addCharge', guard: 'a' },
      { from: '__decide1__', to: 'endCharging', guard: 'b' },
    ]);
  });

  it('fans out an unguarded fork the same way (Fork Join Example)', () => {
    const model = parseSysml(`sysml-v2
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
}`);
    const def = model.definitions.find((d) => d.name === 'Brake');
    if (def?.kind !== 'actionDef') throw new Error('expected actionDef');
    expect(def.controlNodes).toEqual([
      { id: '__fork1__', kind: 'fork' },
      { id: 'joinNode', kind: 'join' },
    ]);
    expect(def.successions).toEqual([
      { from: 'turnOn', to: '__fork1__', guard: undefined },
      { from: '__fork1__', to: 'monitorBrakePedal', guard: undefined },
      { from: '__fork1__', to: 'monitorTraction', guard: undefined },
      { from: '__fork1__', to: 'braking', guard: undefined },
      { from: 'monitorBrakePedal', to: 'joinNode' },
      { from: 'monitorTraction', to: 'joinNode' },
      { from: 'braking', to: 'joinNode' },
      { from: 'joinNode', to: '__done__' },
    ]);
    expect(def.flows).toEqual([
      { ends: ['monitorBrakePedal.brakePressure', 'braking.brakePressure'] },
      { ends: ['monitorTraction.modulationFrequency', 'braking.modulationFrequency'] },
    ]);
  });

  it('parses a loop action, keeping its own node and until condition, one level deep', () => {
    const model = parseSysml(`sysml-v2
action def MonitorBattery { out charge : Real; }
action def AddCharge { in charge : Real; }
action def EndCharging;

action def ChargeBattery {
  loop action charging {
    action monitor : MonitorBattery { out charge; }
    then if monitor.charge < 100 {
      action addCharge : AddCharge { in charge = monitor.charge; }
    }
  } until charging.monitor.charge >= 100;
  then action endCharging : EndCharging;
  then done;
}`);
    const def = model.definitions.find((d) => d.name === 'ChargeBattery');
    if (def?.kind !== 'actionDef') throw new Error('expected actionDef');
    expect(def.actions).toEqual([
      { name: 'charging', isLoop: true, until: 'charging.monitor.charge >= 100' },
      { name: 'endCharging', type: 'EndCharging' },
    ]);
    expect(def.successions).toEqual([
      { from: 'charging', to: 'endCharging' },
      { from: 'endCharging', to: '__done__' },
    ]);
  });

  it('parses action def specialization (:>) the same way as any other definition kind', () => {
    const model = parseSysml(`sysml-v2
action def Base;
action def Derived :> Base;`);
    const derived = model.definitions.find((d) => d.name === 'Derived');
    if (derived?.kind !== 'actionDef') throw new Error('expected actionDef');
    expect(derived.superType).toBe('Base');
  });

  it('discards a body-less top-level action usage, like a part usage', () => {
    const model = parseSysml(`sysml-v2
action def TakePicture;
action takePicture : TakePicture;`);
    expect(model.definitions.map((d) => d.name)).toEqual(['TakePicture']);
  });

  // send/accept grammar below is grounded against the OMG's own training
  // corpus: Systems-Modeling/SysML-v2-Release/sysml/src/training/
  // "21. Asynchronous Messaging".

  it('parses the real Messaging Example end to end: accept shorthand, succession, and send', () => {
    const model = parseSysml(`sysml-v2
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
}`);
    const def = model.definitions.find((d) => d.name === 'takePicture');
    if (def?.kind !== 'actionDef') throw new Error('expected actionDef');
    const trigger = def.actions.find((a) => a.name === 'trigger');
    expect(trigger?.accept).toEqual({ param: 'scene', type: 'Scene', via: undefined });
    expect(def.sends).toEqual([
      { id: '__send1__', payload: 'new Show ( shoot.picture )', to: 'screen', via: undefined },
    ]);
    expect(def.successions).toEqual([
      { from: 'trigger', to: 'focus' },
      { from: 'focus', to: 'shoot' },
      { from: 'shoot', to: '__send1__' },
    ]);
  });

  it('parses accept/send with the `via <port>` form (Messaging with Ports)', () => {
    const model = parseSysml(`sysml-v2
action def Focus { in item scene : Scene; out item image : Image; }
action def TakePicture;

part camera {
  port viewPort;
  port displayPort;

  action takePicture : TakePicture {
    action trigger accept scene : Scene via viewPort;

    then action focus : Focus {
      in item scene = trigger.scene;
      out item image;
    }

    then send new Show(focus.image) via displayPort;
  }
}`);
    // `takePicture` is nested inside the part `camera`'s body — a part
    // usage's inline body is skipped structurally (see "Known
    // limitations"), so this just confirms the file parses without
    // throwing; the action's own send/accept content isn't reachable from
    // outside the part in this subset.
    expect(model.definitions.map((d) => d.name)).toEqual(['Focus', 'TakePicture', 'camera']);
  });
});

describe('valid SysML v2 constructs beyond the original subset', () => {
  it('parses `flow of Type from a to b` and keeps the payload type', () => {
    const model = parseSysml(`part def Sys {
  part a : A;
  part b : B;
  flow of Msg from a.out1.m to b.in1.m;
  flow named of Other from a.out2 to b.in2;
}`);
    const sys = model.definitions[0];
    if (sys.kind !== 'partDef') throw new Error('expected partDef');
    expect(sys.connectors).toEqual([
      { name: undefined, itemType: 'Msg', ends: ['a.out1.m', 'b.in1.m'] },
      { name: 'named', itemType: 'Other', ends: ['a.out2', 'b.in2'] },
    ]);
  });

  it('keeps flows without `of` unchanged (no itemType key)', () => {
    const model = parseSysml('part def S { part a : A; part b : B; flow from a.p to b.p; }');
    const s = model.definitions[0];
    if (s.kind !== 'partDef') throw new Error('expected partDef');
    expect(s.connectors).toEqual([{ name: undefined, ends: ['a.p', 'b.p'] }]);
  });

  it('parses a verification def and records each `verify` as traceability', () => {
    const model = parseSysml(`verification def AcceptanceTest {
  subject unit : Dispenser;
  objective { verify req004; verify req007; }
}`);
    expect(model.definitions[0]).toMatchObject({
      kind: 'verificationDef',
      name: 'AcceptanceTest',
      subject: { name: 'unit', type: 'Dispenser' },
      verifies: ['req004', 'req007'],
    });
    expect(model.traceability).toEqual([
      { kind: 'verify', source: 'req004', target: 'AcceptanceTest' },
      { kind: 'verify', source: 'req007', target: 'AcceptanceTest' },
    ]);
  });

  it('parses `dependency [name] from a to b` as traceability, with or without a name', () => {
    const model = parseSysml('dependency t1 from req1 to doc1;\ndependency from req2 to doc2;');
    expect(model.traceability).toEqual([
      { kind: 'dependency', source: 'req1', target: 'doc1' },
      { kind: 'dependency', source: 'req2', target: 'doc2' },
    ]);
  });

  it('keeps a body-less top-level part usage only when a traceability statement names it', () => {
    const model = parseSysml(`requirement req1 : R;
part used : U;
part unused : U;
satisfy req1 by used;`);
    const names = model.definitions.map((d) => d.name);
    expect(names).toContain('used');
    expect(names).not.toContain('unused');
  });

  it('keeps the type of a redefined subject (`subject s :>> base : T`)', () => {
    const model = parseSysml('requirement def R :> Base { subject s4 :>> s12 : Dispenser; }');
    expect(model.definitions[0]).toMatchObject({ kind: 'requirementDef', subject: { name: 's4', type: 'Dispenser' } });
  });

  it('collects nested item/port trees from a part usage body, including anonymous redefinitions', () => {
    const model = parseSysml(`part def Sys {
  part dvd : DVDPlayer {
    port :>> hdmiOut {
      out item :>> video {
        item param1 :> parameter;
        item param2 :> parameter;
      }
    }
  }
  part plain : Other;
}`);
    const sys = model.definitions[0];
    if (sys.kind !== 'partDef') throw new Error('expected partDef');
    expect(sys.parts[0].items).toEqual([
      {
        label: 'port :>> hdmiOut',
        ref: 'hdmiOut',
        children: [
          {
            label: 'out :>> video',
            ref: 'video',
            children: [
              { label: 'param1 :> parameter', ref: 'param1', children: [] },
              { label: 'param2 :> parameter', ref: 'param2', children: [] },
            ],
          },
        ],
      },
    ]);
    expect(sys.parts[1].items).toBeUndefined();
  });
});

describe('dependencies inside a part body', () => {
  it('parses `dependency from a::b to c::d;` with qualified paths, normalized to dotted', () => {
    const model = parseSysml('part def Sys { dependency from capture::usbOut::p1 to dvd::hdmiOut::p1; part dvd : D; }');
    const sys = model.definitions[0];
    if (sys.kind !== 'partDef') throw new Error('expected partDef');
    expect(sys.dependencies).toEqual([{ source: 'capture.usbOut.p1', target: 'dvd.hdmiOut.p1' }]);
  });
});

describe('header stripping', () => {
  it('keeps a single-line model that has no sysml-v2 header', () => {
    expect(parseSysml('part def A;').definitions.map((d) => d.name)).toEqual(['A']);
  });
  it('treats a lone `sysml-v2` line as an empty model', () => {
    expect(parseSysml('sysml-v2').definitions).toEqual([]);
  });
});

describe('attribute multiplicity', () => {
  it('keeps `[mult]` on attribute and item members, before or after the type', () => {
    const model = parseSysml('part def P { attribute inventory : Product[8]; attribute xs[2..*] : Real; item parameter : Param [1..*]; }');
    const def = model.definitions[0];
    if (def?.kind !== 'partDef') throw new Error('expected partDef');
    expect(def.attributes.map((a) => [a.name, a.type, a.multiplicity])).toEqual([
      ['inventory', 'Product', '8'],
      ['xs', 'Real', '2..*'],
      ['parameter', 'Param', '1..*'],
    ]);
  });
});
