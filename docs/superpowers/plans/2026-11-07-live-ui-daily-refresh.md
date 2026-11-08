# Real Data UI and Daily Refresh Implementation Plan

**Goal:** Display the existing national ecology snapshots, refresh them at a chosen daily time, and animate transitions between actual forecast days.

**Architecture:** Keep the existing Python collector and React/MapLibre UI. Publish only the manifest and its referenced generation from private pipeline output to static public assets. The browser loads one consistent generation, refreshes its manifest periodically, and loads state details on selection. A hosted scheduled runner collects/builds before replacing the published site.

**Spec:** Issue #13 and the user's request in this chat. Existing model/source contracts in `pipeline/README.md` and `pipeline/contracts.ts` remain authoritative.

## Constraints and decisions

- Preserve null versus zero, actual report coordinates, UTC forecast dates, source terms and original freshness.
- User delegated timing to source cadence. Prepared schedule: 6:17 AM/PM America/New_York within the national weather budget. Hosting activation remains pending.
- No credentials in public assets, browser requests or build environment. No cache directory in public output.
- Do not activate a hosted job or deploy before the destination and schedule are settled. No commit/push/merge requested.
- Separate weather suitability from tick occurrence/health risk. Keep original flight/wind explicitly illustrative and actual report locations fixed. Preserve the original layout; national states show solid height/color without blur. Keep state percentages below abbreviations; selected-state heatmap replaces local percentages.
- Ease state values/colors/heights over 1.6 seconds with a small display-only settling lift, capped at 3,500 m and 1.2% of display height. End at exact target values; missing values remain unavailable. Honor reduced motion; the preview explicitly enables animation after clearing an accessibility-test override.
- Keep the previous successful public generation on any collection/publication failure.
- The nine reviewed #17 reliability changes were applied locally as necessary dependencies, without changing its PR or committing/merging.

## Tasks

1. Add meaningful failing tests for relative manifest/state URLs, generation/date consistency, HTTP failures, null/zero weather samples, stale timestamps and day interpolation. Implement a small typed snapshot loader and map adapter. Run all frontend tests.
2. Add failing publication tests for a complete generation, missing referenced files, traversal/caches and preserving the prior manifest. Implement the minimal publisher; prepare generated local public assets without provider calls.
3. Connect App/map/timeline/state details to actual snapshots. Add loading/error/freshness, state weather factors and source attribution. Fetch the latest manifest every five minutes and on tab focus. Verify typecheck/build and browser flows, including missing data and reduced motion.
4. Once hosting/time are known, prepare the scheduled collector/build/publish configuration and instructions. Accept collector exit 0/2 only. Verify configuration and local publication without claiming an activated schedule.
5. Obtain independent review, fix material findings, rerun relevant suites, and record the implemented result and remaining activation requirements in #13.

## Verification focus

- A daily generation swap cannot mix overview and state snapshots.
- A late/missing run remains clearly stale; a daily cadence does not silently extend the 12-hour source freshness rule.
- A project subpath works for geography and data URLs.
- A failed fetch never falls back to synthetic fixtures.
- Changing states/dates during a fetch/transition cannot show another state's factors or leave animation resources running.

## Progress

- Baseline: 13 frontend tests and 48 backend tests passed on local `08d38f3`.
- Implementation uses task branch `agent/13-live-ui-daily-refresh`; read-only agents investigate contracts, renderer and scheduling.

- Final user steering: county/city text only, no dots or nationwide outlines; county lines thicker than cities; themed custom state picker/scrollbar; explicit state-selection zoom; shared green-to-orange palette with higher suitability taller. Local heatmap uses the existing weather model while bird/tick/habitat completeness gates keep the composite unavailable. Seasonal flight guidance is approximate and sourced, not measured tracks.
