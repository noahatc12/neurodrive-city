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
| 8     | 3D polish, pre-trained brain, turbo worker                         | done        |
| 9     | Stretch, accessibility, UX polish                                  | done        |
| 10    | Docs, deploy readiness, final audit (tag v1.0.0)                   | done        |

**Next:** v1.0.0 is complete. Ideas beyond the Definition of Done are in `BACKLOG.md`.

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

### Phase 8 (2026-11-07)

- `npm run verify`: typecheck 0, lint 0, 26 test files / 236 tests, build OK, e2e 16 passed.
- Build: initial chunk 238.59 kB (gzip 77.31 kB); lazy 3D chunk 674.44 kB (gzip 172.20 kB).
- 3D in headless Chromium (SwiftShader): 77 draw calls by day with shadows and bloom (High),
  65 at night; `renderer.info.memory` 32 geometries / 18 textures after 1 and 4 rebuilds; demo
  city scene build 38 ms. Draw calls now show in the HUD ("Draw calls").
- New: sensor rays as one additive `LineSegments` (cyan to magenta by hit distance) with glowing
  hit sprites; exhaust, smoke and spark point clouds; skid-mark ring-buffer mesh faded in the
  shader; instanced headlight cones plus a real spot light on the focused car; 3D markings (signs
  with Canvas-text faces, zebra stripes, parking bays, light poles with three emissive lamps, start
  arch, target beam with rotating ring); street lights; shader sky with sun glow and stars;
  day/night driven by one time-of-day value (slider, auto cycle, L toggles with an 1.8 s tween);
  bloom composer (RenderPass, UnrealBloomPass, OutputPass with ACES); Low/Medium/High presets
  with an auto-downgrade governor; the 3D settings panel; cinematic camera.
- Unit tests: camera blends are continuous and eased (sampled at 60 Hz, the largest step stays
  under 4x the average; first frame under 20% of a mid-blend frame), chase damping agrees at 30,
  60 and 120 Hz within 12 units, FOV kick 55 to over 62 degrees at full speed (none with reduced
  motion), reduced motion shortens blends to a third, cinematic glides between cars. Quality
  governor: downgrade after 3 s over 20 ms, never for fast frames, short hitches or when off.
- Pre-trained brain (`npm run train`, seeded, reproduces byte for byte, about 60 s): 400 cars,
  tournament selection, 120 generations; elites validated alone every 10 generations; shipped
  the generation-10 elite: best fitness 10 591 units, validation 1059 m in 60 s, 11 overtakes, no
  damage. Test `ai/pre-trained brain`: drives 60 s on its seeded training road without damage,
  more than 300 m, more than 3 overtakes. A first configuration (course selection, 200 cars)
  produced a brain that tailed traffic with zero overtakes; the validation step caught it.
- Turbo training (G8): e2e `training.spec.ts` ticks Turbo on the infinite road; the worker
  reached generation 9 within about 2 s (best 262 m in 15 s generations); unticking hands back
  the best brain, the visible population restarts from it and a toast reports the run.
- Screenshots: `phase-8-sim-3d-day.png` (aerial demo city by day, as in Phase 7, now with the
  3D markings, the start arch, street-light posts and the settings panel above the camera chips);
  `phase-8-sim-3d-night.png` (22:19: the AI demo car with bloomed cyan rays and white hit sprites,
  its headlight cone, warm street-light pools along the road, about a third of the windows lit and
  glowing, the checkered start arch, the HUD showing 65 draw calls).
- Visual review fixes: nearly every window was lit and some speckled (sine hash on SwiftShader;
  replaced with a sine-free hash); glow toned down; night lacked light sources at street level
  (street lights added).

### Phase 9 (2026-11-07)

- `npm run verify`: typecheck 0, lint 0, 27 test files / 240 tests, build OK, e2e 23 passed.
- Build: initial chunk 246.48 kB (gzip 79.77 kB); lazy 3D chunk 681.41 kB (gzip 173.89 kB).
- OSM buildings and water (J6): footprints are stored in the world file's `features`, replace
  procedural buildings, are solid for cars, render as N-gon pseudo-3D blocks in 2D and extruded
  walls in 3D; water is a 2D layer and a glossy 3D mesh, and keeps buildings and trees out. The
  bundled sample town now carries 32 footprints and a river (9.7 KB file). Tests:
  `world/OSM features (J6)` (4 tests: replacement and exclusion, determinism and version bump,
  save/load round trip with validation, the bundled sample), e2e `3D OSM sample` (footprints > 5,
  one water mesh, draw calls under 150).
