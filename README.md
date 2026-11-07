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

These documents propose the implementation; no application has been built on this branch. The working product name is **VectorCast**, pending the team's choice. The previous Car Carbon Visualizer plans and prototype remain in their existing branches and pull requests as historical work. They do not define this project's requirements.

All contributors must read [AGENTS.md](AGENTS.md), claim an issue, use a task branch, and obtain an independent audit before merging a PR.
