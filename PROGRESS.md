# Progress

Status of every phase, the next step, known issues, and gate evidence.

## Status

| Phase | Title                                                              | Status      |
| ----- | ------------------------------------------------------------------ | ----------- |
| 0     | Scaffold and tooling                                               | done (2ac7d05) |
| 1     | Math, graph, spatial hash                                          | done        |
| 2     | 2D editor and viewport                                             | done        |
| 3     | World generation and 2D world rendering                            | done        |
| 4     | Markings, save/load, OSM                                           | done        |
| 5     | Cars, sensors, damage, traffic, navigation                         | done        |
| 6     | Neural network, evolution, visualizer, infinite road (tag v0.9-2d) | done        |
| 7     | 3D renderer foundation                                             | done        |
| 8     | 3D polish, pre-trained brain, turbo worker                         | pending     |
| 9     | Stretch, accessibility, UX polish                                  | pending     |
| 10    | Docs, deploy readiness, final audit (tag v1.0.0)                   | pending     |

**Next:** Phase 8, 3D polish (sensor rays, 3D markings, day/night with sky and headlights, bloom and
quality presets with auto-downgrade, 3D particles and skid trail, settings panel, turbo trainer worker,
pre-trained brain).

## Implementation plan (phases, tasks, files, tests)

**Phase 0. Scaffold.** Vite vanilla-ts, strict tsconfigs (app, node, engine-no-DOM), ESLint flat
config with the engine import and `Math.random` bans, Prettier, Vitest, Playwright with an
auto console-error fixture, CI and deploy workflows, docs. Files: configs, `src/main.ts`,
`src/ui/styles/*`, `src/engine/math/utils.ts`. Tests: `tests/engine/math/utils.test.ts`,
`e2e/smoke.spec.ts`.

**Phase 1. Engine foundations (A1 to A5).** `engine/math/{vec2,intersect,polygon,rng}.ts`,
`engine/graph/{point,segment,graph,spatialHash}.ts`. Tests for every predicate (crossing,
parallel, collinear, touching, vertex-crossing rays, containment, union without interior
segments, break without zero-length pieces, no input mutation), graph cascade and versioning,
hash queries. Gate: 90% lines on math and graph.

**Phase 2. Editor (B1 to B4, B7 to B9).** `render2d/viewport.ts` (eased zoom to cursor,
pan, pinch), `editor/{editorController,history,snapping}.ts`, `editor/tools/*`, app shell
(`app/*`, `ui/toolbar.ts`, `ui/panels/helpOverlay.ts`, `ui/panels/worldPanel.ts`,
`ui/toast.ts`), IndexedDB autosave (`app/storage.ts`), `debug/stats.ts` and `window.__ND__`.
Tests: viewport conversions, history (all commands undo/redo), snapping; e2e smoke + editor.

**Phase 3. World generation (C1 to C8, I1 to I3, L4).** `engine/world/*` pipeline (envelopes,
union borders, lane guides, sidewalks, buildings, trees, version cache), worker generation for
large graphs, demo city generator, `render2d/{drawWorld,minimap}.ts` with pseudo-3D depth
sort and frustum culling. Tests: determinism snapshots, no building overlaps road, trees
outside polygons, 200-segment timing.

**Phase 4. Markings, IO, OSM (B5, B6, D1 to D6 controllers, J1 to J5).**
`engine/markings/*` with segment binding, `trafficLightController.ts`, `engine/io/*`
(schema, validate, migrate), `engine/osm/*`, world library, OSM dialog. Tests: binding follows
segment moves and deletes, light phases, stop state machine, OSM fixture, save/load round trip;
e2e osm.

**Phase 5. Cars and navigation (E1 to E4, F1 to F4, L2 in 2D).** `engine/car/*`,
`engine/nav/*`, `engine/sim/{simulation,traffic,particlesSim}.ts`, `render2d/drawCars.ts`.
Tests: physics, sensors (wall at 75 reads 0.5), damage, A*, one-way, route follower in an L
world, 60 s traffic run with at most 5% damaged, 300-car step benchmark.

