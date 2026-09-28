import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { select } from 'd3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as db from '../src/db.js';
import { injectUtils } from '../src/mermaidUtils.js';
import { draw } from '../src/renderer.js';

const vehicleSource = readFileSync(join(process.cwd(), 'examples/vehicle.mmd'), 'utf-8');
const bvmSource = readFileSync(join(process.cwd(), 'examples/bvm.mmd'), 'utf-8');

const noop = () => undefined;

beforeEach(() => {
  db.clear();
  document.body.innerHTML = '';
  injectUtils(
    { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop },
    noop,
    () => ({ sysml: {} }),
    (s: string) => s,
    vi.fn(),
    () => ({})
  );
});

describe('renderer.draw', () => {
  it('draws one node per parsed definition', () => {
    db.parse(vehicleSource);
    select(document.body).append('svg').attr('id', 'sysml-test-1');

    draw('', 'sysml-test-1', '0.0.0');

    const nodes = document.querySelectorAll('#sysml-test-1 .node');
    expect(nodes.length).toBe(db.getModel().definitions.length);
  });

  it('renders a fallback message when there are no definitions', () => {
    db.parse('sysml-v2\n');
    select(document.body).append('svg').attr('id', 'sysml-test-2');

    draw('', 'sysml-test-2', '0.0.0');

    expect(document.querySelector('#sysml-test-2 .node')).toBeNull();
    expect(document.querySelector('#sysml-test-2')?.textContent).toContain(
      'No SysML v2 part/port/interface definitions found.'
    );
  });

  it('renders the interface def flows compartment with the parsed arrow text', () => {
    db.parse(vehicleSource);
    select(document.body).append('svg').attr('id', 'sysml-test-3');

    draw('', 'sysml-test-3', '0.0.0');

    const texts = Array.from(document.querySelectorAll('#sysml-test-3 .member')).map(
      (el) => el.textContent
    );
    expect(texts).toContain('axleMount.transferredTorque → hub.appliedTorque');
  });

  // BVM's ControlUnit also has containment (`part inventory : Product [8];`)
  // and renders as its own top-level tree box (no connectors, so the tree
  // view applies — see below) — so these tests scope to the BVM node
  // specifically rather than counting `.child`/`.connector` across the
  // whole document.
  function findNodeByTitle(root: ParentNode, title: string): Element {
    const node = Array.from(root.querySelectorAll('.node')).find(
      (n) => n.querySelector(':scope > .title')?.textContent === title
    );
    if (!node) throw new Error(`no top-level node titled "${title}"`);
    return node;
  }

  it('draws a container box with one child per contained part and a connector per connect statement', () => {
    db.parse(bvmSource);
    select(document.body).append('svg').attr('id', 'sysml-test-4');

    draw('', 'sysml-test-4', '0.0.0');

    const bvmNode = findNodeByTitle(document.querySelector('#sysml-test-4')!, 'BVM');
    const children = bvmNode.querySelectorAll(':scope > .child');
    expect(children.length).toBe(5);

    const connectors = bvmNode.querySelectorAll(':scope > .connector');
    expect(connectors.length).toBe(4);

    const childLabels = Array.from(children)
      .flatMap((child) => Array.from(child.querySelectorAll('.member')))
      .map((el) => el.textContent);
    expect(childLabels).toContain('coinAcceptor : CoinAcceptor');
  });

  it('draws a port marker labeled with the port name on each child that resolves one', () => {
    db.parse(bvmSource);
    select(document.body).append('svg').attr('id', 'sysml-test-5');

    draw('', 'sysml-test-5', '0.0.0');

    const bvmNode = findNodeByTitle(document.querySelector('#sysml-test-5')!, 'BVM');
    const portLabels = Array.from(bvmNode.querySelectorAll('.child .compartment-label')).map(
      (el) => el.textContent
    );
    expect(portLabels).toEqual(
      expect.arrayContaining(['coinOut', 'coinIn', 'dispenseOut', 'changeOut', 'displayOut'])
    );
  });

  it('shows «part def» for a definition and «part» with "name : Type" for a usage', () => {
    db.parse(`sysml-v2
part def Vehicle {
  attribute mass;
}
part roomContext {
  part c : Classroom;
}`);
    select(document.body).append('svg').attr('id', 'sysml-test-6');
    draw('', 'sysml-test-6', '0.0.0');

    const vehicleNode = findNodeByTitle(document.querySelector('#sysml-test-6')!, 'Vehicle');
    expect(vehicleNode.querySelector(':scope > .stereotype')?.textContent).toBe('«part def»');

    const roomContextNode = findNodeByTitle(document.querySelector('#sysml-test-6')!, 'roomContext');
    expect(roomContextNode.querySelector(':scope > .stereotype')?.textContent).toBe('«part»');
  });

  it('renders containment with no connectors as a composition tree (diamond + child box, no ports/connector lines)', () => {
    db.parse(`sysml-v2
part def Vehicle {
  part engine : Engine;
  part chassis : Chassis;
}
part def Engine;
part def Chassis;`);
    select(document.body).append('svg').attr('id', 'sysml-test-7');
    draw('', 'sysml-test-7', '0.0.0');

    const vehicleNode = findNodeByTitle(document.querySelector('#sysml-test-7')!, 'Vehicle');
    expect(vehicleNode.querySelectorAll('polygon.tree-diamond').length).toBe(1);
    expect(vehicleNode.querySelectorAll('line.tree-line').length).toBeGreaterThan(0);
    expect(vehicleNode.querySelectorAll('rect.port').length).toBe(0);
    expect(vehicleNode.querySelectorAll('path.connector').length).toBe(0);

    const childLabels = Array.from(vehicleNode.querySelectorAll('.member')).map((el) => el.textContent);
    expect(childLabels).toEqual(expect.arrayContaining(['engine : Engine', 'chassis : Chassis']));
  });

  it('recurses into a child usage that itself has containment, at least two levels deep', () => {
    db.parse(`sysml-v2
part def Vehicle {
  part engine : Engine;
}
part def Engine {
  part cylinder1 : Cylinder;
  part cylinder2 : Cylinder;
}
part def Cylinder;`);
    select(document.body).append('svg').attr('id', 'sysml-test-8');
    draw('', 'sysml-test-8', '0.0.0');

    const vehicleNode = findNodeByTitle(document.querySelector('#sysml-test-8')!, 'Vehicle');
    // One diamond for Vehicle -> engine, one for engine -> its two cylinders.
    expect(vehicleNode.querySelectorAll('polygon.tree-diamond').length).toBe(2);
    const labels = Array.from(vehicleNode.querySelectorAll('.member')).map((el) => el.textContent);
    expect(labels).toEqual(
      expect.arrayContaining(['engine : Engine', 'cylinder1 : Cylinder', 'cylinder2 : Cylinder'])
    );
  });

  it('does not infinite-loop on a containment cycle, and still renders the rest of the tree', () => {
    db.parse(`sysml-v2
part def A {
  part b : B;
}
part def B {
  part a : A;
}`);
    select(document.body).append('svg').attr('id', 'sysml-test-9');

    expect(() => draw('', 'sysml-test-9', '0.0.0')).not.toThrow();
  });

  it('draws a connector arrowhead at the target port, and labels the wire with the conveyed item when the path has one', () => {
    db.parse(`sysml-v2
part def RoomContext {
  part h : Hallway;
  part c : Classroom;
  flow h.exit.air to c.entry.air;
}
part def Hallway {
  port exit : ExitPort;
}
part def Classroom {
  port entry : EntryPort;
}
port def ExitPort;
port def EntryPort;`);
    select(document.body).append('svg').attr('id', 'sysml-test-10');
    draw('', 'sysml-test-10', '0.0.0');

    const roomNode = findNodeByTitle(document.querySelector('#sysml-test-10')!, 'RoomContext');
    expect(roomNode.querySelectorAll('polygon.connector-arrow').length).toBe(1);
    expect(roomNode.querySelector('text.connector-label')?.textContent).toBe('air');
  });

  it('draws a ::>-bound connect the same as a plain one, resolving only the bound-to path', () => {
    db.parse(`sysml-v2
part def Family {
  part woman : Person;
  part man : Person;
  connect communicationPartnerA ::> woman.exchange to communicationPartnerB ::> man.exchange;
}
part def Person {
  port exchange : ExchangePort;
}
port def ExchangePort;`);
    select(document.body).append('svg').attr('id', 'sysml-test-11');
    draw('', 'sysml-test-11', '0.0.0');

    const familyNode = findNodeByTitle(document.querySelector('#sysml-test-11')!, 'Family');
    expect(familyNode.querySelectorAll(':scope > .connector').length).toBe(1);
    expect(familyNode.querySelectorAll(':scope > .connector-arrow').length).toBe(1);
  });

  it('draws a bare-part connector end (no port) anchored to the child\'s own bottom-center', () => {
    db.parse(`sysml-v2
part def Family {
  part woman : Person;
  part man : Person;
  connection child : Child {
    end mother ::> woman;
    end father ::> man;
  }
}
part def Person;`);
    select(document.body).append('svg').attr('id', 'sysml-test-12');
    draw('', 'sysml-test-12', '0.0.0');

    const familyNode = findNodeByTitle(document.querySelector('#sysml-test-12')!, 'Family');
    // Person has no ports at all, yet the connection's redefined ends still
    // resolve to a drawable line anchored on each child's own box.
    expect(familyNode.querySelectorAll('rect.port').length).toBe(0);
    expect(familyNode.querySelectorAll(':scope > .connector').length).toBe(1);
  });

  it('draws an n-ary connector as a junction dot with one branch per end, no arrowhead', () => {
    db.parse(`sysml-v2
part def Family {
  part woman : Person;
  part man : Person;
  part child : Person;
  connect (parent1 ::> woman, parent2 ::> man, certifiedChild ::> child);
}
part def Person;`);
    select(document.body).append('svg').attr('id', 'sysml-test-13');
    draw('', 'sysml-test-13', '0.0.0');

    const familyNode = findNodeByTitle(document.querySelector('#sysml-test-13')!, 'Family');
    expect(familyNode.querySelectorAll(':scope > .connector').length).toBe(3);
    expect(familyNode.querySelectorAll(':scope > .connector-junction').length).toBe(1);
    expect(familyNode.querySelectorAll(':scope > .connector-arrow').length).toBe(0);
  });

  it('draws a hollow-triangle specialization arrow between two definition boxes sharing a :> relationship', () => {
    db.parse(`sysml-v2
part def Axle {
  attribute mass;
}
part def FrontAxle :> Axle {
  attribute steeringAngle;
}`);
    select(document.body).append('svg').attr('id', 'sysml-test-15');
    draw('', 'sysml-test-15', '0.0.0');

    const svgEl = document.querySelector('#sysml-test-15')!;
    expect(svgEl.querySelectorAll('line.specialization-line').length).toBe(1);
    expect(svgEl.querySelectorAll('polygon.specialization-arrow').length).toBe(1);
  });

  it('skips the specialization arrow when the supertype has no box in this diagram (a library type)', () => {
    db.parse(`sysml-v2
part def Vehicle :> ISQ::PhysicalObject {
  attribute mass;
}`);
    select(document.body).append('svg').attr('id', 'sysml-test-16');
    draw('', 'sysml-test-16', '0.0.0');

    const svgEl = document.querySelector('#sysml-test-16')!;
    expect(svgEl.querySelectorAll('line.specialization-line').length).toBe(0);
  });

  it('shows the actual relation operator (:>) an attribute was introduced by, not always a plain :', () => {
    db.parse(`sysml-v2
part def Vehicle {
  attribute mass :> ISQ::mass;
}`);
    select(document.body).append('svg').attr('id', 'sysml-test-17');
    draw('', 'sysml-test-17', '0.0.0');

    const vehicleNode = findNodeByTitle(document.querySelector('#sysml-test-17')!, 'Vehicle');
    const texts = Array.from(vehicleNode.querySelectorAll('.member')).map((el) => el.textContent);
    expect(texts).toContain('mass :> ISQ::mass');
  });

  it('shows :>> (redefines) on a composition-tree usage label, not a plain :', () => {
    db.parse(`sysml-v2
part def Family {
  part base : Person;
  part socialService :>> base;
}
part def Person;`);
    select(document.body).append('svg').attr('id', 'sysml-test-18');
    draw('', 'sysml-test-18', '0.0.0');

    const familyNode = findNodeByTitle(document.querySelector('#sysml-test-18')!, 'Family');
    const texts = Array.from(familyNode.querySelectorAll('.member')).map((el) => el.textContent);
    expect(texts).toContain('socialService :>> base');
  });

  it('renders a connection def like interface def, with ends and attributes compartments', () => {
    db.parse(`sysml-v2
connection def DeviceConn {
  end part hub : Hub;
  end part device : Device;
  attribute bandwidth : Real;
}
part def Hub;
part def Device;`);
    select(document.body).append('svg').attr('id', 'sysml-test-14');
    draw('', 'sysml-test-14', '0.0.0');

    const connNode = findNodeByTitle(document.querySelector('#sysml-test-14')!, 'DeviceConn');
    expect(connNode.querySelector(':scope > .stereotype')?.textContent).toBe('«connection def»');
    const lines = Array.from(connNode.querySelectorAll('.member')).map((el) => el.textContent);
    expect(lines).toEqual(expect.arrayContaining(['hub : Hub', 'device : Device', 'bandwidth : Real']));
  });

  it('renders a requirement def («requirement def», subject compartment) and a requirement usage («requirement», "name : Type")', () => {
    db.parse(`sysml-v2
requirement def CoinPaymentReq {
  subject sys001 : CoinAcceptor;
}
requirement req001 : CoinPaymentReq;
part def CoinAcceptor;`);
    select(document.body).append('svg').attr('id', 'sysml-test-19');
    draw('', 'sysml-test-19', '0.0.0');

    const defNode = findNodeByTitle(document.querySelector('#sysml-test-19')!, 'CoinPaymentReq');
    expect(defNode.querySelector(':scope > .stereotype')?.textContent).toBe('«requirement def»');
    expect(Array.from(defNode.querySelectorAll('.member')).map((el) => el.textContent)).toContain(
      'sys001 : CoinAcceptor'
    );

    const usageNode = findNodeByTitle(document.querySelector('#sysml-test-19')!, 'req001 : CoinPaymentReq');
    expect(usageNode.querySelector(':scope > .stereotype')?.textContent).toBe('«requirement»');
  });

  it('draws a satisfy dependency arrow from the satisfying element to the requirement when both resolve to a box', () => {
    db.parse(`sysml-v2
requirement req001 : CoinPaymentReq;
part def CoinAcceptor;
satisfy req001 by CoinAcceptor;`);
    select(document.body).append('svg').attr('id', 'sysml-test-20');
    draw('', 'sysml-test-20', '0.0.0');

    const svgEl = document.querySelector('#sysml-test-20')!;
    expect(svgEl.querySelectorAll('line.dependency-line').length).toBe(1);
    expect(svgEl.querySelectorAll('polyline.dependency-arrowhead').length).toBe(1);
    expect(svgEl.querySelector('text.dependency-label')?.textContent).toBe('«satisfy»');
  });

  it('skips the satisfy arrow when the by-target is a multi-segment path that has no box of its own', () => {
    db.parse(`sysml-v2
requirement req001 : CoinPaymentReq;
satisfy req001 by bvm.coinAcceptor;`);
    select(document.body).append('svg').attr('id', 'sysml-test-21');
    draw('', 'sysml-test-21', '0.0.0');

    expect(document.querySelectorAll('#sysml-test-21 line.dependency-line').length).toBe(0);
  });

  it('draws a «derive» dependency arrow for a requirement usage\'s :> derivation, from the derived usage to the general one', () => {
    db.parse(`sysml-v2
requirement req012 : NoUnpaidDispensingReq;
requirement req004 : ProductDispensingReq :> req012;`);
    select(document.body).append('svg').attr('id', 'sysml-test-22');
    draw('', 'sysml-test-22', '0.0.0');

    const svgEl = document.querySelector('#sysml-test-22')!;
    expect(svgEl.querySelectorAll('line.dependency-line').length).toBe(1);
    expect(svgEl.querySelector('text.dependency-label')?.textContent).toBe('«derive»');
  });

  it('renders the real BVM requirements package end to end without throwing, including its satisfy statements', () => {
    db.parse(bvmSource);
    select(document.body).append('svg').attr('id', 'sysml-test-23');

    expect(() => draw('', 'sysml-test-23', '0.0.0')).not.toThrow();
    // Every satisfy `by` target in bvm.mmd is a multi-segment instance path
    // (`bvm.coinAcceptor`), which this subset doesn't resolve to a box (see
    // README "Known limitations") — so no dependency arrows are expected
    // here, only that parsing/rendering the real file doesn't break.
    const req001Node = findNodeByTitle(document.querySelector('#sysml-test-23')!, 'req001 : CoinPaymentReq');
    expect(req001Node.querySelector(':scope > .stereotype')?.textContent).toBe('«requirement»');
  });

  it('renders an attribute def as a leaf box with an attributes compartment', () => {
    db.parse(`sysml-v2
attribute def Product {
  attribute id : String;
  attribute price : Real;
}`);
    select(document.body).append('svg').attr('id', 'sysml-test-24');
    draw('', 'sysml-test-24', '0.0.0');

    const node = findNodeByTitle(document.querySelector('#sysml-test-24')!, 'Product');
    expect(node.querySelector(':scope > .stereotype')?.textContent).toBe('«attribute def»');
    const lines = Array.from(node.querySelectorAll('.member')).map((el) => el.textContent);
    expect(lines).toEqual(expect.arrayContaining(['id : String', 'price : Real']));
  });

  it('renders an enum def as a leaf box with a values compartment', () => {
    db.parse(`sysml-v2
enum def DispenseResult {
  enum success;
  enum failure;
}`);
    select(document.body).append('svg').attr('id', 'sysml-test-25');
    draw('', 'sysml-test-25', '0.0.0');

    const node = findNodeByTitle(document.querySelector('#sysml-test-25')!, 'DispenseResult');
    expect(node.querySelector(':scope > .stereotype')?.textContent).toBe('«enum def»');
    const lines = Array.from(node.querySelectorAll('.member')).map((el) => el.textContent);
    expect(lines).toEqual(['success', 'failure']);
  });

  it('draws a specialization arrow between two attribute defs / enum defs, same as any other definition kind', () => {
    db.parse(`sysml-v2
attribute def Base;
attribute def Derived :> Base;`);
    select(document.body).append('svg').attr('id', 'sysml-test-26');
    draw('', 'sysml-test-26', '0.0.0');

    const svgEl = document.querySelector('#sysml-test-26')!;
    expect(svgEl.querySelectorAll('polygon.specialization-arrow').length).toBe(1);
  });

  it('renders the real BVM Product/DispenseResult defs without throwing, now with their own boxes', () => {
    db.parse(bvmSource);
    select(document.body).append('svg').attr('id', 'sysml-test-27');

    expect(() => draw('', 'sysml-test-27', '0.0.0')).not.toThrow();
    const productNode = findNodeByTitle(document.querySelector('#sysml-test-27')!, 'Product');
    expect(productNode.querySelector(':scope > .stereotype')?.textContent).toBe('«attribute def»');
    const dispenseResultNode = findNodeByTitle(document.querySelector('#sysml-test-27')!, 'DispenseResult');
    expect(dispenseResultNode.querySelector(':scope > .stereotype')?.textContent).toBe('«enum def»');
  });

  it('draws one stick-figure actor per `actor` member, with an association line to the box', () => {
    db.parse(`sysml-v2
use case def 'Provide Transportation' {
  subject vehicle : Vehicle;
  actor driver : Person;
  actor passengers : Person[0..4];
}`);
    select(document.body).append('svg').attr('id', 'sysml-test-28');
    draw('', 'sysml-test-28', '0.0.0');

    const node = findNodeByTitle(document.querySelector('#sysml-test-28')!, 'Provide Transportation');
    expect(node.querySelector(':scope > .stereotype')?.textContent).toBe('«use case def»');
    expect(node.querySelectorAll('circle.actor-icon').length).toBe(2);
    expect(node.querySelectorAll('line.actor-association').length).toBe(2);
    const actorLabels = Array.from(node.querySelectorAll('text.actor-label')).map((el) => el.textContent);
    expect(actorLabels).toEqual(['driver : Person', 'passengers : Person']);
    const memberLines = Array.from(node.querySelectorAll('.member')).map((el) => el.textContent);
    expect(memberLines).toContain('vehicle : Vehicle');
  });

  it('renders a use case with no actors as a plain compartmented box (no stick figures)', () => {
    db.parse(`sysml-v2
use case def NoActors {
  subject vehicle : Vehicle;
}`);
    select(document.body).append('svg').attr('id', 'sysml-test-29');
    draw('', 'sysml-test-29', '0.0.0');

    const node = findNodeByTitle(document.querySelector('#sysml-test-29')!, 'NoActors');
    expect(node.querySelectorAll('circle.actor-icon').length).toBe(0);
  });

  it('shows «use case» with "name : Type" for a usage, matching every other usage kind', () => {
    db.parse(`sysml-v2
use case def 'Provide Transportation';
use case 'provide transportation' : 'Provide Transportation';`);
    select(document.body).append('svg').attr('id', 'sysml-test-30');
    draw('', 'sysml-test-30', '0.0.0');

    const node = findNodeByTitle(document.querySelector('#sysml-test-30')!, 'provide transportation : Provide Transportation');
    expect(node.querySelector(':scope > .stereotype')?.textContent).toBe('«use case»');
  });

  it('draws a dashed «include» dependency arrow between two use cases', () => {
    db.parse(`sysml-v2
use case 'provide transportation' {
  include use case 'enter vehicle' : 'Enter Vehicle';
}
use case def 'Enter Vehicle';`);
    select(document.body).append('svg').attr('id', 'sysml-test-31');
    draw('', 'sysml-test-31', '0.0.0');

    const svgEl = document.querySelector('#sysml-test-31')!;
    expect(svgEl.querySelectorAll('line.dependency-line').length).toBe(1);
    expect(svgEl.querySelector('text.dependency-label')?.textContent).toBe('«include»');
  });

  it('draws an action flowchart: start circle, action nodes, done circle, and solid succession arrows', () => {
    db.parse(`sysml-v2
action def TakePicture {
  first start;
  then action focus : Focus { in scene; out image; }
  then action shoot : Shoot { in image; out picture; }
  then done;
}`);
    select(document.body).append('svg').attr('id', 'sysml-test-32');
    draw('', 'sysml-test-32', '0.0.0');

    const node = findNodeByTitle(document.querySelector('#sysml-test-32')!, 'TakePicture');
    expect(node.querySelectorAll('circle.action-start').length).toBe(1);
    expect(node.querySelectorAll('circle.action-done-outer').length).toBe(1);
    expect(node.querySelectorAll('circle.action-done-inner').length).toBe(1);
    expect(node.querySelectorAll('line.succession-line').length).toBe(3);
    expect(node.querySelectorAll('polygon.succession-arrow').length).toBe(3);
    const labels = Array.from(node.querySelectorAll('.member')).map((el) => el.textContent);
    expect(labels).toEqual(expect.arrayContaining(['focus : Focus', 'shoot : Shoot']));
  });

  it('labels a succession arrow with a bracketed guard when one was given', () => {
    db.parse(`sysml-v2
action def TakePicture {
  action focus : Focus { in scene; out image; }
  if focus.image.isWellFocused then shoot;
  action shoot : Shoot { in image; out picture; }
}`);
    select(document.body).append('svg').attr('id', 'sysml-test-33');
    draw('', 'sysml-test-33', '0.0.0');

    const node = findNodeByTitle(document.querySelector('#sysml-test-33')!, 'TakePicture');
    expect(node.querySelector('text.succession-label')?.textContent).toBe('[focus.image.isWellFocused]');
  });

  it('draws a dashed data-flow arrow between two action nodes (reusing the dependency-arrow shape)', () => {
    db.parse(`sysml-v2
action def TakePicture {
  action focus: Focus { in scene; out image; }
  flow from focus.image to shoot.image;
  action shoot: Shoot { in image; out picture; }
}`);
    select(document.body).append('svg').attr('id', 'sysml-test-34');
    draw('', 'sysml-test-34', '0.0.0');

    const node = findNodeByTitle(document.querySelector('#sysml-test-34')!, 'TakePicture');
    expect(node.querySelectorAll('line.dependency-line').length).toBe(1);
    expect(node.querySelectorAll('polyline.dependency-arrowhead').length).toBe(1);
  });

  it('renders an action def with no flowchart content as a plain leaf box with a parameters compartment', () => {
    db.parse(`sysml-v2
action def Focus { in scene : Scene; out image : Image; }`);
    select(document.body).append('svg').attr('id', 'sysml-test-35');
    draw('', 'sysml-test-35', '0.0.0');

    const node = findNodeByTitle(document.querySelector('#sysml-test-35')!, 'Focus');
    expect(node.querySelector(':scope > .stereotype')?.textContent).toBe('«action def»');
    const lines = Array.from(node.querySelectorAll('.member')).map((el) => el.textContent);
    expect(lines).toEqual(expect.arrayContaining(['in scene : Scene', 'out image : Image']));
    expect(node.querySelectorAll('circle.action-start').length).toBe(0);
  });

  it('renders the real Decision Example end to end: merge/decide as diamonds, every succession drawn', () => {
    db.parse(`sysml-v2
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
    select(document.body).append('svg').attr('id', 'sysml-test-36');
    expect(() => draw('', 'sysml-test-36', '0.0.0')).not.toThrow();
    const node = findNodeByTitle(document.querySelector('#sysml-test-36')!, 'ChargeBattery');
    expect(node.querySelectorAll('circle.action-start').length).toBe(1);
    expect(node.querySelectorAll('circle.action-done-outer').length).toBe(1);
    // Two diamonds: the merge and the decide.
    expect(node.querySelectorAll('polygon.action-decision').length).toBe(2);
    // All 7 real successions now draw, including the merge's loop-back edge
    // and both of decide's guarded branches.
    expect(node.querySelectorAll('line.succession-line').length).toBe(7);
    expect(node.querySelector('text.succession-label')?.textContent).toMatch(/^\[monitor\.batteryCharge/);
  });

  it('renders the real Fork Join Example end to end: fork/join as bars, all branches and the join drawn', () => {
    db.parse(`sysml-v2
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
    select(document.body).append('svg').attr('id', 'sysml-test-37');
    expect(() => draw('', 'sysml-test-37', '0.0.0')).not.toThrow();
    const node = findNodeByTitle(document.querySelector('#sysml-test-37')!, 'Brake');
    // Two bars: the fork and the join.
    expect(node.querySelectorAll('rect.action-fork-join').length).toBe(2);
    // turnOn->fork, fork->{3 branches}, {3 actions}->join, join->done = 8.
    expect(node.querySelectorAll('line.succession-line').length).toBe(8);
    expect(node.querySelectorAll('line.dependency-line').length).toBe(2);
  });

  it('renders a loop action as its own labeled node, one level deep', () => {
    db.parse(`sysml-v2
action def MonitorBattery { out charge : Real; }
action def EndCharging;

action def ChargeBattery {
  loop action charging {
    action monitor : MonitorBattery { out charge; }
  } until charging.monitor.charge >= 100;
  then action endCharging : EndCharging;
  then done;
}`);
    select(document.body).append('svg').attr('id', 'sysml-test-38');
    draw('', 'sysml-test-38', '0.0.0');

    const node = findNodeByTitle(document.querySelector('#sysml-test-38')!, 'ChargeBattery');
    const labels = Array.from(node.querySelectorAll('.member')).map((el) => el.textContent);
    expect(labels).toContain('loop charging');
    expect(node.querySelectorAll('line.succession-line').length).toBe(2);
  });
});
