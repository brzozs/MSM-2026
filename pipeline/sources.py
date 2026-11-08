"""Bounded source adapters. Only this server-side module handles provider keys."""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .model import calculate_hourly_questing, parse_utc_hour, validated_number

GUILD_SPECIES_CODES = ("amerob", "sonspa", "ovenbi1", "veery", "woothr", "comyel")
MAXIMUM_BIRD_RESULTS_PER_SPECIES = 500
MAXIMUM_WEATHER_LOCATIONS = 64
MAXIMUM_RESPONSE_BYTES = 8 * 1024 * 1024
WEATHER_FIELDS = {
    "temperature_2m": ("air_temperature_c", "°C"),
    "relative_humidity_2m": ("relative_humidity_percent", "%"),
    "soil_temperature_6cm": ("soil_temperature_c", "°C"),
    "soil_moisture_1_to_3cm": ("soil_moisture_fraction", "m³/m³"),
    "vapour_pressure_deficit": ("vapour_pressure_deficit_kpa", "kPa"),
    "precipitation": ("precipitation_mm", "mm"),
    "cloud_cover_low": ("low_cloud_cover_percent", "%"),
    "wind_speed_10m": ("wind_speed_meters_per_second", "m/s"),
    "wind_direction_10m": ("wind_from_direction_degrees", "°"),
    "is_day": ("is_day", ""),
}


class SourceError(Exception):
    def __init__(self, message, http_status=None):
        super().__init__(message)
        self.http_status = http_status


class RefuseRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def utc_timestamp(value):
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Source retrieval time must include an explicit UTC offset")
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def load_ebird_api_key(credential_path=None, environment=None):
    environment = os.environ if environment is None else environment
    key_value = environment.get("EBIRD_API_KEY")
    if not key_value and credential_path is not None and Path(credential_path).exists():
        credential_path = Path(credential_path)
        if os.name == "posix" and credential_path.stat().st_mode & 0o077:
            raise ValueError("Credential file must have owner-only permissions (chmod 600)")
        key_lines = [line.partition("=")[2].strip() for line in credential_path.read_text().splitlines()
                     if line.strip().startswith("EBIRD_API_KEY=")]
        if len(key_lines) > 1:
            raise ValueError("Credential file contains duplicate EBIRD_API_KEY settings")
        key_value = key_lines[0] if key_lines else None
        if key_value and key_value[0:1] in ("'", '"') and key_value[-1:] == key_value[0]:
            key_value = key_value[1:-1]
    if key_value is not None and (not isinstance(key_value, str) or any(character.isspace() for character in key_value)):
        raise ValueError("EBIRD_API_KEY must be a single opaque value without whitespace")
    return key_value or None


def request_json(url, headers=None):
    parsed_url = urllib.parse.urlsplit(url)
    allowed_hosts = {"api.ebird.org", "api.open-meteo.com", "api.inaturalist.org"}
    if parsed_url.scheme != "https" or parsed_url.hostname not in allowed_hosts or parsed_url.username or parsed_url.password or parsed_url.port not in (None, 443):
        raise SourceError("Provider request must use an approved HTTPS host")
    headers = headers or {}
    if any(name.lower() == "x-ebirdapitoken" for name in headers) and parsed_url.hostname != "api.ebird.org":
        raise SourceError("eBird credentials may only be sent to api.ebird.org")
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "VectorCast/0.1 ecology-demo", **headers})
    try:
        opener = urllib.request.build_opener(RefuseRedirects())
        with opener.open(request, timeout=25) as response:
            if response.status != 200 or "application/json" not in response.headers.get("Content-Type", "").lower():
                raise SourceError(f"{parsed_url.hostname} returned an unexpected response type")
            encoded_payload = response.read(MAXIMUM_RESPONSE_BYTES + 1)
        if len(encoded_payload) > MAXIMUM_RESPONSE_BYTES:
            raise SourceError(f"{parsed_url.hostname} response exceeded the byte budget")
        return json.loads(encoded_payload)
    except urllib.error.HTTPError as error:
        raise SourceError(f"{parsed_url.hostname} request failed (HTTP {error.code})", error.code) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise SourceError(f"{parsed_url.hostname} connection failed") from None
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise SourceError(f"{parsed_url.hostname} returned invalid JSON") from None


