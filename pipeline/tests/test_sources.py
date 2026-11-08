import io
import json
import os
import tempfile
import unittest
import urllib.error
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from pipeline.sources import (
    SourceError, WEATHER_FIELDS, fetch_bird_observations, fetch_tick_observations,
    fetch_weather, load_ebird_api_key, normalize_ebird_records,
    normalize_inaturalist_records, request_json,
)

NOW = datetime(2026, 11, 7, 23, 0, tzinfo=timezone.utc)
TEST_TOKEN = "dummy-token-for-fixture-tests"
LOCATIONS = [{"id": "troy", "name": "Troy reference", "latitude": 42.73, "longitude": -73.68}]


def bird_record(**changes):
    return {"speciesCode": "amerob", "comName": "American Robin", "sciName": "Turdus migratorius",
            "lat": 42.73, "lng": -73.68, "obsDt": "2026-11-07 08:30", "howMany": 3,
            "locId": "L123", "locName": "Public park", "subId": "S12345", "obsValid": True,
            "locationPrivate": False, **changes}


def tick_record(**changes):
    return {"id": 12345, "license_code": "cc-by", "quality_grade": "research", "geoprivacy": None,
            "taxon_geoprivacy": None, "obscured": False, "positional_accuracy": 100,
            "geojson": {"type": "Point", "coordinates": [-73.68, 42.73]},
            "observed_on": "2026-11-07", "time_observed_at": "2026-11-07T10:30:00-05:00",
            "taxon": {"id": 51672, "name": "Ixodida"}, "attribution": "Field Observer, CC BY", **changes}


def weather_response(forecast_days=1):
    units = {"temperature_2m": "°C", "relative_humidity_2m": "%", "soil_temperature_6cm": "°C",
             "soil_moisture_1_to_3cm": "m³/m³", "vapour_pressure_deficit": "kPa", "precipitation": "mm",
             "cloud_cover_low": "%", "wind_speed_10m": "m/s", "wind_direction_10m": "°", "is_day": ""}
    values = {field: [value] * (24 * forecast_days) for field, value in {
        "temperature_2m": 18, "relative_humidity_2m": 90, "soil_temperature_6cm": 18,
        "soil_moisture_1_to_3cm": 0.3, "vapour_pressure_deficit": 0, "precipitation": 0,
        "cloud_cover_low": 50, "wind_speed_10m": 1, "wind_direction_10m": 180, "is_day": 0,
    }.items()}
    start_time = datetime(2026, 11, 7)
    return {"latitude": 42.74, "longitude": -73.69, "utc_offset_seconds": 0,
            "hourly_units": units, "hourly": {"time": [(start_time + timedelta(hours=hour)).isoformat(timespec="minutes")
                for hour in range(24 * forecast_days)], **values}}


class JsonResponse(io.BytesIO):
    def __init__(self, payload, content_type="application/json"):
        super().__init__(json.dumps(payload).encode())
        self.headers = {"Content-Type": content_type}
        self.status = 200


