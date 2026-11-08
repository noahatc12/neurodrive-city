# Progress

Status of every phase, the next step, known issues, and gate evidence.

## Status

| Phase | Title                                                              | Status      |
| ----- | ------------------------------------------------------------------ | ----------- |
| 0     | Scaffold and tooling                                               | done (2ac7d05) |
| 1     | Math, graph, spatial hash                                          | done        |
| 2     | 2D editor and viewport                                             | done        |
| 3     | World generation and 2D world rendering                            | pending     |
| 4     | Markings, save/load, OSM                                           | pending     |
| 5     | Cars, sensors, damage, traffic, navigation                         | pending     |
| 6     | Neural network, evolution, visualizer, infinite road (tag v0.9-2d) | pending     |
| 7     | 3D renderer foundation                                             | pending     |
| 8     | 3D polish, pre-trained brain, turbo worker                         | pending     |
| 9     | Stretch, accessibility, UX polish                                  | pending     |
| 10    | Docs, deploy readiness, final audit (tag v1.0.0)                   | pending     |

**Next:** Phase 3, world generation and 2D world rendering.

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

## Known issues

(none yet)