**Phase 6. AI (G1 to G7, H1 to H5, M).** `engine/ai/*`, evolution manager, infinite road,
`viz/{networkVisualizer,sparkline}.ts`, HUD and training panel. Tests: feed-forward,
mutate(0) identity, mutate(1) bounds, crossover, serialization, gen10 > gen1 in infinite road;
e2e sim2d and training. Tag `v0.9-2d`.

**Phase 7. 3D foundation (K1 to K5, K9 partial, K11).** `render3d/*` lazy chunk, instanced
buildings, trees, cars, camera rig (chase, orbit, top), picking, V toggle crossfade. e2e sim3d
(day), draw calls at most 150.

**Phase 8. 3D polish (K6 to K8, K10, L2 in 3D, G6, G8).** Sensors FX, markings meshes,
day/night, shadows, bloom, presets, auto-downgrade, cinematic camera, turbo worker,
pre-trained brain via `scripts/train.ts`. Tests: camera tween continuity, brain drives 60 s.

**Phase 9. Stretch and polish (F5, J6, onboarding, a11y, responsive, error overlay).**

**Phase 10. Docs and audit.** README with Mermaid diagrams, COMPARISON.md, docs/media,
final Definition of Done audit. Tag `v1.0.0`.

## Gate evidence

### Phase 0 (2026-11-07)

- `npm run typecheck`: 0 errors (three projects).
- `npm run lint`: 0 errors, 0 warnings.
- `npm run test`: 1 file, 8 tests passed.
- `npm run build`: main chunk `index-*.js` 1.86 kB (gzip 1.00 kB), CSS 1.02 kB gzip.
- `npm run e2e`: 1 passed (smoke: zero console errors, canvas variance above threshold).
- Screenshot `e2e/__screenshots__/phase-0-editor-2d.png`: dark teal animated grid filling the
  viewport with a centred glass card reading "NeuroDrive City" in a cyan to magenta gradient and
  the subtitle "Self-driving cars that learn. Coming online." Not blank.

### Phase 1 (2026-11-07)

- `npm run typecheck`: 0 errors. `npm run lint`: 0 errors, 0 warnings.
- `npm run test:coverage`: 8 files, 85 tests passed. Coverage (src/engine): lines 99.67%,
  statements 98.58%, branches 93.78%, functions 100%. `engine/math` lines 100%,
  `engine/graph` lines 99.26% (thresholds 90% for both, 80% for the engine overall).
- Union benchmark: 500 rounded-rectangle road polygons (20 vertices each) unioned in 25.3 ms
  into 4352 border segments (budget: well under 1 s).
- `npm run build`: unchanged app, main chunk gzip 1.00 kB. `npm run e2e`: 1 passed.
- Delivered: `vec2.ts` (pure and allocation-free variants), `intersect.ts` (crossing, parallel,
  collinear overlap, endpoint touch, documented epsilons), `polygon.ts` (half-open ray-cast
  containment, true segment distance, classifySegment, splitParams, breakAtIntersections without
  mutation or zero-length pieces, union with outward-probe border test), `rng.ts` (mulberry32,
  fork, state save/restore), `bbox.ts`, `spatialHash.ts` (incremental, stamp-deduped queries),
  `point.ts`, `segment.ts`, `graph.ts` (stable ids, version counter, events, picking index,
  split, restore for undo, id-independent hash).

### Phase 2 (2026-11-07)

- `npm run verify`: typecheck 0 errors, lint 0 errors/0 warnings, 15 test files / 139 tests
  passed, build OK, e2e 2 passed (smoke, editor).
- Build: main chunk `index-*.js` 84.99 kB (gzip 26.62 kB), CSS 3.56 kB gzip.
- Coverage (src/engine): lines 99.54%, branches 90.15%.
- e2e `editor.spec.ts` covers: 4 clicks add 4 points (checked through `window.__ND__`), closing
  the loop, dragging a point, undo/redo of the drag, segment click and shift-click selection,
  one-way toggle, delete, undo, Alt+click split, stop marking placement, Shift+drag box select
  and delete (bound marking removed with its segment), undo of every step back to an empty world,
  redo of every step, and IndexedDB autosave surviving a reload.