def public_coordinate(longitude, latitude):
    try:
        longitude = validated_number(longitude, "longitude", -180, 180)
        latitude = validated_number(latitude, "latitude", -90, 90)
    except ValueError:
        return None
    return [longitude, latitude] if longitude is not None and latitude is not None else None


def nullable_observation_label(value):
    return value if isinstance(value, str) else None


def normalize_ebird_records(records, species_code):
    if not isinstance(records, list):
        raise SourceError("eBird did not return an observation list")
    observations = []
    exclusions = Counter()
    seen_observations = set()
    for record in records:
        if not isinstance(record, dict):
            exclusions["invalid_record"] += 1
            continue
        if record.get("locationPrivate") is not False or record.get("obsValid") is not True:
            exclusions["private_or_unvalidated"] += 1
            continue
        coordinate = public_coordinate(record.get("lng"), record.get("lat"))
        if coordinate is None:
            exclusions["invalid_coordinates"] += 1
            continue
        checklist_id = record.get("subId", "")
        if not isinstance(checklist_id, str) or not re.fullmatch(r"S\d+", checklist_id) or record.get("speciesCode") != species_code:
            exclusions["invalid_identity"] += 1
            continue
        observation_id = f"ebird:{checklist_id}:{species_code}"
        if observation_id in seen_observations:
            exclusions["duplicate"] += 1
            continue
        individual_count = record.get("howMany")
        if individual_count == "X":
            individual_count = None
        if individual_count is not None and (type(individual_count) is not int or individual_count <= 0):
            exclusions["invalid_individual_count"] += 1
            continue
        observed_local = record.get("obsDt")
        try:
            observed_time = datetime.fromisoformat(observed_local)
        except (TypeError, ValueError):
            exclusions["invalid_observation_time"] += 1
            continue
        seen_observations.add(observation_id)
        observations.append({"type": "Feature", "id": observation_id,
            "geometry": {"type": "Point", "coordinates": coordinate}, "properties": {
                "source": "ebird", "kind": "bird", "species_code": species_code,
                "common_name": nullable_observation_label(record.get("comName")),
                "scientific_name": nullable_observation_label(record.get("sciName")),
                "individual_count": individual_count, "observed_local": observed_local,
                "observed_date": observed_time.date().isoformat(),
                "observed_at": utc_timestamp(observed_time) if observed_time.tzinfo is not None else None,
                "time_zone": None, "source_record_url": f"https://ebird.org/checklist/{checklist_id}",
                "attribution": "eBird / Cornell Lab of Ornithology", "license": "eBird data access terms",
                "coordinate_uncertainty_meters": None, "is_measured_movement": False,
            }})
    return observations, dict(exclusions)


def fetch_bird_observations(region_code, api_key, retrieved_at, requester=None):
    if not re.fullmatch(r"US(?:-[A-Z]{2}(?:-\d{3})?)?", region_code):
        raise ValueError("Region must be a U.S. eBird country, state or county code")
    requester = requester or request_json
    result = {"provider": "ebird", "status": "not_configured", "retrieved_at": utc_timestamp(retrieved_at),
              "region_code": region_code, "lookback_days": 7, "window_complete": False,
              "sampling_effort_available": False, "observations": [], "exclusions": {}, "errors": [],
              "attribution": "eBird / Cornell Lab of Ornithology", "terms_url": "https://www.birds.cornell.edu/home/ebird-api-terms-of-use/"}
    if not api_key:
        result["errors"] = ["eBird credential is not configured on the backend"]
        return result
    exclusions = Counter()
    completed_queries = 0
    for species_code in GUILD_SPECIES_CODES:
        query_parameters = urllib.parse.urlencode({"back": 7, "includeProvisional": "false", "maxResults": MAXIMUM_BIRD_RESULTS_PER_SPECIES})
        url = f"https://api.ebird.org/v2/data/obs/{region_code}/recent/{species_code}?{query_parameters}"
        try:
            records = requester(url, headers={"X-eBirdApiToken": api_key})
            observations, excluded = normalize_ebird_records(records, species_code)
            result["observations"].extend(observations)
            exclusions.update(excluded)
            completed_queries += 1
            if len(records) >= MAXIMUM_BIRD_RESULTS_PER_SPECIES:
                result["errors"].append(f"Result cap reached for {species_code}")
        except SourceError as error:
            result["errors"].append(f"Bird query failed for {species_code}" + (f" (HTTP {error.http_status})" if error.http_status else ""))
            if error.http_status in (401, 403):
                break
    result["exclusions"] = dict(exclusions)
    result["completed_queries"] = completed_queries
    result["status"] = "available" if completed_queries == len(GUILD_SPECIES_CODES) and not result["errors"] else ("partial" if completed_queries else "unavailable")
    result["window_note"] = "Recent sightings are presence summaries with local times, not complete 72-hour report counts or measured migration."
    return result


