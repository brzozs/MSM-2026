"""Build public map frames and publish only complete, finite JSON files."""

import json
import math
import os
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path

from .model import MODEL_VERSION, calculate_activity_components, summarize_weather_day, validated_number
from .sources import public_coordinate, utc_timestamp
from .weather_grid import MAXIMUM_GRID_LOCATIONS

MAXIMUM_INTERPOLATION_DISTANCE_METERS = 25000
PUBLIC_SOURCE_FIELDS = (
    "provider", "status", "request_started_at", "retrieved_at", "window_complete", "sampling_effort_available",
    "region_code", "lookback_days", "window_note", "window_start_date", "window_end_date", "window_time_basis",
    "cohort_compatible", "cohort_note", "attribution", "terms_url", "model", "model_initialization_at", "model_note",
    "soil_temperature_depth_cm", "soil_moisture_depth_cm", "completed_queries", "reported_total", "fetched_records",
    "exclusions", "errors", "bounds", "place_id", "request_completed_at", "data_retrieved_at",
    "cache_hit_batches", "batches_fetched", "collection_note", "query_region_code", "published_region_code",
    "spatial_subset_note", "unassigned_observation_count", "source_query_eligible_record_count",
    "forecast_start_date", "forecast_end_date",
    "source_forecast_location_count", "predicted_location_count", "prediction_note",
)
SAMPLING_METADATA_FIELDS = ("state_code", "state_fips", "sampling_spacing_km", "sampling_is_fallback")


def validate_sampling_locations(locations):
    if not isinstance(locations, list) or not 1 <= len(locations) <= MAXIMUM_GRID_LOCATIONS:
        raise ValueError("Supply between 1 and 4500 weather sampling locations")
    normalized_locations = []
    seen_identifiers = set()
    for location in locations:
        if not isinstance(location, dict):
            raise ValueError("Each sampling location must be an object")
        identifier, name = location.get("id"), location.get("name")
        if not isinstance(identifier, str) or not identifier.strip() or identifier in seen_identifiers:
            raise ValueError("Sampling location IDs must be non-empty and unique")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("Each sampling location requires a name")
        coordinate = public_coordinate(location.get("longitude"), location.get("latitude"))
        if coordinate is None:
            raise ValueError("Sampling locations require finite, valid latitude and longitude")
        seen_identifiers.add(identifier)
        metadata = {field: location[field] for field in SAMPLING_METADATA_FIELDS if field in location}
        if "state_code" in metadata and (not isinstance(metadata["state_code"], str) or len(metadata["state_code"]) != 2):
            raise ValueError("Sampling state codes must be two-letter strings")
        if "state_fips" in metadata and (not isinstance(metadata["state_fips"], str) or len(metadata["state_fips"]) != 2 or not metadata["state_fips"].isdigit()):
            raise ValueError("Sampling state FIPS must be two-digit strings")
        if "sampling_spacing_km" in metadata:
            validated_number(metadata["sampling_spacing_km"], "sampling_spacing_km", 25, 250)
        if "sampling_is_fallback" in metadata and type(metadata["sampling_is_fallback"]) is not bool:
            raise ValueError("Sampling fallback status must be a boolean")
        normalized_locations.append({"id": identifier, "name": name, "latitude": coordinate[1], "longitude": coordinate[0], **metadata})
    return normalized_locations


def coordinate_distance_meters(first_coordinate, second_coordinate):
    first_longitude, first_latitude = map(math.radians, first_coordinate)
    second_longitude, second_latitude = map(math.radians, second_coordinate)
    haversine = math.sin((second_latitude - first_latitude) / 2) ** 2 + math.cos(first_latitude) * math.cos(second_latitude) * math.sin((second_longitude - first_longitude) / 2) ** 2
    return 6371008.8 * 2 * math.asin(math.sqrt(min(1, max(0, haversine))))


def _source_metadata(source):
    metadata = {field: source[field] for field in PUBLIC_SOURCE_FIELDS if field in source}
    if "observations" in source:
        metadata["displayed_record_count"] = len(source["observations"])
    return metadata


