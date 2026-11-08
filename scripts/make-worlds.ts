/**
 * Regenerates the bundled demo data in public/worlds/ from engine code:
 *   node scripts/make-worlds.ts
 *
 * - grid-town.world.json   procedural demo city (seed 12345) plus demo markings
 * - ring-road.world.json   a ring road with spokes and a few markings
 * - osm-sample.osm.json    synthetic Overpass JSON for "Load sample OSM"
 * - osm-sample.world.json  the same sample imported, plus demo markings
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeWorld } from '../src/engine/io/serialize.ts';
import { importOsm } from '../src/engine/osm/osmParse.ts';
import { generateDemoCity } from '../src/engine/world/demoCity.ts';
import { addDemoMarkings } from '../src/engine/world/demoMarkings.ts';
import { WorldModel } from '../src/engine/world/worldModel.ts';
import { buildOsmSample } from './osmSample.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'worlds');
mkdirSync(out, { recursive: true });
const created = '2026-11-07T00:00:00.000Z';

function write(name: string, data: unknown): void {
  const text = JSON.stringify(data);
  writeFileSync(join(out, name), text);
  console.log(`${name}: ${(text.length / 1024).toFixed(1)} KB`);
}

// grid town
const grid = generateDemoCity(12345);
grid.meta.name = 'Grid Town';
grid.meta.createdAt = created;
addDemoMarkings(grid);
write('grid-town.world.json', serializeWorld(grid, { zoom: 0.4, offset: [0, 0] }));

// ring road
const ring = new WorldModel({
  seed: 777,
  meta: { name: 'Ring Road', createdAt: created, source: 'procedural' },
});
{
  const g = ring.graph;
  const n = 20;
  const r = 1100;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return g.addPoint(Math.cos(a) * r, Math.sin(a) * r * 0.8);
  });
  for (let i = 0; i < n; i++) g.addSegment(pts[i]!, pts[(i + 1) % n]!);
  const hub = g.addPoint(0, 0);
  for (const i of [0, 5, 10, 15]) {
    const p = pts[i]!;
    const mid = g.addPoint(p.x * 0.5, p.y * 0.5);
    g.addSegment(p, mid);
    g.addSegment(mid, hub);
  }
  addDemoMarkings(ring);
}
write('ring-road.world.json', serializeWorld(ring, { zoom: 0.3, offset: [0, 0] }));

// OSM sample
const osm = buildOsmSample();
write('osm-sample.osm.json', osm);
const imported = importOsm(osm, { name: 'Neuenstadt (OSM sample)' });
imported.model.meta.createdAt = created;
addDemoMarkings(imported.model);
console.log('osm stats', imported.stats);
write('osm-sample.world.json', serializeWorld(imported.model, { zoom: 0.35, offset: [0, 0] }));