def fetch_weather(locations, forecast_days, retrieved_at, requester=None):
    if not 1 <= len(locations) <= MAXIMUM_WEATHER_LOCATIONS or type(forecast_days) is not int or not 1 <= forecast_days <= 7:
        raise ValueError("Weather requires 1–64 locations and 1–7 forecast days")
    requester = requester or request_json
    query_parameters = urllib.parse.urlencode({
        "latitude": ",".join(str(location["latitude"]) for location in locations),
        "longitude": ",".join(str(location["longitude"]) for location in locations),
        "hourly": ",".join(WEATHER_FIELDS), "forecast_days": forecast_days,
        "timezone": "GMT", "wind_speed_unit": "ms", "cell_selection": "land",
    })
    payload = requester(f"https://api.open-meteo.com/v1/forecast?{query_parameters}")
    responses = payload if isinstance(payload, list) else [payload]
    if len(responses) != len(locations):
        raise SourceError("Weather response location count does not match the request")
    normalized_locations = []
    for requested_location, response in zip(locations, responses):
        if not isinstance(response, dict) or response.get("utc_offset_seconds") != 0:
            raise SourceError("Weather response must declare UTC")
        hourly_values = response.get("hourly", {})
        hourly_units = response.get("hourly_units", {})
        if not isinstance(hourly_units, dict):
            raise SourceError("Weather response must declare units for every field")
        timestamps = hourly_values.get("time") if isinstance(hourly_values, dict) else None
        if not isinstance(timestamps, list) or len(timestamps) != forecast_days * 24:
            raise SourceError("Weather response must contain the requested full UTC days")
        for field, (_, expected_unit) in WEATHER_FIELDS.items():
            if hourly_units.get(field) != expected_unit or not isinstance(hourly_values.get(field), list) or len(hourly_values[field]) != len(timestamps):
                raise SourceError("Weather units or hourly array lengths do not match the contract")
        coordinate = public_coordinate(response.get("longitude"), response.get("latitude"))
        if coordinate is None:
            raise SourceError("Weather response contains invalid grid coordinates")
        normalized_hours = []
        try:
            for index, timestamp in enumerate(timestamps):
                normalized_time = parse_utc_hour(timestamp + ":00Z")
                if normalized_hours and normalized_time != parse_utc_hour(normalized_hours[-1]["time"]) + timedelta(hours=1):
                    raise ValueError("Weather timestamps must be distinct consecutive UTC hours")
                hour = {"time": utc_timestamp(normalized_time), **{normalized_name: hourly_values[field][index]
                        for field, (normalized_name, _) in WEATHER_FIELDS.items()}}
                calculate_hourly_questing(hour)
                validated_number(hour["air_temperature_c"], "air_temperature_c")
                validated_number(hour["precipitation_mm"], "precipitation_mm", 0)
                validated_number(hour["low_cloud_cover_percent"], "low_cloud_cover_percent", 0, 100)
                validated_number(hour["wind_speed_meters_per_second"], "wind_speed_meters_per_second", 0)
                validated_number(hour["wind_from_direction_degrees"], "wind_from_direction_degrees", 0, 360)
                if hour["is_day"] is not None and (type(hour["is_day"]) is not int or hour["is_day"] not in (0, 1)):
                    raise ValueError("Invalid day/night flag")
                normalized_hours.append(hour)
        except (TypeError, ValueError):
            raise SourceError("Weather response contains invalid timestamps or physical values") from None
        normalized_locations.append({**requested_location, "requested_latitude": requested_location["latitude"],
            "requested_longitude": requested_location["longitude"], "latitude": coordinate[1], "longitude": coordinate[0],
            "hours": normalized_hours})
    return {"provider": "open_meteo", "status": "available", "retrieved_at": utc_timestamp(retrieved_at),
        "model": "best_match", "model_initialization_at": None,
        "model_note": "Provider model initialization is not exposed in this response; not suitable for predictive backtesting.",
        "soil_temperature_depth_cm": 6, "soil_moisture_depth_cm": [1, 3],
        "attribution": "Weather data by Open-Meteo.com, CC BY 4.0", "terms_url": "https://open-meteo.com/en/terms",
        "locations": normalized_locations}


