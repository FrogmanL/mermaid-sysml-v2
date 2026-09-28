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
  // itself is supported now (see below), so this uses `action def` — still
  // genuinely out of scope — to keep exercising the same skip-recovery path.
  it('stops skipping right after a braced-but-unsupported construct closes, not at the next unrelated brace', () => {
    const model = parseSysml(`sysml-v2
package X {
  action def DoSomething {
    action step1;
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
    expect(controlUnit.parts.find((p) => p.name === 'inventory')?.type).toBe('Product');
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
  it('does not throw on the real Use Case Usage Example idioms, extracting only the direct includes', () => {
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
    expect(model.definitions.map((d) => d.name)).toEqual(['provide transportation', 'add fuel']);
    expect(model.traceability).toEqual([
      { kind: 'include', source: 'provide transportation', target: 'Enter Vehicle' },
      { kind: 'include', source: 'provide transportation', target: 'Exit Vehicle' },
    ]);
  });
});
