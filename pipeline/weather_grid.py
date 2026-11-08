"""Paced weather batches with public, integrity-checked resume checkpoints."""

import hashlib
import json
import os
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .model import MODEL_VERSION
from .sources import WEATHER_FIELDS, fetch_weather, utc_timestamp

MAXIMUM_GRID_LOCATIONS = 4500
MAXIMUM_BATCH_LOCATIONS = 64
WEATHER_LOCATIONS_PER_SECOND = 8
CACHE_LIFETIME_SECONDS = 6 * 60 * 60


def _encoded_json(payload):
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def _load_cached_weather(cache_path, fingerprint, locations, forecast_days, retrieved_at):
    try:
        document = json.loads(cache_path.read_text())
        if not isinstance(document, dict) or document.get("cache_version") != 1 or document.get("request_fingerprint") != fingerprint:
            return None
        source = document["source"]
        if hashlib.sha256(_encoded_json(source)).hexdigest() != document.get("payload_sha256"):
            return None
        cached_time = datetime.fromisoformat(source["retrieved_at"].replace("Z", "+00:00"))
        if cached_time.tzinfo is None or not 0 <= (retrieved_at - cached_time).total_seconds() <= CACHE_LIFETIME_SECONDS:
            return None
        if source.get("status") != "available" or source.get("provider") != "open_meteo" or len(source["locations"]) != len(locations):
            return None
        for cached_location, requested_location in zip(source["locations"], locations):
            if cached_location["id"] != requested_location["id"] or len(cached_location["hours"]) != forecast_days * 24:
                return None
        return source
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return None


def _save_cached_weather(cache_path, fingerprint, source):
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"cache_version": 1, "request_fingerprint": fingerprint, "source": source,
               "payload_sha256": hashlib.sha256(_encoded_json(source)).hexdigest()}
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", dir=cache_path.parent, prefix=".weather-", suffix=".tmp", delete=False) as output:
            temporary_path = Path(output.name)
            output.write(_encoded_json(payload))
        os.replace(temporary_path, cache_path)
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()


def fetch_weather_grid(locations, forecast_days, retrieved_at, requester=None, cache_directory=None, progress_callback=None, clock=None):
    if not 1 <= len(locations) <= MAXIMUM_GRID_LOCATIONS:
        raise ValueError("A refresh may contain at most 4500 weather locations; select a state or a coarser national grid")
    clock = clock or (lambda: datetime.now(timezone.utc))
    results = []
    cache_hits = 0
    fetched_batches = 0
    previous_request_started = None
    previous_request_locations = 0
    batch_count = (len(locations) + MAXIMUM_BATCH_LOCATIONS - 1) // MAXIMUM_BATCH_LOCATIONS
    for batch_index, offset in enumerate(range(0, len(locations), MAXIMUM_BATCH_LOCATIONS)):
        batch = locations[offset:offset + MAXIMUM_BATCH_LOCATIONS]
        fingerprint = hashlib.sha256(_encoded_json({"model_version": MODEL_VERSION, "fields": list(WEATHER_FIELDS),
            "date": retrieved_at.astimezone(timezone.utc).date().isoformat(), "forecast_days": forecast_days, "locations": batch})).hexdigest()
        cache_path = Path(cache_directory) / f"{fingerprint}.json" if cache_directory is not None else None
        source = _load_cached_weather(cache_path, fingerprint, batch, forecast_days, clock()) if cache_path is not None else None
        if source is not None:
            cache_hits += 1
            source_mode = "cached"
        else:
            if previous_request_started is not None:
                wait_seconds = previous_request_started + previous_request_locations / WEATHER_LOCATIONS_PER_SECOND - time.monotonic()
                if wait_seconds > 0:
                    time.sleep(wait_seconds)
            previous_request_started = time.monotonic()
            previous_request_locations = len(batch)
            batch_started_at = clock()
            source = fetch_weather(batch, forecast_days, batch_started_at, requester=requester)
            source["request_started_at"] = utc_timestamp(batch_started_at)
            source["retrieved_at"] = utc_timestamp(clock())
            if cache_path is not None:
                _save_cached_weather(cache_path, fingerprint, source)
            fetched_batches += 1
            source_mode = "downloaded"
        results.append(source)
        if progress_callback is not None:
            progress_callback(f"Weather batch {batch_index + 1}/{batch_count}: {source_mode} ({min(offset + len(batch), len(locations))}/{len(locations)} locations)")
    return {**{key: value for key, value in results[0].items() if key != "locations"},
        "locations": [location for result in results for location in result["locations"]],
        "data_retrieved_at": min(result["retrieved_at"] for result in results),
        "cache_hit_batches": cache_hits, "batches_fetched": fetched_batches,
        "collection_note": "Each anchor uses its own provider response; different batches may have different underlying model runs."}