def normalize_inaturalist_records(records):
    if not isinstance(records, list):
        raise SourceError("iNaturalist did not return an observation list")
    observations = []
    exclusions = Counter()
    seen_observations = set()
    for record in records:
        if not isinstance(record, dict):
            exclusions["invalid_record"] += 1
            continue
        if record.get("license_code") not in ("cc0", "cc-by") or record.get("quality_grade") != "research":
            exclusions["license_or_quality"] += 1
            continue
        if record.get("obscured") is not False or record.get("geoprivacy") not in (None, "open") or record.get("taxon_geoprivacy") not in (None, "open"):
            exclusions["private_or_obscured"] += 1
            continue
        try:
            uncertainty = validated_number(record.get("positional_accuracy"), "positional_accuracy", 0, 1000)
        except ValueError:
            uncertainty = None
        if uncertainty is None:
            exclusions["unknown_or_excessive_coordinate_uncertainty"] += 1
            continue
        geometry = record.get("geojson") or {}
        if not isinstance(geometry, dict):
            exclusions["invalid_identity_or_coordinates"] += 1
            continue
        coordinates = geometry.get("coordinates", [])
        coordinate = public_coordinate(*coordinates) if geometry.get("type") == "Point" and isinstance(coordinates, list) and len(coordinates) == 2 else None
        observation_id = record.get("id")
        taxon = record.get("taxon") or {}
        if coordinate is None or type(observation_id) is not int or observation_id <= 0 or not isinstance(taxon, dict) or type(taxon.get("id")) is not int or taxon["id"] <= 0:
            exclusions["invalid_identity_or_coordinates"] += 1
            continue
        ancestor_ids = taxon.get("ancestor_ids")
        if taxon.get("id") != 51672 and (not isinstance(ancestor_ids, list) or 51672 not in ancestor_ids):
            exclusions["non_tick_taxon"] += 1
            continue
        attribution = record.get("attribution")
        if not attribution and isinstance(record.get("user"), dict) and record["user"].get("login"):
            attribution = f"iNaturalist contributor {record['user']['login']}"
        if not isinstance(attribution, str) or not attribution:
            exclusions["missing_attribution"] += 1
            continue
        try:
            observed_date = date.fromisoformat(record.get("observed_on")).isoformat()
            source_timestamp = record.get("time_observed_at")
            if source_timestamp is not None and not isinstance(source_timestamp, str):
                raise ValueError("Invalid timestamp type")
            observed_time = datetime.fromisoformat(source_timestamp.replace("Z", "+00:00")) if source_timestamp else None
        except (TypeError, ValueError):
            exclusions["invalid_observation_time"] += 1
            continue
        if observation_id in seen_observations:
            exclusions["duplicate"] += 1
            continue
        seen_observations.add(observation_id)
        observations.append({"type": "Feature", "id": f"inaturalist:{observation_id}",
            "geometry": {"type": "Point", "coordinates": coordinate}, "properties": {
                "source": "inaturalist", "kind": "tick", "taxon_id": taxon.get("id"),
                "scientific_name": nullable_observation_label(taxon.get("name")), "observed_date": observed_date,
                "observed_at": utc_timestamp(observed_time) if observed_time is not None and observed_time.tzinfo is not None else None,
                "license": record["license_code"], "attribution": attribution,
                "coordinate_uncertainty_meters": uncertainty, "life_stage": None,
                "source_record_url": f"https://www.inaturalist.org/observations/{observation_id}",
            }})
    return observations, dict(exclusions)


