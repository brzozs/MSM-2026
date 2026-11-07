# Car Carbon Visualizer Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task; use superpowers:subagent-driven-development only when delegated implementation is explicitly chosen. Track steps with the checkboxes below. Every contributor must read AGENTS.md and the linked specification first.

**Goal:** Build a one-day car/engine visualizer that connects interactive modifications and modeled tailpipe CO2 to a Databricks-backed U.S. fleet scenario.

**Architecture:** A Next.js client renders the car and controls; one pure TypeScript calculation core supplies browser readings and server reference-drive comparisons. A server-only route executes parameterized Databricks SQL against a sourced national baseline. Keep the scene, calculation core, and national-data adapter separate so teammates can work without shared-file conflicts.

**Tech Stack:** Next.js App Router, React, TypeScript, Three.js/React Three Fiber, Drei, CSS, Vitest, Playwright, Databricks SQL/Delta. Use Node.js 24 and lock compatible stable dependency versions when scaffolding.

**Spec:** [Car Carbon Visualizer design](../specs/2026-11-07-car-carbon-visualizer-design.md).

**Planning issue:** [#2](https://github.com/brzozs/HackRPI-2026-MSM/issues/2). Branch: `plan/car-carbon-visualizer`. This branch contains planning material only.

## Global constraints

- One-day build; CO2 only; one generic gasoline car with a moving four-cylinder engine cutaway.
- Preserve all 14 preset modifications, including helpful and harmful options; no fixed additive CO2-saving percentages.
- SI units internally, descriptive unit-bearing names, one shared model, and the exact stock/modification defaults and 120-second trace in the spec.
- National baseline is 2023 gasoline passenger cars and light-duty trucks, 976.0 million metric tons of CO2; all estimates disclose scope, source, and extrapolation assumptions.
- The accepted mockup is a first draft that needs visual refinement; its numbers and its initially fitted parts are not production defaults.
- All implementation runs on issue-owned task branches and enters main through a PR with an independent current-diff audit; no renewed direct-to-main exception.
- No application implementation, AGENTS.md edits, deployment, push, or merge is performed by this documentation commit.

## Review focus

1. **Conflicting or forged selections:** normalize the client UI, reject invalid API inputs, and compute the scenario server-side (Tasks 1, 3, 4).
2. **Idle/braking/stop-start:** prevent negative rates, account for restart fuel exactly once, and avoid divide-by-zero readouts (Tasks 1, 2).
3. **Background tabs and held inputs:** release pedals, freeze paused simulation, and avoid huge elapsed-time jumps or multiple animation loops (Tasks 2, 4).
4. **Cold or failed Databricks requests:** show explicit status, hide stale scenario results, and preserve the independent Car lab (Tasks 3, 4).
5. **Lost context or inaccessible visuals:** preserve builds across tabs, make harmful results unambiguous, and retain controls without WebGL (Tasks 2, 4, 5).

## Work split and kickoff

Use three lanes: model/contracts owner, scene/UI owner, and national-data owner. Owners choose their personal assignments in GitHub Issues before implementation. Model owner controls shared types and package/lock files during scaffold; later dependency edits require coordination.

Create one implementation issue per task below, with acceptance criteria copied from the task. Claim issues before edits, record progress and handoffs there, and use separate branches/worktrees for concurrent changes. Plan reviews and checkpoints do not replace PR audits.

- [ ] Start Databricks Free Edition signup immediately. Configure a SQL warehouse and private server environment, then verify `SELECT 1` through the intended server connection. Record success or the actual blocker in the data task issue. Do not paste tokens into GitHub or chat.
- [ ] Freeze shared names and units from Task 1 before Tasks 2-4 integrate. The scene can prototype geometry while the contracts are being established.
- [ ] Prove the full path using stock, wheel covers, and a roof cargo box before adding the rest of the catalog.

## Task 1: Shared calculation core and contracts

**Deliverable:** A small, tested calculation package that works identically in the client and Node server.

**Files:** Scaffold `package.json`, Next.js/TypeScript configuration, and minimal `src/app` files. Own `src/features/vehicle/{types,modifications,emissions-model,reference-drive}.ts` and focused adjacent unit tests. Add scripts `dev`, `build`, `start`, `lint`, `typecheck`, `test`, and `test:e2e`; add generated Node/Next output patterns and a sanitized `.env.example` to the existing ignore/setup conventions without changing AGENTS.md.

**Interfaces:** Export the following from the vehicle feature. Names and unit-bearing fields are shared contracts:

- `ModificationId`: the exact 14 IDs in the spec; `MODIFICATION_CATALOG` defines category, parameter effects, exclusive slot, visible/highlight target, assumption note, and mechanism source link.
- `VehicleParameters`: the named physical/default parameters in the spec, with SI units in property names; `resolveVehicleParameters(modificationIds)` produces the fitted set in canonical catalog order.
- `EngineState`: running/off, stationary duration, and restart transition state; `VehicleSample` includes `elapsedSeconds`, `speedMetersPerSecond`, `accelerationMetersPerSecondSquared`, and `propulsionRequested`. Derive propulsion intent from the accelerator with brake precedence in free driving, and positive acceleration or nonzero speed in the reference drive; restart on intent or vehicle motion.
- `stepVehicleEmissions(parameters, engineState, sample, timeStepSeconds)` returns next engine state, `fuelLiters`, `co2Grams`, and `co2GramsPerSecond`. Engine animation does not own these values.
- `compareReferenceDrive(modificationIds)` returns `stockCo2Grams`, `modifiedCo2Grams`, `emissionsRatio`, `modelVersion`, and `referenceDriveVersion` for `mixed-reference-v1`.
- Define `FleetImpactRequest` and `FleetImpactResponse` as specified in Task 3 in a shared type file without importing server code into the browser.

- [ ] Write failing unit tests for the stock/reference identity, gallon-to-CO2 conversion, fuel integration, negative acceleration, stop-start/restart, and exclusive-slot inputs. Assert that 1 U.S. gallon gives 8,887 g of CO2 and that a stock comparison ratio is exactly 1.
- [ ] Run `npm test -- src/features/vehicle` and confirm the tests fail for the missing behavior.
- [ ] Implement stock parameters, all 14 catalog effects, pure emissions stepping, and the spec's reference drive at fixed 0.05-second steps. Set model version `illustrative-v1`. Validate IDs and incompatible slots explicitly; UI replacement behavior belongs to Task 4.
- [ ] Add checks that combined selection ordering does not change results, aero benefits grow between 15 and 60 mph when other conditions match, excess cargo raises accelerating demand, and stop-start saves fuel over sufficiently long idle intervals while charging its restart pulse once.
- [ ] Run the focused tests, `npm run typecheck`, and `npm run build`. Commit the tested core and exact interfaces on its task branch, recording commands/results in its issue.

## Task 2: Orbitable car and animated engine

**Deliverable:** A recognizable technical sedan with working body/cutaway/engine views and visual changes for the catalog.

**Files:** Own `src/features/scene/{CarScene,CarBody,EngineAssembly,ModificationMeshes}.tsx` and scene-specific styles. Do not import Databricks code or mutate the calculation core.

**Interfaces:** `CarScene` accepts `modificationIds`, `speedMetersPerSecond`, `engineRpm`, `engineIsRunning`, `simulationTimeSeconds`, `viewMode` (`body | cutaway | engine`), `isPaused`, and a view-change callback. It consumes model state and never calculates CO2. React Three Fiber owns the only render loop; camera controls use Drei.

- [ ] Build the procedural sedan with smooth proportions, real wheel openings, separate hood/body panels, windshield/cabin, wheels, and exhaust. No external car asset or B58-project code is required.
- [ ] Add Body, Cutaway, and Engine camera targets, drag orbit, bounded zoom, and reset camera. Keep the engine inside the hood in Body view and fully readable in the focused view.
- [ ] Implement paired crank/piston movement, connecting-rod orientation, cam/valve motion, and firing highlights for the generic four-stroke 1-3-4-2 order. Label the slowed inspection animation. Respect pause, engine-off, and reduced-motion states.
- [ ] Connect all visible mesh/material changes and engine-region highlights to the catalog. A cargo box includes the rack; tire choices change wheel/tire appearance; engine-off stops the mechanism.
- [ ] Add a browser flow proving that switching views retains fitted parts and uses one live canvas. Check that stop-start/off and pause freeze internal motion, reduced motion is respected, and lack of WebGL produces a clear fallback with usable controls. Capture the three views for independent review; run typecheck/build and commit on the scene branch.

## Task 3: Sourced Databricks data and fleet endpoint

**Deliverable:** National results calculated against real imported data using Databricks, reachable through a server-only Next.js route.

**Files:** Own `data/us-gasoline-vehicle-co2.csv`, `databricks/prepare_vehicle_emissions.py`, `src/server/databricks.ts`, `src/app/api/fleet-impact/route.ts`, and focused route tests. Update `.env.example` only after coordinating ownership with the scaffold owner.

**Interfaces:** `POST /api/fleet-impact` accepts `FleetImpactRequest` (`modificationIds`, `adoptionPercent`). `FleetImpactResponse` contains canonical `modificationIds`, `adoptionPercent`, `modelVersion`, `referenceDriveVersion`, `sourceYear`, `sourceScope`, `sourceUrl`, `baselineAnnualCo2MetricTons`, `projectedAnnualCo2MetricTons`, `avoidedAnnualCo2MetricTons`, `baselineCo2MetricTonsPerSecond`, `projectedCo2MetricTonsPerSecond`, and `avoidedCo2MetricTonsPerSecond`. Use HTTP 400 `{ error: string }` for invalid input and HTTP 503 `{ error: string }` for unavailable configuration/upstream results.

- [ ] Verify the official Table 3-13 gasoline car/light-truck cells, record provenance in the CSV, and load its 14 observations for 1990, 2005, and 2019-2023. Keep checked-in source values in their reported million-metric-ton units.
- [ ] In the notebook, create `workspace.carbon_lab.raw_vehicle_emissions` and `workspace.carbon_lab.vehicle_co2_baseline`, validate unique year/category/fuel keys and complete numeric values, convert to metric tons, and preserve source metadata. Verify that 2023 totals 976,000,000 metric tons of CO2.
- [ ] Write failing route tests for stock/zero/full/partial adoption, harmful builds, malformed selections, and Databricks failure. A fixture baseline of 100 with ratio 0.9 and adoption 50% must project 95; ratio 1.1 must project 105.
- [ ] Implement the server adapter with the three server-only environment variables in the spec. Use parameterized Statement Execution SQL, inline JSON results, a 10-second SQL wait with cancellation, and a 15-second HTTP deadline. No user SQL, public tokens, or frame-frequency queries.
- [ ] Recompute the reference ratio from allowed IDs on the server, query the 2023 baseline and fleet projection in Databricks, and return unit-bearing fields. Fail on missing rows, mismatched units, or incomplete results rather than inventing zeros.
- [ ] Run route tests and an actual warehouse smoke test. Confirm the browser receives only application JSON, not credentials, statement internals, or authentication headers. Record live-test evidence in the issue, then commit the data pipeline and route.

## Task 4: Assemble both screens and the reference comparison

**Deliverable:** The full user journey shown in the design, with genuine calculations and clear failure states.

**Files:** Own `src/app/page.tsx`, `src/features/lab/{CarLab,ModificationCatalog,DriveControls}.tsx`, `src/features/fleet/UsImpact.tsx`, the shared client state provider, and application styles. Coordinate scaffold-file edits with Task 1's owner.

**Interfaces:** Consume Tasks 1-3 without duplicating the emissions formulas or catalog. One state provider owns selected IDs, active tab/view, pedals, simulation clock, comparison playback, and adoption. Scene props use Task 2's contract; national requests/responses use Task 3's contract.

- [ ] Build the two-tab shell using the draft hierarchy, refining typography, car-stage scale, spacing, and control affordances. Start with a stock stationary car and 100% adoption; retain the build across tab changes.
- [ ] Connect hold-to-accelerate/brake and keyboard controls to fixed-step free driving. Brake wins; blur, visibility loss, tab switches, and pointer cancellation release inputs. Pause freezes simulation time; resuming does not integrate time spent hidden or paused.
- [ ] Implement the 14-part catalog, exclusive-slot replacement, reset-to-stock, part details, and computed reference comparison. Reuse Task 1's model for both live readings and the 120-second comparison; cancel playback if the build changes.
- [ ] Connect Apply build across the U.S., the adoption slider, annual bars, estimated rates, and scenario counter. Debounce slider input 300 ms; abort/ignore old requests and accept only results matching the current build/adoption/version. Reset the counter on scenario changes and integrate the received rate locally, not by repeatedly querying the warehouse.
- [ ] Add explicit loading/error/retry states, source and assumption notes, and signed increase/decrease wording. No scenario values may masquerade as current after a selection change or failed query. Keep Car lab usable during a Databricks failure.
- [ ] Browser-test stock -> helpful mod -> harmful mod -> comparison -> national projection -> 0/100% adoption -> return to lab. Add stale-response, stuck-pedal, and error/retry cases. Run unit tests, typecheck, lint, and build; commit the screen integration on its branch.

## Task 5: One-day demo, independent review, and presentation

**Deliverable:** An integrated, reviewed demo with an explainable data flow and reproducible setup.

- [ ] Independently audit each implementation PR at its current commit; record reviewer identity, findings, verification, and approval in the PR. Re-audit later changes. Merge only with the required user authorization; this plan does not authorize deployments or bypass branch protections.
- [ ] Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run test:e2e`. Repeat only for new changes or unresolved failures.
- [ ] Inspect 1440px, 1024px, and 390px layouts, keyboard focus, reduced motion, WebGL fallback, all three scene views, all catalog groups, and both positive/negative national results. The first-draft screenshots are not the finish gate.
- [ ] Prove one fresh end-to-end Databricks query against the imported source data. Prewarm the warehouse before judging; demonstrate the notebook's raw -> clean -> projected data flow for the sponsor track.
- [ ] Document local startup, `.env.example`, notebook import, parameter assumptions, and the three-minute demo in README. Provide a local `npm run build && npm start` presentation path; use a Next.js-compatible hosted deployment only when separately authorized and configured with server-only secrets.
- [ ] Demo sequence: inspect car/cutaway -> accelerate -> fit wheel covers/undertray -> fit a harmful roof cargo box -> run the fair comparison -> apply nationwide -> change adoption -> explain source year, model assumptions, and Databricks' role.
- [ ] Prepare the submission before 9:00 a.m. Sunday, November 8, America/New_York; organizer permits edits until 11:00 a.m. Verify event instructions before submission. Reserve final hours for evidence, screenshots, and presentation rather than adding features.

## Assumptions, limits, and handoff

Three contributors can use the lanes concurrently after agreeing on shared contracts. Databricks credentials are not yet available; onboarding is the first integration gate. The procedural sedan, model coefficients, mechanical animation, and uniform national reduction ratio are educational approximations, explicitly labeled. No production implementation is included in this branch.

If behind schedule, remove sound, extra annotations, camera flourishes, and additional charts before cutting the core engine cutaway, 14-part catalog, fair reference comparison, or genuine Databricks integration. MPG, cost, pollutants, AI/voice, CFD, steering, multiple cars, and persistent accounts remain out of this one-day build.
