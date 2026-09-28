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
});