- Screenshot `phase-2-editor-graph.png`: glass top bar (brand, Edit/Simulate/Train switch with
  the active thumb on Edit, 2D/3D switch with 3D disabled, World menu, help), left tool rail with
  the active-tool highlight on Roads, collapsed "World settings" panel, a closed rectangular loop
  of four roads drawn as dark asphalt bands with dashed white centre lines and rounded outer
  corners, the selected first point with a cyan fill and an amber dashed hover ring, and the
  bottom status bar (undo/redo, Snap chip, 100%, cursor position in metres, counts).
  `phase-2-editor-2d.png` (smoke) shows the empty editor with the world grid.
- Bug found and fixed while testing in the browser: hover state was refreshed only on pointer
  move, so a press without a preceding move (touch, pen, synthetic input) acted on the previously
  hovered point. Pointer-down now recomputes hover first.

### Phase 3 (2026-11-07)

- `npm run verify`: typecheck 0, lint 0, 16 test files / 152 tests, build OK, e2e 5 passed.
- Build: main chunk 119.52 kB (gzip 38.27 kB); the world generation worker is its own chunk.
- Coverage (src/engine): lines 99.6%; `engine/world` lines 99.76%.
- Generation timing (Vitest, Node, 200-segment grid): 95 ms total after optimisation (was
  165 to 270 ms). Browser: demo city (46 segments) 36 to 54 ms including hydration.
  Optimisation: a road envelope is the Minkowski sum of its centre segment and a disk, so
  building and tree clearance tests use distance to centre segments instead of
  polygon-vs-polygon tests.
- e2e `world.spec.ts`: demo city geometry counts, canvas variance, minimap click moves the camera
  and the minimap static layer is not redrawn per frame; dragging a point in a 325-segment world
  for 30 pointer moves: 242 frames sampled, average 17.0 ms, max 33.5 ms (earlier run: 16.7 / 16.8);
  a 580-segment world generates in the worker in 358 to 385 ms while frames keep flowing.
- Screenshot `phase-3-demo-city.png`: a jittered 6 by 5 grid city. Roads are dark asphalt with
  clean unioned borders (no seams at junctions), lighter sidewalk bands with curb lines, solid edge
  lines and dashed centre lines trimmed at junctions; amber arrows mark the one-way street on the
  middle row. Buildings are slate and ochre boxes leaning away from the screen centre with lit and
  dark sides, flat roofs with a parapet line, several pitched roofs, and soft offset shadows. Trees
  are layered green canopies clustered around the city edge. The minimap (bottom right in Edit
  mode) shows roads, buildings and trees with the white camera rectangle.
- Same seed gives identical counts and positions (unit test plus snapshot of counts).

### Phase 4 (2026-11-07)

- `npm run verify`: typecheck 0 (four projects now: app, test, node, engine), lint 0,
  19 test files / 175 tests, build OK, e2e 8 passed.
- Build: main chunk 142.31 kB (gzip 45.52 kB).
- Coverage (src/engine): lines 99.43% (osm 99.13%, markings 98.81%, io 98.51%).
- Unit tests added: traffic light grouping (one controller per junction, exactly one approach
  green or yellow at any time over 60 s), exact phase timing 6 / 1.5 / 0.5 s in simulation time,
  large time steps, standalone and dangling lights never throw, 150 ms lamp cross-fade, phase kept
  across rebuilds; stop state machine (full stop, at least 1 s wait, waits while the junction is
  blocked, overshoot handling); yield, crossing, parking, start, target helpers; OSM projection
  within 1% of haversine, 6-node / 2-way fixture (6 points, 5 segments, 3 one-way segments in way
  order), oneway yes/true/1/-1/no, roundabout, motorway, include-one-ways off, untagged and
  footway skipped, bridge and tunnel carried, buildings and water collected, missing nodes warned,
  non-Overpass input rejected with a helpful message, bundled sample > 50 segments; bundled
  worlds round trip with identical derived counts.
- e2e `osm.spec.ts`: World menu, Load sample OSM gives 92 segments and > 10 buildings; the OSM
  dialog rejects invalid JSON with an error toast, loads the sample, and imports it with one-ways
  disabled (0 one-way segments); the world library lists 2 autosaved worlds and reopens one.
  `editor.spec.ts` now also places a stop marking and checks it survives a reload.