def fetch_tick_observations(bounds, retrieved_at, requester=None, maximum_pages=5):
    if type(maximum_pages) is not int or not 1 <= maximum_pages <= 5 or len(bounds) != 4:
        raise ValueError("Tick queries require a bounding box and at most five pages")
    requester = requester or request_json
    west, south, east, north = bounds
    if public_coordinate(west, south) is None or public_coordinate(east, north) is None or not west < east or not south < north:
        raise ValueError("Tick bounding box must have valid ordered coordinates")
    window_end = retrieved_at.astimezone(timezone.utc).date()
    window_start = window_end - timedelta(days=6)
    result = {"provider": "inaturalist", "status": "unavailable", "retrieved_at": utc_timestamp(retrieved_at),
        "window_start_date": window_start.isoformat(), "window_end_date": window_end.isoformat(),
        "window_time_basis": "observation-local calendar dates", "window_complete": False, "cohort_compatible": False,
        "cohort_note": "All Ixodida reports; no verified life stage. Not interchangeable with Ixodes scapularis nymph counts.",
        "observations": [], "exclusions": {}, "errors": [], "bounds": bounds, "place_id": 1,
        "attribution": "iNaturalist contributors; individual CC0/CC BY attribution retained",
        "terms_url": "https://www.inaturalist.org/pages/api+recommended+practices"}
    raw_records = []
    expected_total = None
    try:
        for page_number in range(1, maximum_pages + 1):
            parameters = {"taxon_id": 51672, "quality_grade": "research", "license": "cc0,cc-by", "geo": "true", "place_id": 1,
                "d1": window_start.isoformat(), "d2": window_end.isoformat(), "swlng": west, "swlat": south,
                "nelng": east, "nelat": north, "per_page": 200, "page": page_number, "order_by": "id", "order": "asc"}
            payload = requester("https://api.inaturalist.org/v1/observations?" + urllib.parse.urlencode(parameters))
            if not isinstance(payload, dict) or type(payload.get("total_results")) is not int or not isinstance(payload.get("results"), list):
                raise SourceError("Invalid iNaturalist response")
            if expected_total is None:
                expected_total = payload["total_results"]
            if payload["total_results"] != expected_total:
                result["errors"].append("Source result count changed during pagination")
            raw_records.extend(payload["results"])
            if len(raw_records) >= expected_total:
                result["window_complete"] = not result["errors"] and len(raw_records) == expected_total
                break
            if not payload["results"] or len(payload["results"]) < 200:
                break
        result["observations"], result["exclusions"] = normalize_inaturalist_records(raw_records)
        raw_identifiers = [record["id"] for record in raw_records
                           if isinstance(record, dict) and type(record.get("id")) is int and record["id"] > 0]
        if len(raw_identifiers) != len(raw_records) or len(set(raw_identifiers)) != len(raw_identifiers):
            result["window_complete"] = False
            result["errors"].append("Invalid or duplicate source IDs prevent a complete observation window")
        result["reported_total"] = expected_total
        result["fetched_records"] = len(raw_records)
        result["status"] = "available" if result["window_complete"] else "partial"
        if not result["window_complete"]:
            result["errors"].append("Observation query was not complete within the bounded page budget")
    except SourceError:
        result["errors"].append("Tick observation request failed")
        result["status"] = "unavailable"
        result["window_complete"] = False
    return result
