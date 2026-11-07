# HackRPI-2026-MSM

Sebastian Brzozowski, Marco Svec, Matei Stoica

The active project is an ecological early-warning map connecting bird movement, weather-driven stopover conditions, tick observations, questing suitability, pathogen surveillance, and community exposure.

The project brief is [prompt.txt](prompt.txt) on the `prompt` branch. The new planning documents are based on commit `bd286e751e8638f76fb473fb812a152b0c5b4513` from November 7, 2026.

Read these in order:

1. [Project design and scope](docs/superpowers/specs/2026-11-07-ecological-early-warning-design.md) — product, four map layers, architecture, milestones, and acceptance criteria.
2. [Data sources and zero-cost operations](docs/superpowers/specs/2026-11-07-ecological-sources-and-operations.md) — source permissions, coverage, service limits, publishing, and deployment.
3. [Data model, spatial allocation, and API contracts](docs/superpowers/specs/2026-11-07-ecological-data-and-model.md) — proposed SQL, experimental equations, static payloads, and endpoints.
4. [Implementation plan](docs/superpowers/plans/2026-11-07-ecological-early-warning.md) — ordered tasks, interfaces, verification, and delivery gates.

Planning task: [issue #6](https://github.com/brzozs/HackRPI-2026-MSM/issues/6). Planning branch: `plan/ecological-early-warning`.

These documents describe the proposed implementation. The first map frontend is available in `web/`; live data integrations remain future work. The working product name is **VectorCast**, pending the team's choice. The previous Car Carbon Visualizer plans and prototype remain in their existing branches and pull requests as historical work. They do not define this project's requirements.

All contributors must read [AGENTS.md](AGENTS.md), claim an issue, use a task branch, and obtain an independent audit before merging a PR.

## Run the map frontend

Use Node.js 22.12 or newer (Node.js 24 LTS recommended). From the repository root:

```bash
npm --prefix web ci
npm --prefix web run dev
```

Open the local URL Vite prints. The React/TypeScript/Vite frontend now renders a full-screen MapLibre map with real country/state geography, 3D/2D/globe views, layer toggles, a playable seven-day sample timeline, zoom/reset controls and selectable state details. On mobile, use Map layers to select a state or change overlays.

Bird routes, animated bird markers, activity colors and timeline changes are synthetic interface previews. All live observations, weather, pathogen and community data remain unconnected and the drawer says so. State height is a fixed visual treatment, not a data metric. The preview calculates no health-risk score.

```bash
npm --prefix web test
npm --prefix web run typecheck
npm --prefix web run build
npm --prefix web run preview
```

`web/src/map/` owns the map renderer/style and its resource cleanup. `web/src/components/` contains the timeline and region drawer; `web/src/data/mapFrames.ts` supplies clearly marked synthetic display fixtures. The small view types remain separate from the future published API/snapshot contracts. `web/public/data/README.md` records geography sources, vintages and terms. Boundaries and UI fonts are bundled locally; no API key or tile subscription is required.

The map respects reduced motion and provides a static geography fallback when WebGL cannot start. Keyboard users can select states through the region selector. Source connectivity and a validated ecological model are future increments.

Framework task: [issue #8](https://github.com/brzozs/HackRPI-2026-MSM/issues/8). Map frontend task: [issue #9](https://github.com/brzozs/HackRPI-2026-MSM/issues/9). No backend, service accounts or deployment are needed for this local preview.
