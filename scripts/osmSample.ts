/**
 * Builds a small, entirely fictional town in Overpass JSON format ("Neuenstadt"), used
 * as the bundled OSM sample. It is synthetic on purpose: no real map data (and no
 * licensing obligations) ships with the app, yet it exercises every parser rule:
 * drivable highway filtering, shared junction nodes, a roundabout, oneway=yes / -1 /
 * no, bridges over a river, a tunnel, an untagged way, a footway (excluded), building
 * footprints and a water polygon.
 */
import { Rng } from '../src/engine/math/rng.ts';

interface Node {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
}
interface Way {
  type: 'way';
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}

const LAT0 = 46.9481;
const LON0 = 7.4474;
const M_PER_DEG = (2 * Math.PI * 6378137) / 360;
const COS0 = Math.cos((LAT0 * Math.PI) / 180);

export function buildOsmSample(): { version: number; generator: string; elements: (Node | Way)[] } {
  const rng = new Rng(2026);
  const nodes: Node[] = [];
  const ways: Way[] = [];
  let nid = 1000;
  let wid = 5000;
  /** metres east (x) and south (y) of the centre → node id */
  const node = (x: number, y: number): number => {
    const id = nid++;
    nodes.push({
      type: 'node',
      id,
      lat: +(LAT0 - y / M_PER_DEG).toFixed(7),
      lon: +(LON0 + x / (M_PER_DEG * COS0)).toFixed(7),
    });
    return id;
  };
  const way = (ids: number[], tags?: Record<string, string>): void => {
    ways.push(
      tags ? { type: 'way', id: wid++, nodes: ids, tags } : { type: 'way', id: wid++, nodes: ids },
    );
  };

  const xs = [-770, -550, -330, -110, 110, 330, 550, 770];
  const mainY = (x: number): number => 55 * Math.sin(x / 320);
  const roundaboutX = 110;
  const R = 26;

  // roundabout ring (8 nodes) at the centre crossing
  const ring: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ring.push(node(roundaboutX + Math.cos(a) * R, mainY(roundaboutX) + Math.sin(a) * R));
  }
  way([...ring, ring[0] as number], {
    highway: 'tertiary',
    junction: 'roundabout',
    name: 'Kreisel',
  });
  const ringEast = ring[0] as number;
  const ringSouth = ring[2] as number;
  const ringWest = ring[4] as number;
  const ringNorth = ring[6] as number;

  // main street west → east, with curvature nodes between the side streets
  const mainJunction = new Map<number, number>();
  const mainWest: number[] = [];
  const mainEast: number[] = [];
  mainWest.push(node(-980, mainY(-980)));
  for (const x of xs) {
    if (x === roundaboutX) {
      mainWest.push(node(x - 110, mainY(x - 110)));
      mainWest.push(ringWest);
      mainEast.push(ringEast);
      continue;
    }
    if (x > roundaboutX) {
      mainEast.push(node(x - 110, mainY(x - 110)));
      const j = node(x, mainY(x));
      mainEast.push(j);
      mainJunction.set(x, j);
    } else {
      if (x > xs[0]!) mainWest.push(node(x - 110, mainY(x - 110)));
      const j = node(x, mainY(x));
      mainWest.push(j);
      mainJunction.set(x, j);
    }
  }
  mainEast.push(node(980, mainY(980)));
  way(mainWest, { highway: 'primary', name: 'Hauptstrasse', maxspeed: '50' });
  way(mainEast, { highway: 'primary', name: 'Hauptstrasse', maxspeed: '50' });

  // river band (south), bridges where side streets cross it
  const riverTop = 245;
  const riverBottom = 300;
  const riverPts: number[] = [];
  for (let x = -1050; x <= 1050; x += 150) riverPts.push(node(x, riverTop + 8 * Math.sin(x / 200)));
  for (let x = 1050; x >= -1050; x -= 150)
    riverPts.push(node(x, riverBottom + 8 * Math.sin(x / 200 + 1)));
  way([...riverPts, riverPts[0] as number], { natural: 'water', name: 'Aare' });

  // side streets north → south; top and bottom streets join their ends
  const topNodes: number[] = [];
  const bottomNodes: number[] = [];
  for (const x of xs) {
    const jx = (): number => x + rng.range(-12, 12);
    const top = node(jx(), -400);
    const n1 = node(jx(), -200);
    topNodes.push(top);
    let centre: number;
    let southStart: number;
    if (x === roundaboutX) {
      const north = node(x, -60);
      way([top, n1, north, ringNorth], { highway: 'residential', name: 'Kirchgasse' });
      centre = ringSouth;
      southStart = node(x, 120);
      way([centre, southStart], { highway: 'residential', name: 'Kirchgasse' });
    } else {
      centre = mainJunction.get(x) as number;
      way(
        [top, n1, centre],
        x === -330 ? { highway: 'residential', oneway: 'no' } : { highway: 'residential' },
      );
      southStart = node(jx(), 150);
      way([centre, southStart], { highway: 'residential' });
    }
    const beforeBridge = node(x, riverTop - 25);
    const afterBridge = node(x, riverBottom + 25);
    const bottom = node(jx(), 420);
    bottomNodes.push(bottom);
    way([southStart, beforeBridge], { highway: 'residential' });
    way([beforeBridge, afterBridge], { highway: 'residential', bridge: 'yes', layer: '1' });
    way([afterBridge, bottom], { highway: 'residential' });
  }
  way(topNodes, { highway: 'residential', oneway: 'yes', name: 'Nordring' });
  way(bottomNodes, { highway: 'secondary', oneway: '-1', name: 'Südring' });

  // service loop to a parking lot, with a short tunnel under a plaza
  const s1 = node(-660, -300);
  const s2 = node(-620, -330);
  const s3 = node(-560, -300);
  const j1 = mainJunction.get(-550) as number;
  void j1;
  const westSide = topNodes[1] as number;
  void westSide;
  const svcStart = node(-550, -120);
  way([svcStart, s3, s2, s1], { highway: 'service', service: 'parking_aisle' });
  const t1 = node(-700, -250);
  way([s1, t1], { highway: 'service', tunnel: 'yes' });
  // connect the service start to the side street at x = -550 (between its nodes)
  // by splitting: add a short link to that street's mid node
  const sideMid = nodes.find(
    (n) =>
      Math.abs((n.lon - LON0) * M_PER_DEG * COS0 + 550) < 20 &&
      Math.abs((LAT0 - n.lat) * M_PER_DEG + 200) < 5,
  );
  if (sideMid) way([svcStart, sideMid.id], { highway: 'service' });

  // excluded and malformed data the parser must survive
  const f1 = node(250, -120);
  const f2 = node(320, -150);
  way([f1, f2], { highway: 'footway' });
  way([f2, node(360, -170)]); // untagged way
  way([node(400, -170), node(420, -190)], { highway: 'proposed' });

  // buildings along the main street and side streets
  let b = 0;
  for (const x of xs) {
    for (const side of [-1, 1]) {
      for (const k of [-1, 1]) {
        if (b > 60) break;
        const bx = x + k * 60 + rng.range(-8, 8);
        const by = mainY(bx) + side * rng.range(38, 52);
        const w = rng.range(14, 22);
        const h = rng.range(16, 28);
        const c = [
          node(bx - w / 2, by - h / 2),
          node(bx + w / 2, by - h / 2),
          node(bx + w / 2, by + h / 2),
          node(bx - w / 2, by + h / 2),
        ];
        way([...c, c[0] as number], { building: rng.chance(0.7) ? 'yes' : 'house' });
        b++;
      }
    }
  }
  return {
    version: 0.6,
    generator: 'NeuroDrive City synthetic sample (fictional town)',
    elements: [...nodes, ...ways],
  };
}