def build_snapshot(locations, weather, bird_evidence, tick_evidence, generated_at, region_code="US"):
    locations = validate_sampling_locations(locations)
    generated_timestamp = utc_timestamp(generated_at)
    weather_data_time = datetime.fromisoformat(weather.get("data_retrieved_at", weather["retrieved_at"]).replace("Z", "+00:00"))
    if weather_data_time.tzinfo is None or weather_data_time > generated_at:
        raise ValueError("Weather data retrieval time must be known and no later than snapshot generation")
    if not isinstance(weather.get("forecast_start_date"), str):
        raise ValueError("Weather must declare the forecast_start_date pinned at collection start")
    start_date = date.fromisoformat(weather["forecast_start_date"])
    weather_locations = weather.get("locations", [])
    if weather.get("status") != "available" or len(weather_locations) != len(locations):
        raise ValueError("A complete weather response is required before publication")
    configured_locations = {location["id"]: location for location in locations}
    if len({location.get("id") for location in weather_locations}) != len(locations):
        raise ValueError("Weather location IDs must be distinct and match configuration")
    forecast_days = len(weather_locations[0].get("hours", [])) // 24
    if not 1 <= forecast_days <= 7:
        raise ValueError("Weather must contain between one and seven full forecast days")
    forecast_dates = [(start_date + timedelta(days=index)).isoformat() for index in range(forecast_days)]
    expected_times = {f"{forecast_date}T{hour:02d}:00:00Z" for forecast_date in forecast_dates for hour in range(24)}
    for weather_location in weather_locations:
        configured_location = configured_locations.get(weather_location.get("id"))
        if configured_location is None:
            raise ValueError("Weather location IDs do not match configuration")
        hours = weather_location.get("hours", [])
        if len(hours) != len(expected_times) or {hour.get("time") for hour in hours} != expected_times:
            raise ValueError("Weather hours must align exactly with the generated UTC forecast dates")
        grid_coordinate = public_coordinate(weather_location.get("longitude"), weather_location.get("latitude"))
        if grid_coordinate is None or coordinate_distance_meters(
                [configured_location["longitude"], configured_location["latitude"]], grid_coordinate) > MAXIMUM_INTERPOLATION_DISTANCE_METERS:
            raise ValueError("Weather grid location is more than 25 km from the requested sample")
    frames = []
    for day_index, forecast_date in enumerate(forecast_dates):
        features = []
        for weather_location in weather_locations:
            configured_location = configured_locations[weather_location["id"]]
            daily_summary = summarize_weather_day(weather_location["hours"], forecast_date)
            # These sources do not yet provide a complete 72-hour bird window,
            # cohort-compatible nymph counts, or an admitted habitat raster.
            components = calculate_activity_components(daily_summary["questing_suitability"], daily_summary["stopover_weather_proxy"],
                None, False, None, False, None)
            features.append({"type": "Feature", "id": weather_location["id"],
                "geometry": {"type": "Point", "coordinates": [weather_location["longitude"], weather_location["latitude"]]},
                "properties": {"location_id": weather_location["id"], "name": configured_location["name"],
                    **{field: configured_location[field] for field in SAMPLING_METADATA_FIELDS if field in configured_location},
                    "requested_latitude": configured_location["latitude"], "requested_longitude": configured_location["longitude"],
                    "weather_grid_distance_meters": coordinate_distance_meters(
                        [configured_location["longitude"], configured_location["latitude"]],
                        [weather_location["longitude"], weather_location["latitude"]]),
                    **daily_summary, "activity_components": components, "is_experimental": True}})
        frames.append({"date": forecast_date, "outlook": "lower_confidence" if day_index >= 3 else "near_term",
                       "weather_suitability": {"type": "FeatureCollection", "features": features}})
    if not any(feature["properties"]["questing_suitability"] is not None for frame in frames for feature in frame["weather_suitability"]["features"]):
        raise ValueError("No sample has enough valid weather hours to publish a suitability estimate")
    return {
        "schema_version": 1, "model_version": MODEL_VERSION, "generated_at": generated_timestamp,
        "stale_after": utc_timestamp(weather_data_time + timedelta(hours=12)),
        "scope": {"region_code": region_code, "weather_location_count": len(locations),
            "weather_coverage": "Reference grid samples; not trail-level measurements",
            "state_codes": sorted({location["state_code"] for location in locations if "state_code" in location}),
            "sampling_spacing_km": locations[0].get("sampling_spacing_km"),
            "maximum_interpolation_distance_meters": MAXIMUM_INTERPOLATION_DISTANCE_METERS,
            "weather_bounds": [min(location["longitude"] for location in locations), min(location["latitude"] for location in locations),
                               max(location["longitude"] for location in locations), max(location["latitude"] for location in locations)]},
        "semantics": {"questing_index": "Experimental weather suitability on a 0–100 index; not a probability",
            "model_cohort": "Ixodes scapularis nymphs; unvalidated heuristic coefficients",
            "bird_observations": "Recent ground sightings, not migration tracks or tick-carriage evidence",
            "observation_forecast_policy": "Reports are fixed at retrieval across all future weather frames",
            "missing_values": "Null means unavailable; zero is a calculated or observed value"},
        "sources": {"weather": _source_metadata(weather), "birds": _source_metadata(bird_evidence), "ticks": _source_metadata(tick_evidence)},
        "observations": {"birds": {"type": "FeatureCollection", "features": bird_evidence.get("observations", [])},
                         "ticks": {"type": "FeatureCollection", "features": tick_evidence.get("observations", [])}},
        "frames": frames,
        "unavailable_layers": [
            {"id": "measured_bird_movement", "reason": "No admitted track or processed radar feed"},
            {"id": "ecological_activity_index", "reason": "Complete cohort-compatible report windows and habitat are not connected"},
            {"id": "community_pathogen_index", "reason": "Eligible pathogen testing and population inputs are not connected"},
        ],
    }