- Screenshot `phase-4-osm-import.png`: the fictional OSM town at 10% zoom: a curving main street
  crossing eight side streets, a roundabout in the centre, dense building footprints along every
  street, trees filling the blocks, the minimap showing the whole town and the river crossing.
  Browser check of the signalised demo junction: three approaches red and one yellow, lamps with
  additive glow, stop lines and roadside housings; STOP text and octagon signs at the all-way stop.
- Bundled data: `public/worlds/grid-town.world.json` (4.1 KB), `ring-road.world.json` (3.0 KB),
  `osm-sample.osm.json` (21.4 KB synthetic Overpass JSON), `osm-sample.world.json` (6.6 KB),
  regenerated by `node scripts/make-worlds.ts`.

### Phase 5 (2026-11-07)

- `npm run verify`: typecheck 0, lint 0, 22 test files / 207 tests, build OK, e2e 9 passed.
- Build: main chunk 184.25 kB (gzip 60.18 kB).
- Coverage (src/engine): lines 98.21% (car 98.89%, nav 97.39%, sim 92.83%).
- 60 s headless traffic run on Grid Town (16 route-following cars, seed 7): 0 damage events
  (budget at most 5%), 29 trips completed, 5 parkings, 0 stuck respawns; deterministic per seed.
- 300-car step benchmark (5 rays each plus 14 traffic cars): 1.62 ms per step (budget 4 ms);
  6.2 ms under coverage instrumentation, where the documented ×3 allowance applies with a warning.
- Unit tests: course constants and per-second conversion (one 60 Hz step equals the course's
  0.15 u/step net gain), max-speed clamp then friction (steady state 2.95 u/step, like the course),
  friction to zero, reverse clamp, steering only while moving and inverted in reverse, polygon
  corners, braking flag, border damage, car-car damage, collision toggles; sensor wall at 75 with
  length 150 reads exactly 0.5; A* shortest path, one-way routing, unreachable goals; lane paths
  (right-hand offset, kerb-corner arcs, dead-end U-turn); route follower reaches the target in an
  L-shaped world without touching a border, stops at a stop line for at least 1 s then proceeds,
  obeys a red light; markings filtered to the driven lane; manual car driving and crashing;
  particles ring buffer.
- e2e `sim2d.spec.ts`: Tab enters Simulate, steps advance, more than 5 traffic cars move in 3 s,
  ArrowUp drives the manual car more than 50 units, Tab returns to Edit and the simulation stops.
  Average frame time in Simulate mode (headless, software rendering): 21.4 ms.
- Screenshot `phase-5-sim-2d.png`: Grid Town in Simulate mode: the white manual car with five
  glowing sensor rays (cyan clear, amber and magenta near hits), the dashed cyan route preview
  from the start marking (chequered strip, lime arrow) to the target, a pink traffic car, the HUD
  card (speed, traffic 14, parked, trips, collisions, FPS, sim ms) and the minimap with car dots.
- Bugs found and fixed through tests and traces: Bézier corners cut the inner kerb (replaced by
  arcs around the kerb corner with a minimum radius), node-based A* produced U-turns at T
  junctions (lane-based A* without U-turns), routes starting at a junction picked the crossing
  road (heading-aligned start lane), random destinations at junction centres (mid-block lane
  destinations), and a 1e9-radius spatial-hash query that scanned billions of empty cells
  (the hash now walks occupied cells for huge queries).

### Phase 6 (2026-11-07), tag v0.9-2d

- `npm run verify`: typecheck 0, lint 0, 23 test files / 223 tests, build OK, e2e 12 passed.
- Build: main chunk 224.30 kB (gzip 72.89 kB).
- Coverage (src/engine): lines 97.81% (ai 93.98%, sim 93.53%).
- Seeded evolution test on the infinite road (60 cars, 20 s generations): best fitness by
  generation 2514, 2536, 2547, 2551, 2551, 2551, 2551, 2558, 2558, 2558; generation 10 beats
  generation 1 and the best never decreases (identical traffic every generation plus elitism).
- City training test: 30 cars with traffic, tournament selection, seeded brain kept exactly in
  car 0, at least 2 generations in 20 simulated seconds, positive fitness.
- Unit tests: hand-computed feed-forward for step and tanh, topology guards, clone/copy,
  mutate(0) identity, mutate(1) in [-1, 1], small mutations stay within 0.2, uniform crossover,
  brain file round trip and validation, fitness trackers (axis, coverage that ignores revisits).