- AI navigation (F5): a Train-mode toggle in city worlds adds the waypoint-angle and speed inputs
  (topology [7, 6, 4]); nav brains import and export with their input names. Headless results in
  Grid Town (`node scripts/train-nav.ts`): step activation 28% of the route with and without route
  inputs (200 cars, 40 generations); tanh 7% without and 24% with route inputs (400 cars, 80
  generations). Nothing passes the first corner, so route following stays the default demo
  (documented in the README; curriculum training in BACKLOG).
- Onboarding: a 4-step coach-mark tour (toolbar, mode switch, 2D/3D toggle, world menu), keyboard
  driven (Enter or arrow keys, Esc skips), stored in localStorage, replayable from Help.
- Accessibility and UX: automated check that every visible control has an accessible name;
  keyboard focus shows a ring; 1280×720 layout has no overlapping panels and no horizontal scroll
  in Edit and Simulate; reduced motion shortens transitions and camera blends (and removes speed
  lines, wind sway and the FOV kick); uncaught errors show the error overlay with Copy details.
  `trainingPanel.ts` split out of `nnPanel.ts`.
- Bugs found by the new specs and screenshots: training controls showed in Simulate mode (the
  `hidden` attribute lost to a CSS `display` rule; fixed globally); `#app` was a live region (every
  HUD change would be announced); faint text was 3.3:1 (now 5.1:1).
- Screenshots: `phase-9-tour.png` (step 1 of 4 ringing the toolbar, card with Skip, Back, Next);
  `phase-9-layout-1280x720.png` (Simulate in Grid Town at 1280×720: HUD, minimap, network panel
  without training controls, nothing overlapping); `phase-9-osm-import.png` (the sample town in 2D
  with imported footprints along the streets and the blue river crossed by bridges);
  `phase-9-osm-3d.png` (aerial 3D view over the river: water, bridges, extruded footprints next to
  procedural buildings, trees kept out of the water).

#### Manual checklist (Lighthouse-style)

| Area | Check | Result |
| ---- | ----- | ------ |
| Accessibility | Every visible button, input and select has an accessible name | Pass (automated in `a11y.spec.ts`) |
| Accessibility | Keyboard: Tab reaches the controls, focus ring visible, Esc closes dialogs and the tour | Pass (the World menu gains Esc and arrow keys in Phase 10) |
| Accessibility | Dialogs use `role="dialog"` or `alertdialog` with `aria-modal` and a label; toasts are a polite live region; canvases are `role="img"` with labels | Pass |
| Accessibility | Contrast: text 15.0:1, dim text 6.8:1, faint text 5.1:1, cyan accent 9.8:1 on panels | Pass (WCAG AA) |
| Accessibility | `prefers-reduced-motion`: shorter transitions, camera blends a third as long, no speed lines, FOV kick or wind sway | Pass (automated check for the flag and transition time) |
| Best practices | Zero console errors and page errors in every e2e spec | Pass (shared fixture) |
| Best practices | No external requests: no CDNs, fonts, textures or models; Three.js is the only runtime dependency | Pass |
| Best practices | Uncaught errors show an overlay with Copy details instead of a frozen canvas | Pass (automated) |
| Performance | Initial JS under 200 KB gzip; Three.js loaded on demand | Pass (about 78 KB) |
| Performance | 3D draw calls under 150 in the demo city | Pass (77 by day, 65 at night) |
| SEO and metadata | `lang`, viewport, description, colour scheme, title, favicon, `noscript` | Pass |
| Responsive | 1280×720 without overlap or horizontal scroll; top bar collapses to icons under 1100 px; panels collapse | Pass (automated at 1280×720) |
| Responsive | Touch: one-finger pan and pinch zoom in 2D | Pass (implemented in Phase 2; best effort on phones) |

### Phase 10 (2026-11-07), tag v1.0.0

- `npm run verify`: typecheck 0, lint 0, 27 test files / 240 tests, build OK, e2e 24 passed.
- Build under the Pages base path (`VITE_BASE=/neurodrive-city/`, as the e2e web server runs it):
  initial chunk 247.04 kB (gzip 79.92 kB); lazy 3D chunk 681.41 kB (gzip 173.89 kB).
- Coverage (`npm run test:coverage`): all engine files 97.72% lines (ai 91.3, car 100, graph 99.33,
  io 98.65, markings 99.22, math 100, nav 97.99, osm 99.14, sim 94.77, world 99.81).