def write_snapshot_atomically(snapshot, output_path, secret_values=()):
    if not isinstance(snapshot, dict) or snapshot.get("schema_version") != 1 or not isinstance(snapshot.get("frames"), list) or not snapshot["frames"]:
        raise ValueError("Invalid public snapshot structure")
    for frame in snapshot["frames"]:
        for feature in frame["weather_suitability"]["features"]:
            properties = feature["properties"]
            score = validated_number(properties["questing_suitability"], "questing_suitability", 0, 1)
            validated_number(properties["questing_index_0_to_100"], "questing_index_0_to_100", 0, 100)
            predicted = properties.get('is_predicted') is True
            if predicted:
                if properties.get('prediction_method') != 'four_neighbor_inverse_distance_v1' or properties['valid_weather_hours'] != 0 or properties.get('conditions_at_peak') is not None or properties.get('factors_at_peak') is not None:
                    raise ValueError('Spatial estimates must not contain invented weather conditions or hours')
                validated_number(properties.get('prediction_nearest_distance_km'), 'prediction_nearest_distance_km', 0, 1500)
                if score is not None and not properties.get('prediction_source_location_ids'):
                    raise ValueError('A spatial estimate requires source forecast references')
            if score is not None and not predicted and properties["valid_weather_hours"] < 18:
                raise ValueError("Insufficient weather hours for a published suitability value")
    write_public_json_atomically(snapshot, output_path, secret_values)


def write_public_json_atomically(payload, output_path, secret_values=()):
    encoded_snapshot = (json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n").encode("utf-8")
    if any(secret and secret.encode("utf-8") in encoded_snapshot for secret in secret_values):
        raise ValueError("Snapshot contains a configured private credential; publication refused")
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", dir=output_path.parent, prefix=f".{output_path.name}.", suffix=".tmp", delete=False) as output_file:
            temporary_path = Path(output_file.name)
            output_file.write(encoded_snapshot)
            output_file.flush()
            os.fsync(output_file.fileno())
        os.replace(temporary_path, output_path)
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()