- e2e `training.spec.ts`: 50 cars at ×8 for 10 s reached generation 7 with best ever fitness
  153 m; the network panel animates; S saves the brain and it survives a reload. Infinite road:
  80 cars train on the endless road (best fitness > 100 units after 4 s at ×4), Tab returns to the
  city editor. `sim2d.spec.ts` now also checks that the network canvas changes between captures.
  `fps.spec.ts`: 2D Simulate in headless Chromium: frame 22.3 ms (threshold 33), render 1.8 ms,
  sim 0.58 ms. 2D Train with 300 AI cars plus 14 traffic: render 2.6 ms, sim 3.17 ms per frame,
  frame 38.6 ms in headless software rendering (informational).
- Screenshot `phase-6-train-2d.png`: Train mode in Grid Town at ×8, generation 7: the best car in
  lime with its rays near the route, a skid trail, traffic cars, the HUD (generation, alive 49,
  best and best-ever in metres, colour legend), the network panel with the live network (green
  firing outputs, warm and cool dashed connections, bias rings), the rising sparkline and the
  training controls. `phase-6-infinite-road.png`: the 3-lane road with dashed dividers, traffic
  cars ahead, the leading car in lime with rays and exhaust puffs, the panel in infinite mode.
- Performance fix found by profiling: the world-sized skid decal canvas was resampled every frame
  (about 10 ms in software rendering); replaced by sparse 512-unit tiles that exist only where
  marks are. Simulate-mode render time went from 11.4 ms to 1.4 ms.

### Phase 7 (2026-11-07)

- `npm run verify`: typecheck 0, lint 0, 23 test files / 224 tests, build OK, e2e 14 passed.
- Build: initial chunk 231.43 kB (gzip 75.36 kB); the 3D view is a separate on-demand chunk
  `threeRenderer-*.js` 620.80 kB (gzip 158.07 kB) loaded by `import()` the first time V is pressed.
- e2e `sim3d.spec.ts` (headless Chromium, renderer string "ANGLE (Google, Vulkan 1.3.0
  (SwiftShader Device (Subzero)), SwiftShader driver)", WebGL works without extra flags):
  nothing 3D is loaded before V; V crossfades to the 3D canvas; demo city scene build 32 ms
  (budget 300 ms); 36 draw calls including the shadow pass (budget 150), 34 006 triangles;
  camera chips and C cycle chase → orbit → top; picking a traffic car by its projected screen
  position makes it the focused car; `renderer.info.memory` is 14 geometries / 7 textures after 1
  and after 4 rebuilds (no leaks); V returns to 2D and the editor adds points again. A second test
  removes WebGL (`getContext` returns null): the app shows the "3D view unavailable" toast, stays in
  2D, and logs no console errors.
- Screenshot `phase-7-sim-3d-day.png`: aerial three-quarter view of the demo city in Simulate mode:
  instanced buildings with tiled window facades and pitched roofs, conifer cones and broadleaf
  icospheres, sidewalks, dashed centre lines and solid edges, traffic cars (amber, pink) and the
  cyan AI car with wheels and lights, soft sun shadows, the minimap showing the camera footprint,
  camera chips bottom right.
- Visual review fixes before committing: the first 3D frame read as night because the textures
  reused the dark 2D palette (now a daylight palette); car cabins rendered black (metal without an
  environment map); hidden camera chips stayed focusable (now `visibility: hidden`).
- Bug found from the screenshot's HUD: in Simulate mode the AI demo car spawned on top of the manual
  car and crashed on every respawn (generation 417 after 20 s). The manual car now waits 1.5 car
  lengths behind the Start; regression test `sim/simulate mode demo car`.
- Other e2e numbers this run: 2D Simulate frame 17.7 ms, 2D Train with 300 AI cars 36.6 ms
  (software rendering), drag in a 325-segment world 17.6 ms average.

## Known issues

- Training controls live inside `ui/panels/nnPanel.ts`; the spec's file list names a separate
  `trainingPanel.ts` (to be split out during Phase 9 polish). `settingsPanel.ts` arrives with the
  3D quality and time-of-day settings in Phase 8.
