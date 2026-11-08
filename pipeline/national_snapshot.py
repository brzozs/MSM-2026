"""State-sized output files and an atomically published national manifest."""

import os
import shutil
import tempfile
import uuid
from pathlib import Path

from .coverage import STATE_CODES, state_bounds, state_contains_coordinate
from .snapshot import write_public_json_atomically, write_snapshot_atomically


def assign_observations_to_states(state_boundaries, observations):
    states = sorted(state_boundaries["features"], key=lambda feature: feature["properties"]["code"])
    prepared_states = [(state, state_bounds(state)) for state in states]
    assignments = {state["properties"]["code"]: [] for state in states}
    unassigned = []
    for observation in observations:
        coordinates = observation["geometry"]["coordinates"]
        for state, bounds in prepared_states:
            if state_contains_coordinate(state, coordinates, bounds):
                assignments[state["properties"]["code"]].append(observation)
                break
        else:
            unassigned.append(observation)
    return assignments, unassigned


def publish_national_snapshot(snapshot, state_boundaries, output_path, secret_values=()):
    state_features = {state["properties"]["code"]: state for state in state_boundaries["features"]}
    if set(state_features) != STATE_CODES or len(state_boundaries["features"]) != 51:
        raise ValueError("National publication requires exactly all 50 states and D.C.")
    frame_state_codes = {feature["properties"].get("state_code") for feature in snapshot["frames"][0]["weather_suitability"]["features"]}
    if frame_state_codes != STATE_CODES:
        raise ValueError("Every state and D.C. must have weather samples before national publication")
    assignments = {}
    unassigned_counts = {}
    for observation_kind, collection in snapshot["observations"].items():
        assignments[observation_kind], unassigned = assign_observations_to_states(state_boundaries, collection["features"])
        unassigned_counts[observation_kind] = len(unassigned)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    staging_directory = Path(tempfile.mkdtemp(prefix=".ecology-generation-", dir=output_path.parent))
    generation_name = "generation-" + uuid.uuid4().hex
    final_directory = output_path.parent / generation_name
    manifest = {"schema_version": 1, "kind": "ecology-atlas", "model_version": snapshot["model_version"],
        "generated_at": snapshot["generated_at"], "stale_after": snapshot["stale_after"], "state_count": 51,
        "weather_location_count": snapshot["scope"]["weather_location_count"],
        "sampling_spacing_km": snapshot["scope"]["sampling_spacing_km"],
        "dates": [frame["date"] for frame in snapshot["frames"]], "overview_url": f"{generation_name}/overview.json", "states": []}
    try:
        for state_code in sorted(STATE_CODES):
            properties = state_features[state_code]["properties"]
            state_frames = [{**frame, "weather_suitability": {"type": "FeatureCollection", "features": [feature
                for feature in frame["weather_suitability"]["features"] if feature["properties"]["state_code"] == state_code]}} for frame in snapshot["frames"]]
            sample_features = state_frames[0]["weather_suitability"]["features"]
            if not sample_features or any(len(frame["weather_suitability"]["features"]) != len(sample_features) for frame in state_frames):
                raise ValueError("State weather sampling must be present and consistent across every forecast date")
            observations = {kind: {"type": "FeatureCollection", "features": assignments[kind][state_code]} for kind in assignments}
            sources = {**snapshot["sources"]}
            for kind in observations:
                sources[kind] = {**sources[kind], "displayed_record_count": len(observations[kind]["features"]),
                    "source_query_eligible_record_count": snapshot["sources"][kind]["displayed_record_count"],
                    "query_region_code": sources[kind].get("region_code", "US"), "published_region_code": "US-" + state_code,
                    "spatial_subset_note": "Displayed points are a state-boundary subset; source totals/windows retain their original query scope."}
            state_snapshot = {**snapshot, "frames": state_frames, "observations": observations, "sources": sources,
                "scope": {**snapshot["scope"], "region_code": "US-" + state_code, "state_codes": [state_code],
                    "weather_location_count": len(sample_features), "weather_bounds": [
                        min(feature["properties"]["requested_longitude"] for feature in sample_features),
                        min(feature["properties"]["requested_latitude"] for feature in sample_features),
                        max(feature["properties"]["requested_longitude"] for feature in sample_features),
                        max(feature["properties"]["requested_latitude"] for feature in sample_features)]}}
            filename = f"US-{state_code}.json"
            write_snapshot_atomically(state_snapshot, staging_directory / filename, secret_values)
            manifest["states"].append({"region_code": "US-" + state_code, "state_code": state_code, "state_fips": properties["fips"],
                "name": properties["name"], "snapshot_url": f"{generation_name}/{filename}", "weather_location_count": len(sample_features),
                "available_forecast_values": sum(feature["properties"]["questing_suitability"] is not None
                    for frame in state_frames for feature in frame["weather_suitability"]["features"])})
        overview_sources = {**snapshot["sources"]}
        for kind in assignments:
            overview_sources[kind] = {**overview_sources[kind],
                "source_query_eligible_record_count": snapshot["sources"][kind]["displayed_record_count"],
                "displayed_record_count": sum(len(features) for features in assignments[kind].values()),
                "unassigned_observation_count": unassigned_counts[kind]}
        overview = {**snapshot, "kind": "ecology-overview", "sources": overview_sources,
            "observations": {kind: {"type": "FeatureCollection", "features": [feature for state in sorted(STATE_CODES)
                for feature in assignments[kind][state]]} for kind in assignments},
            "frames": [{**frame, "weather_suitability": {"type": "FeatureCollection", "features": [
                {**feature, "properties": {key: feature["properties"][key] for key in (
                    "location_id", "name", "state_code", "date", "questing_suitability", "questing_index_0_to_100",
                    "valid_weather_hours", "is_experimental", "is_predicted", "prediction_nearest_distance_km", "prediction_method", "prediction_source_location_ids", "tick_prediction_index", "migration_adjustment_status") if key in feature["properties"]}} for feature in frame["weather_suitability"]["features"]]}} for frame in snapshot["frames"]]}
        write_snapshot_atomically(overview, staging_directory / "overview.json", secret_values)
        os.replace(staging_directory, final_directory)
        write_public_json_atomically(manifest, output_path, secret_values)
    except Exception:
        if staging_directory.exists():
            shutil.rmtree(staging_directory)
        if final_directory.exists():
            shutil.rmtree(final_directory)
        raise
    return manifest