class ProviderAdapterTests(unittest.TestCase):
    def test_credential_file_is_private_and_environment_takes_precedence(self):
        with tempfile.TemporaryDirectory() as directory:
            credential_path = Path(directory) / ".env.local"
            credential_path.write_text(f"EBIRD_API_KEY={TEST_TOKEN}\n")
            credential_path.chmod(0o600)
            self.assertEqual(load_ebird_api_key(credential_path, {}), TEST_TOKEN)
            self.assertEqual(load_ebird_api_key(credential_path, {"EBIRD_API_KEY": "environment-dummy-token"}), "environment-dummy-token")
            if os.name == "posix":
                credential_path.chmod(0o644)
                with self.assertRaises(ValueError):
                    load_ebird_api_key(credential_path, {})
        with self.assertRaises(ValueError) as failure:
            load_ebird_api_key(Path("missing.env"), {"EBIRD_API_KEY": TEST_TOKEN + "\nunsafe"})
        self.assertNotIn(TEST_TOKEN, str(failure.exception))

    def test_bird_queries_put_token_in_the_header_not_url_or_public_output(self):
        requested_urls = []

        def public_response(url, headers=None):
            requested_urls.append(url)
            self.assertEqual(headers["X-eBirdApiToken"], TEST_TOKEN)
            self.assertNotIn(TEST_TOKEN, url)
            self.assertNotIn("%7B", url)
            species_code = urllib.parse.urlsplit(url).path.rsplit("/", 1)[-1]
            return [bird_record(speciesCode=species_code)]

        result = fetch_bird_observations("US-NY", TEST_TOKEN, NOW, requester=public_response)
        self.assertEqual(len(requested_urls), 6)
        self.assertEqual(result["status"], "available")
        self.assertFalse(result["window_complete"])
        self.assertEqual(len(result["observations"]), 6)
        self.assertNotIn(TEST_TOKEN, json.dumps(result))

    def test_public_birds_preserve_local_time_and_unknown_individual_counts(self):
        records, exclusions = normalize_ebird_records([
            bird_record(howMany=None), bird_record(howMany=None),
            bird_record(subId="S2", locationPrivate=True), bird_record(subId="S3", obsValid=False),
            bird_record(subId="S4", lat=100),
        ], "amerob")
        self.assertEqual(len(records), 1)
        properties = records[0]["properties"]
        self.assertIsNone(properties["individual_count"])
        self.assertIsNone(properties["observed_at"])
        self.assertEqual(properties["observed_local"], "2026-11-07 08:30")
        self.assertEqual(properties["source_record_url"], "https://ebird.org/checklist/S12345")
        self.assertEqual(sum(exclusions.values()), 4)

    def test_missing_key_is_unavailable_without_attempting_a_request(self):
        def forbidden_request(*args, **kwargs):
            self.fail("Missing credentials must not cause a network request")
        result = fetch_bird_observations("US-NY", None, NOW, requester=forbidden_request)
        self.assertEqual(result["status"], "not_configured")
        self.assertFalse(result["window_complete"])

    def test_http_failures_are_redacted_and_authenticated_redirects_are_refused(self):
        with patch("pipeline.sources.urllib.request.build_opener") as opener_factory:
            opener = opener_factory.return_value
            opener.open.side_effect = urllib.error.HTTPError("https://api.ebird.org/v2/test", 403, TEST_TOKEN, {}, None)
            with self.assertRaises(SourceError) as failure:
                request_json("https://api.ebird.org/v2/test", {"X-eBirdApiToken": TEST_TOKEN})
            self.assertNotIn(TEST_TOKEN, str(failure.exception))
            self.assertIn("403", str(failure.exception))
            with self.assertRaises(SourceError):
                request_json("https://api.open-meteo.com/v1/forecast", {"X-eBirdApiToken": TEST_TOKEN})
            with self.assertRaises(SourceError):
                request_json("http://api.ebird.org/v2/test", {"X-eBirdApiToken": TEST_TOKEN})
            redirect_handler = opener_factory.call_args.args[0]
            self.assertIsNone(redirect_handler.redirect_request(None, None, 302, "Moved", {}, "https://other.example/"))

    def test_html_and_non_json_responses_do_not_pass_as_successful_api_data(self):
        with patch("pipeline.sources.urllib.request.build_opener") as opener_factory:
            opener_factory.return_value.open.return_value = JsonResponse({"error": "html"}, "text/html")
            with self.assertRaises(SourceError):
                request_json("https://api.open-meteo.com/v1/forecast")

    def test_weather_adapter_preserves_depth_units_grid_position_and_utc(self):
        def response(url, headers=None):
            self.assertIsNone(headers)
            self.assertIn("timezone=GMT", url)
            self.assertIn("wind_speed_unit=ms", url)
            return weather_response()
        result = fetch_weather(LOCATIONS, NOW.date(), 1, NOW, requester=response)
        self.assertEqual(result["status"], "available")
        location = result["locations"][0]
        self.assertEqual(location["longitude"], -73.69)
        self.assertEqual(location["requested_longitude"], -73.68)
        self.assertIsNone(result["model_initialization_at"])
        self.assertEqual(location["hours"][0]["time"], "2026-11-07T00:00:00Z")
        self.assertEqual(location["hours"][0]["soil_moisture_fraction"], 0.3)

    def test_weather_wrong_array_lengths_non_utc_and_incorrect_units_fail(self):
        for malformed in ["length", "timezone", "unit", "nan"]:
            payload = weather_response()
            if malformed == "length":
                payload["hourly"]["soil_temperature_6cm"] = [18]
            elif malformed == "timezone":
                payload["utc_offset_seconds"] = 3600
            elif malformed == "unit":
                payload["hourly_units"]["soil_temperature_6cm"] = "°F"
            else:
                payload["hourly"]["soil_temperature_6cm"][0] = float("nan")
            with self.subTest(malformed=malformed), self.assertRaises(SourceError):
                fetch_weather(LOCATIONS, NOW.date(), 1, NOW, requester=lambda *args, **kwargs: payload)

    def test_tick_records_enforce_license_privacy_precision_and_utc_provenance(self):
        records, exclusions = normalize_inaturalist_records([
            tick_record(), tick_record(id=2, license_code="cc-by-nc"), tick_record(id=3, obscured=True),
            tick_record(id=4, geoprivacy="obscured"), tick_record(id=5, positional_accuracy=None),
            tick_record(id=6, positional_accuracy=1001), tick_record(id=7, taxon_geoprivacy="private"),
        ])
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["properties"]["observed_at"], "2026-11-07T15:30:00Z")
        self.assertEqual(records[0]["properties"]["license"], "cc-by")
        self.assertEqual(sum(exclusions.values()), 6)

    def test_tick_pagination_cap_never_becomes_a_complete_zero_window(self):
        requested_urls = []
        def response(url, headers=None):
            requested_urls.append(url)
            return {"total_results": 2000, "results": [tick_record()]}
        result = fetch_tick_observations([-74, 42, -73, 43], NOW, requester=response, maximum_pages=2)
        self.assertLessEqual(len(requested_urls), 2)
        self.assertFalse(result["window_complete"])
        self.assertEqual(result["status"], "partial")
        self.assertFalse(result["cohort_compatible"])

    def test_a_failed_later_tick_page_keeps_the_records_already_fetched(self):
        def response(url, headers=None):
            page_number = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)["page"][0]
            if page_number == "2":
                raise SourceError("api.inaturalist.org connection failed")
            return {"total_results": 201, "results": [tick_record(id=identifier) for identifier in range(1, 201)]}
        result = fetch_tick_observations([-74, 42, -73, 43], NOW, requester=response)
        self.assertEqual(len(result["observations"]), 200)
        self.assertEqual(result["status"], "partial")
        self.assertFalse(result["window_complete"])
        self.assertEqual(result["fetched_records"], 200)
        self.assertEqual(result["reported_total"], 201)
        self.assertIn("Tick observation request failed on page 2", result["errors"])

    def test_a_failed_first_tick_page_is_unavailable_without_inventing_counts(self):
        def failing(url, headers=None):
            raise SourceError("api.inaturalist.org connection failed")
        result = fetch_tick_observations([-74, 42, -73, 43], NOW, requester=failing)
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["observations"], [])
        self.assertFalse(result["window_complete"])
        self.assertEqual(result["fetched_records"], 0)
        self.assertIsNone(result["reported_total"])
        self.assertIn("Tick observation request failed on page 1", result["errors"])

    def test_weather_requests_the_pinned_dates_and_rejects_a_different_provider_window(self):
        requested_queries = []
        def response(url, headers=None):
            requested_queries.append(urllib.parse.parse_qs(urllib.parse.urlsplit(url).query))
            return weather_response(2)
        fetch_weather(LOCATIONS, NOW.date(), 2, NOW, requester=response)
        self.assertEqual(requested_queries[0]["start_date"], ["2026-11-07"])
        self.assertEqual(requested_queries[0]["end_date"], ["2026-11-08"])
        self.assertNotIn("forecast_days", requested_queries[0])
        with self.assertRaises(SourceError):
            fetch_weather(LOCATIONS, NOW.date() + timedelta(days=1), 2, NOW, requester=response)

    def test_bird_authentication_failure_stops_remaining_guild_requests(self):
        call_count = 0
        def forbidden(url, headers=None):
            nonlocal call_count
            call_count += 1
            raise SourceError("eBird request failed (HTTP 403)", http_status=403)
        result = fetch_bird_observations("US-NY", TEST_TOKEN, NOW, requester=forbidden)
        self.assertEqual(call_count, 1)
        self.assertEqual(result["status"], "unavailable")
        self.assertNotIn(TEST_TOKEN, json.dumps(result))

    def test_duplicate_paginated_tick_records_do_not_establish_completeness(self):
        result = fetch_tick_observations([-74, 42, -73, 43], NOW,
            requester=lambda *args, **kwargs: {"total_results": 2, "results": [tick_record(), tick_record()]})
        self.assertFalse(result["window_complete"])
        self.assertEqual(result["status"], "partial")

    def test_malformed_nested_source_shapes_are_rejected_without_crashing(self):
        records, exclusions = normalize_inaturalist_records([tick_record(geojson=[]), tick_record(taxon={"id": 9, "ancestor_ids": None})])
        self.assertEqual(records, [])
        self.assertEqual(sum(exclusions.values()), 2)
        payload = weather_response()
        payload["hourly_units"] = []
        with self.assertRaises(SourceError):
            fetch_weather(LOCATIONS, NOW.date(), 1, NOW, requester=lambda *args, **kwargs: payload)

    def test_duplicate_weather_timestamps_are_rejected_at_the_adapter_boundary(self):
        payload = weather_response()
        payload["hourly"]["time"][1] = payload["hourly"]["time"][0]
        with self.assertRaises(SourceError):
            fetch_weather(LOCATIONS, NOW.date(), 1, NOW, requester=lambda *args, **kwargs: payload)

    def test_malformed_optional_tick_records_are_excluded_without_aborting_the_source(self):
        result = fetch_tick_observations([-74, 42, -73, 43], NOW, requester=lambda *args, **kwargs: {
            "total_results": 3, "results": [tick_record(), tick_record(id=2, time_observed_at=123), tick_record(id=[])]})
        self.assertEqual(len(result["observations"]), 1)
        self.assertEqual(result["status"], "partial")
        self.assertFalse(result["window_complete"])

    def test_observation_labels_and_taxon_ids_match_the_public_contract(self):
        birds, _ = normalize_ebird_records([bird_record(comName={"unexpected": "object"}, sciName=42)], "amerob")
        self.assertIsNone(birds[0]["properties"]["common_name"])
        self.assertIsNone(birds[0]["properties"]["scientific_name"])
        ticks, exclusions = normalize_inaturalist_records([
            tick_record(taxon={"id": 51672, "name": ["unexpected"]}),
            tick_record(id=2, taxon={"ancestor_ids": [51672], "name": "Ixodes"}),
        ])
        self.assertEqual(len(ticks), 1)
        self.assertIsNone(ticks[0]["properties"]["scientific_name"])
        self.assertEqual(ticks[0]["properties"]["taxon_id"], 51672)
        self.assertEqual(sum(exclusions.values()), 1)


if __name__ == "__main__":
    unittest.main()
