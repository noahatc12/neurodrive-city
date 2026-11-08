# Progress

Status of every phase, the next step, known issues, and gate evidence.

## Status

| Phase | Title                                                              | Status      |
| ----- | ------------------------------------------------------------------ | ----------- |
| 0     | Scaffold and tooling                                               | in progress |
| 1     | Math, graph, spatial hash                                          | pending     |
| 2     | 2D editor and viewport                                             | pending     |
| 3     | World generation and 2D world rendering                            | pending     |
| 4     | Markings, save/load, OSM                                           | pending     |
| 5     | Cars, sensors, damage, traffic, navigation                         | pending     |
| 6     | Neural network, evolution, visualizer, infinite road (tag v0.9-2d) | pending     |
| 7     | 3D renderer foundation                                             | pending     |
| 8     | 3D polish, pre-trained brain, turbo worker                         | pending     |
| 9     | Stretch, accessibility, UX polish                                  | pending     |
| 10    | Docs, deploy readiness, final audit (tag v1.0.0)                   | pending     |

**Next:** finish Phase 0 gate and commit.

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

(filled per phase)

## Known issues

(none yet)