- Docs: README rewritten (features, five Mermaid diagrams, "Beyond the course", honest AI
  navigation results, controls, tech stack, measured performance, testing, deploy, GIF capture,
  roadmap, acknowledgements); `COMPARISON.md` with one row per baseline line (15 rows, each with
  evidence); `docs/media/` holds the Playwright screenshots used by the README.
- Polish: the World menu works from the keyboard (arrows, Home, End, Esc returns focus), entering
  Simulate eases the 2D camera to your car instead of cutting, and mode switches crossfade the view.

#### Definition of Done audit

| Item | Status | Evidence |
| ---- | ------ | -------- |
| `npm run verify` green | Done | Phase 10 gate above |
| CI and deploy workflows present; build works under `/neurodrive-city/` | Done | `.github/workflows/ci.yml`, `deploy.yml`; e2e runs the production build under that base |
| Features A1 to L5 and M (partial only F5, J6, L2 speed lines) | Done | Feature audit below; F5 works but does not learn turns (documented), J6 complete, 3D speed lines in BACKLOG |
| `COMPARISON.md`, one row per baseline line | Done | 15 rows |
| Engine coverage at least 80% | Done | 97.72% lines |
| Screenshots editor-2d, sim-2d, sim-3d-day, sim-3d-night, osm-import in `docs/media/` | Done | plus osm-3d, train-2d, infinite-road, tour |
| Zero console errors | Done | Shared fixture fails any spec on `console.error` or a page error |
| Performance budgets measured | Done | README "Performance"; 300-car step 1.6 ms, 77 draw calls, initial JS about 80 KB gzip |
| Pre-trained brain in `public/brains/` | Done | `pretrained.brain.json`, test drives 60 s without damage |
| README complete | Done | All sections listed in the spec |
| BACKLOG complete | Done | `BACKLOG.md` |
| At least 11 phase commits; tags v0.9-2d and v1.0.0 | Done | 11 commits (phases 0 to 10); tags applied |

#### Feature audit (spec A to M)

| Group | Items | Status |
| ----- | ----- | ------ |
| A Engine foundations | A1 vectors, A2 intersections, A3 polygons, A4 graph, A5 spatial hash | Done (math 100%, graph 99% lines) |
| B Editor | B1 graph tool, B2 grid snap, B3 undo/redo, B4 viewport, B5 markings, B6 dispose, B7 shortcuts, B8 segment tools, B9 settings and layers | Done |
| C World generation | C1 envelopes, C2 union borders, C3 surfaces, C4 markings, C5 buildings, C6 trees, C7 version-gated regeneration and worker, C8 sidewalks | Done |
| D Markings | D1 stop, D2 yield, D3 crossing (pedestrians optional: in BACKLOG), D4 parking, D5 lights, D6 start and target | Done |
| E Cars | E1 kinematics, E2 control sources, E3 polygon and damage, E4 sensors | Done |
| F Navigation | F1 lane graph, F2 A*, F3 route follower, F4 traffic | Done |
| F5 AI navigation (stretch) | Toggle, route inputs, documented experiments | Partial, as allowed: does not pass the first corner |
| G Neural network | G1 network, G2 mutation, G3 parallel training, G4 fitness, G5 generations, G6 persistence and pre-trained brain, G7 infinite road, G8 turbo worker | Done |
| H Visualizer | H1 panel, H2 weight colours, H3 bias rings and activations, H4 header and sparkline, H5 at most 30 Hz when visible | Done |
| I Minimap | I1 canvas minimap, I2 click or drag to move the camera (2D and 3D), I3 cached static layer | Done |
| J Save, load, OSM | J1 world JSON and IndexedDB library, J2 files and drag-and-drop, J3 dialog, J4 parser, J5 progress overlay, J6 buildings and water | Done (J6 stretch complete) |
| K 3D | K1 lazy load and fallback, K2 ground and roads, K3 buildings, K4 trees, K5 cars, K6 sensors, K7 markings, K8 lighting and day/night, K9 cameras, K10 bloom and presets, K11 picking | Done |
| L Effects | L1 easing, L2 particles (3D speed lines optional: in BACKLOG), L3 UI motion, L4 2D polish, L5 visual style | Done |
| M Layout | Top bar, toolbar, right panel, minimap, camera chips and quality preset, HUD legend, onboarding tour, 1280×720 | Done |

## Known issues

- The bundled brain is a highway weaver (rays only); in city worlds the Simulate demo car still
  crashes at corners. AI navigation (F5) exists but does not yet learn turns (documented).
- A few windows still show a fine speckle in software rendering (SwiftShader texture filtering of
  the emissive mask); not seen in the hardware renderer.
