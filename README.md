# HackRPI-2026-MSM

Sebastian Brzozowski, Marco Svec, Matei Stoica

The active U.S.-only VectorCast experience has two layers: bird activity/stopover conditions, and tick observations/questing weather/conditional bird-mediated deposition. Its [connected-evidence model](docs/connected-ecology.md) separates observations, forecasts and experimental inference; pathogens, exposure, accounts and alerts are outside this implementation.

The project brief is [prompt.txt](prompt.txt) on the `prompt` branch. The new planning documents are based on commit `bd286e751e8638f76fb473fb812a152b0c5b4513` from November 7, 2026.

Read these in order:

1. [Project design and scope](docs/superpowers/specs/2026-11-07-ecological-early-warning-design.md) — product, four map layers, architecture, milestones, and acceptance criteria.
2. [Data sources and zero-cost operations](docs/superpowers/specs/2026-11-07-ecological-sources-and-operations.md) — source permissions, coverage, service limits, publishing, and deployment.
3. [Data model, spatial allocation, and API contracts](docs/superpowers/specs/2026-11-07-ecological-data-and-model.md) — proposed SQL, experimental equations, static payloads, and endpoints.
4. [Implementation plan](docs/superpowers/plans/2026-11-07-ecological-early-warning.md) — ordered tasks, interfaces, verification, and delivery gates.

Planning task: [issue #6](https://github.com/brzozs/HackRPI-2026-MSM/issues/6). Planning branch: `plan/ecological-early-warning`.

These documents describe the broader proposed implementation. The map frontend in `web/` now loads published public-source ecology snapshots from `pipeline/`; hosted automatic updates are prepared but not activated. The working product name is **VectorCast**, pending the team's choice. The previous Car Carbon Visualizer plans and prototype remain in their existing branches and pull requests as historical work. They do not define this project's requirements.

All contributors must read [AGENTS.md](AGENTS.md), claim an issue, use a task branch, and obtain an independent audit before merging a PR.

## Run the map frontend

Use Node.js 22.12 or newer (Node.js 24 LTS recommended). From the repository root:

```bash
npm --prefix web ci
python3 -u -m pipeline.measured_migration
python3 -m pipeline.publish
npm --prefix web run dev
```

Prepare a collected national snapshot first using the [pipeline instructions](pipeline/README.md); publication excludes all collection caches and credentials. Open the local URL Vite prints. The existing React/TypeScript/Vite map keeps its original layout, real geography, layer toggles, manually selected forecast dates, zoom/reset controls and compact state details. On mobile, use Map layers to select a state or change overlays.

State heights, colors and local surfaces show an experimental **0–100 questing-weather index**, with explicit unsupported species coverage. Measured radar is separate evidence for conditional stopover/deposition scenarios; it no longer raises current questing. State evidence shows regional bird/tick reports, dates, sources, habitat coverage and model contributions in an opt-in details view. See [model assumptions, biology and limits](docs/connected-ecology.md). Run `npm --prefix web run prepare:data` after collecting an atlas to attach radar and bounded cached land-cover references, calculate components and publish them together.

Birds follow [sourced illustrative migration corridors](docs/migration-routes.md) between named breeding and wintering regions, passing through geographic waypoints with route-based headings. State focus keeps the same corridors; blackpoll warblers use different spring and fall paths. Hover over the migration legend for departure/destination regions. These are approximate examples, separate from all biological model inputs. State selection loads actual weather heatmaps, simple county/city labels, bird/tick report counts and compact weather details. Source timestamps remain in the published data; the map omits the stale-weather banner. Unavailable inputs and original source age stay visible. The existing animations and map layout are preserved.

```bash
npm --prefix web test
npm --prefix web run typecheck
npm --prefix web run build
npm --prefix web run preview
```

`web/src/map/` owns map rendering and cleanup. `web/src/data/ecologyData.ts` loads/validates the public atlas and prepares state values; `pipeline/contracts.ts` defines its contract. `web/src/data/mapFrames.ts` retains the original illustrative flight helpers. `web/public/data/README.md` records geography provenance. Boundaries and fonts are bundled; the eBird key stays backend-only.

Map animations run while the page is visible, including when the browser requests reduced motion. Bird animation pauses while its layer is disabled or the page is hidden. The map provides a static geography fallback when WebGL cannot start. Keyboard users can select states through the region selector. The [twice-daily refresh workflow and activation requirements](pipeline/README.md#display-and-refresh-the-map) are documented separately; the model remains experimental.

Framework task: [issue #8](https://github.com/brzozs/HackRPI-2026-MSM/issues/8). Map frontend task: [issue #9](https://github.com/brzozs/HackRPI-2026-MSM/issues/9). Real-data integration: [issue #13](https://github.com/brzozs/HackRPI-2026-MSM/issues/13). Local snapshots work without a hosted database; scheduled publication still needs deployment setup.
