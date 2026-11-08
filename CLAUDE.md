# NeuroDrive City: working notes for Claude

Portfolio-grade TypeScript app: an editable virtual city whose self-driving cars learn to
drive with a from-scratch neural network + evolution, shown in a 2D Canvas editor and a
3D Three.js view. Original implementation inspired by Radu Mariescu-Istodor's freeCodeCamp
courses (credited in README). **Never copy code from the course repos.**

## Resume protocol (after a restart or context compaction)

1. Read this file, then `PROGRESS.md` (phase status, next step, known issues), then
   `DECISIONS.md`.
2. Re-run the Verification Gate for the last completed phase (`npm run verify`).
3. Continue with the next unchecked task in `PROGRESS.md`.

## Verification Gate (after every phase; all must pass before committing)

```
npm run typecheck   # tsc strict, three projects (app, node/e2e, engine-without-DOM)
npm run lint        # eslint flat config, typescript-eslint recommended-type-checked
npm run test        # vitest
npm run build       # vite build; report main-chunk gzip size
npm run e2e         # playwright (Chromium) against `vite preview` under /neurodrive-city/
```

`npm run verify` runs all five in order. Inspect `e2e/__screenshots__/phase-N-*.png`
yourself and describe them in PROGRESS.md. A blank/black canvas is a failure.

## Hard rules

- Do not ask the owner questions; log ambiguous choices in `DECISIONS.md`.
- Never weaken a check (no `.skip`, `.only`, loosened lint, deleted tests) to get green.
- Scope discipline: extras go to `BACKLOG.md`.
- `src/engine/**` has **no** DOM / Canvas / Three.js imports and no `Math.random()`
  (enforced by ESLint and by `tsconfig.engine.json`, which has no DOM lib).
- Runtime dependency: `three` only. No external assets (models, textures, fonts, CDNs).
- TypeScript strict, no `any`, no `@ts-ignore`. `@ts-expect-error` (with reason) only in tests.
- Relative imports use explicit `.ts` extensions so the engine runs under plain Node 24
  (`node scripts/train.ts`) as well as Vite, Vitest and Web Workers.
- Zero allocations in per-car-per-step and per-frame render code: preallocate and reuse.
- Commit per phase with a conventional message; never commit a red gate; never force-push.

## Layout

- `src/engine`: pure simulation (math, graph, world gen, markings, car, ai, nav, osm, sim, io)
- `src/render2d`, `src/render3d`: renderers implementing `Renderer` (read-only snapshots)
- `src/editor`, `src/ui`, `src/viz`, `src/anim`, `src/app`, `src/workers`, `src/debug`
- `tests/` mirrors `src/engine`; `e2e/` holds Playwright specs.

## Conventions

- World coords: x right, y down (canvas). 3D maps (x, y) → (x, 0, y), Y up. 1 unit ≈ 0.1 m.
- Car heading 0 = up (−y); positive angle turns left (counter-clockwise on screen).
- Physics constants are stored per second (course per-step values × 60 / × 3600).
- Fixed simulation step dt = 1/60 s; speed multiplier changes steps per frame, never dt.
