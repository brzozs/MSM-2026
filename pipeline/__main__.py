"""Run with python3 -m pipeline from the repository root."""

import argparse
import json
import sys
from datetime import datetime, timezone
from functools import partial
from pathlib import Path

from .snapshot import build_snapshot, validate_sampling_locations, write_snapshot_atomically
from .sources import SourceError, fetch_bird_observations, fetch_tick_observations, load_ebird_api_key, utc_timestamp
from .coverage import generate_sampling_locations
from .national_snapshot import publish_national_snapshot
from .weather_grid import fetch_weather_grid

PACKAGE_DIRECTORY = Path(__file__).resolve().parent


def _retrieve_source(provider_function, clock, *parameters):
    started_at = clock()
    source = provider_function(*parameters, started_at)
    completed_at = clock()
    return {**source, "request_started_at": utc_timestamp(started_at), "request_completed_at": utc_timestamp(completed_at),
        "retrieved_at": source.get("data_retrieved_at", utc_timestamp(completed_at))}


def main(arguments=None, generated_at=None):
    parser = argparse.ArgumentParser(description="Build timestamped public ecology evidence and experimental weather-suitability frames.")
    parser.add_argument("--region", default="US", help="US (all 50 states + DC) or a state; county codes require custom --locations")
    parser.add_argument("--locations", type=Path, help="Optional JSON list of named reference points; otherwise use the common state grid")
    parser.add_argument("--boundaries", type=Path, default=PACKAGE_DIRECTORY.parent / "web/public/data/states.geojson")
    parser.add_argument("--grid-spacing-km", type=float, default=50, help="Uniform national/state grid spacing (default: 50 km)")
    parser.add_argument("--forecast-days", type=int, choices=range(1, 8), default=7)
    parser.add_argument("--output", type=Path, default=PACKAGE_DIRECTORY / "output/latest.json")
    options = parser.parse_args(arguments)
    api_key = None
    clock = (lambda: generated_at) if generated_at is not None else (lambda: datetime.now(timezone.utc))
    try:
        boundaries = json.loads(options.boundaries.read_text()) if options.locations is None else None
        locations = validate_sampling_locations(json.loads(options.locations.read_text()) if options.locations is not None
            else generate_sampling_locations(boundaries, options.region, options.grid_spacing_km))
        api_key = load_ebird_api_key(PACKAGE_DIRECTORY / ".env.local")
        collect_weather = partial(fetch_weather_grid, cache_directory=options.output.parent / "weather-cache", clock=clock,
            progress_callback=lambda message: print(message, flush=True))
        weather = _retrieve_source(collect_weather, clock, locations, options.forecast_days)
        birds = _retrieve_source(fetch_bird_observations, clock, options.region, api_key)
        bounds = [min(location["longitude"] for location in locations), min(location["latitude"] for location in locations),
                  max(location["longitude"] for location in locations), max(location["latitude"] for location in locations)]
        # A single reference point still gets a small, explicitly disclosed query box.
        if bounds[0] == bounds[2]:
            bounds[0], bounds[2] = max(-180, bounds[0] - 0.1), min(180, bounds[2] + 0.1)
        if bounds[1] == bounds[3]:
            bounds[1], bounds[3] = max(-90, bounds[1] - 0.1), min(90, bounds[3] + 0.1)
        ticks = _retrieve_source(fetch_tick_observations, clock, bounds)
        snapshot = build_snapshot(locations, weather, birds, ticks, clock(), region_code=options.region)
        if options.region == "US" and options.locations is None:
            publish_national_snapshot(snapshot, boundaries, options.output, secret_values=(api_key,))
        else:
            write_snapshot_atomically(snapshot, options.output, secret_values=(api_key,))
    except (SourceError, ValueError, OSError, TypeError) as error:
        safe_message = str(error).replace(api_key, "[REDACTED]") if api_key else str(error)
        print(f"Refresh failed; previous output preserved: {safe_message}", file=sys.stderr)
        return 1
    print(f"Published {len(snapshot['frames'])} frames for {len(locations)} weather locations to {options.output}")
    partial_sources = []
    for source_name, source in snapshot["sources"].items():
        record_note = f", {source['displayed_record_count']} eligible displayed records" if "displayed_record_count" in source else ""
        print(f"{source_name}: {source['status']}{record_note}")
        if source["status"] != "available":
            partial_sources.append(source_name)
    if partial_sources:
        print("Published with unavailable/partial sources: " + ", ".join(partial_sources), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
