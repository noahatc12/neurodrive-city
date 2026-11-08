# NeuroDrive City

An editable virtual city where self-driving cars learn to drive with a from-scratch neural
network and evolutionary training, shown in a crisp 2D editor and a cinematic 3D view.

> Work in progress. See [PROGRESS.md](PROGRESS.md) for the current phase.

## Quick start

```bash
npm ci
npm run dev
```

## Scripts

| Script              | What it does                                           |
| ------------------- | ------------------------------------------------------ |
| `npm run dev`       | Vite dev server                                        |
| `npm run build`     | Production build (`VITE_BASE` sets the base path)      |
| `npm run typecheck` | Strict TypeScript across app, node and engine projects |
| `npm run lint`      | ESLint (typescript-eslint, type-checked)               |
| `npm run test`      | Vitest unit tests                                      |
| `npm run e2e`       | Playwright end-to-end tests against a production build |
| `npm run verify`    | All of the above, in order                             |

## Acknowledgements

Inspired by Radu Mariescu-Istodor's freeCodeCamp courses "Self-Driving Car with JavaScript
(No Libraries)" and "Build a Virtual World Filled with Self-Driving Cars" (repositories
gniziemazity/self-driving-car and gniziemazity/virtual-world, MIT licensed). This project is
an independent re-implementation in TypeScript; no code was copied.

## License

MIT, see [LICENSE](LICENSE).
