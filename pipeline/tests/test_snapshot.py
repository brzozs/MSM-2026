import copy
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from pipeline.__main__ import main
from pipeline.snapshot import build_snapshot, validate_sampling_locations, write_snapshot_atomically
from pipeline.sources import SourceError, fetch_tick_observations, fetch_weather, normalize_ebird_records
from pipeline.tests.test_sources import LOCATIONS, NOW, TEST_TOKEN, bird_record, tick_record, weather_response


def live_shaped_inputs():
    weather = fetch_weather(LOCATIONS, 7, NOW, requester=lambda *args, **kwargs: weather_response(7))
    birds = {"provider": "ebird", "status": "available", "retrieved_at": "2026-11-07T23:00:00Z",
             "window_complete": False, "observations": normalize_ebird_records([bird_record()], "amerob")[0],
             "credentials": {"X-eBirdApiToken": TEST_TOKEN}}
    ticks = {"provider": "inaturalist", "status": "available", "retrieved_at": "2026-11-07T23:00:00Z",
             "window_complete": True, "cohort_compatible": False, "reported_total": 0, "observations": []}
    return weather, birds, ticks


class SnapshotContractTests(unittest.TestCase):
    def test_real_calculations_become_seven_date_aligned_geojson_frames(self):
        weather, birds, ticks = live_shaped_inputs()
        snapshot = build_snapshot(LOCATIONS, weather, birds, ticks, NOW)
        self.assertEqual(snapshot["model_version"], "vectorcast-heuristic-v1")
        self.assertEqual(len(snapshot["frames"]), 7)
        self.assertEqual(snapshot["frames"][0]["date"], "2026-11-07")
        self.assertEqual(snapshot["frames"][-1]["date"], "2026-11-13")
        feature = snapshot["frames"][0]["weather_suitability"]["features"][0]
        self.assertEqual(feature["geometry"]["coordinates"], [-73.69, 42.74])
        self.assertEqual(feature["properties"]["questing_index_0_to_100"], 100)
        self.assertEqual(feature["properties"]["valid_weather_hours"], 24)
        self.assertEqual(feature["properties"]["conditions_at_peak"]["soil_moisture_fraction"], 0.3)
        self.assertEqual(snapshot["frames"][3]["outlook"], "lower_confidence")
        self.assertNotIn(TEST_TOKEN, json.dumps(snapshot))
        self.assertNotIn("credentials", json.dumps(snapshot))

    def test_presence_summaries_and_unmatched_tick_cohorts_withhold_dependent_indices(self):
        weather, birds, ticks = live_shaped_inputs()
        snapshot = build_snapshot(LOCATIONS, weather, birds, ticks, NOW)
        components = snapshot["frames"][0]["weather_suitability"]["features"][0]["properties"]["activity_components"]
        for component in ["avian_activity_proxy", "tick_reporting_intensity", "stopover_potential", "ecological_activity_index"]:
            self.assertIsNone(components[component])
        self.assertEqual(snapshot["observations"]["birds"]["features"][0]["properties"]["observed_local"], "2026-11-07 08:30")
        self.assertEqual(snapshot["sources"]["ticks"]["displayed_record_count"], 0)

    def test_missing_source_remains_unavailable_instead_of_a_zero_report_window(self):
        weather, birds, ticks = live_shaped_inputs()
        ticks.update(status="unavailable", window_complete=False, reported_total=None)
        snapshot = build_snapshot(LOCATIONS, weather, birds, ticks, NOW)
        self.assertEqual(snapshot["sources"]["ticks"]["status"], "unavailable")
        self.assertIsNone(snapshot["sources"]["ticks"]["reported_total"])
        self.assertEqual(snapshot["frames"][0]["weather_suitability"]["features"][0]["properties"]["questing_index_0_to_100"], 100)

    def test_locations_reject_duplicates_non_finite_coordinates_and_excessive_batches(self):
        for locations in [LOCATIONS * 2, [{**LOCATIONS[0], "latitude": float("nan")}],
                          [{**LOCATIONS[0], "id": ""}], [],
                          [{**LOCATIONS[0], "id": str(index)} for index in range(4501)]]:
            with self.subTest(locations_count=len(locations)), self.assertRaises(ValueError):
                validate_sampling_locations(locations)

    def test_misaligned_dates_or_distant_weather_grid_points_are_rejected(self):
        for mutation in ["date", "distance", "identity"]:
            weather, birds, ticks = live_shaped_inputs()
            if mutation == "date":
                weather["locations"][0]["hours"][0]["time"] = "2026-11-06T00:00:00Z"
            elif mutation == "distance":
                weather["locations"][0]["longitude"] = -120
            else:
                weather["locations"][0]["id"] = "another-place"
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                build_snapshot(LOCATIONS, weather, birds, ticks, NOW)

    def test_atomic_writer_rejects_non_finite_or_secret_data_and_preserves_last_file(self):
        weather, birds, ticks = live_shaped_inputs()
        snapshot = build_snapshot(LOCATIONS, weather, birds, ticks, NOW)
        with tempfile.TemporaryDirectory() as directory:
            output_path = Path(directory) / "latest.json"
            write_snapshot_atomically(snapshot, output_path, secret_values=(TEST_TOKEN,))
            original_bytes = output_path.read_bytes()
            invalid_snapshot = copy.deepcopy(snapshot)
            invalid_snapshot["frames"][0]["weather_suitability"]["features"][0]["properties"]["questing_suitability"] = float("nan")
            with self.assertRaises(ValueError):
                write_snapshot_atomically(invalid_snapshot, output_path)
            self.assertEqual(output_path.read_bytes(), original_bytes)
            invalid_snapshot = {**snapshot, "unexpected_private_value": TEST_TOKEN}
            with self.assertRaises(ValueError):
                write_snapshot_atomically(invalid_snapshot, output_path, secret_values=(TEST_TOKEN,))
            self.assertEqual(output_path.read_bytes(), original_bytes)
            with patch("pipeline.snapshot.os.replace", side_effect=OSError("test write failure")), self.assertRaises(OSError):
                write_snapshot_atomically(snapshot, output_path)
            self.assertEqual(output_path.read_bytes(), original_bytes)
            self.assertEqual(sorted(path.name for path in Path(directory).iterdir()), ["latest.json"])

    def test_command_writes_public_data_and_partial_sources_have_a_distinct_exit_code(self):
        weather, birds, ticks = live_shaped_inputs()
        with tempfile.TemporaryDirectory() as directory:
            locations_path = Path(directory) / "locations.json"
            locations_path.write_text(json.dumps(LOCATIONS))
            output_path = Path(directory) / "latest.json"
            arguments = ["--locations", str(locations_path), "--output", str(output_path)]
            stdout, stderr = io.StringIO(), io.StringIO()
            with patch("pipeline.__main__.fetch_weather_grid", return_value=weather), \
                 patch("pipeline.__main__.fetch_bird_observations", return_value=birds), \
                 patch("pipeline.__main__.fetch_tick_observations", return_value=ticks), \
                 patch("pipeline.__main__.load_ebird_api_key", return_value=TEST_TOKEN), \
                 redirect_stdout(stdout), redirect_stderr(stderr):
                result = main(arguments, generated_at=NOW)
            self.assertEqual(result, 0)
            self.assertEqual(len(json.loads(output_path.read_text())["frames"]), 7)
            self.assertNotIn(TEST_TOKEN, stdout.getvalue() + stderr.getvalue() + output_path.read_text())
            ticks.update(status="unavailable", window_complete=False, reported_total=None)
            with patch("pipeline.__main__.fetch_weather_grid", return_value=weather), \
                 patch("pipeline.__main__.fetch_bird_observations", return_value=birds), \
                 patch("pipeline.__main__.fetch_tick_observations", return_value=ticks), \
                 patch("pipeline.__main__.load_ebird_api_key", return_value=TEST_TOKEN), \
                 redirect_stdout(stdout), redirect_stderr(stderr):
                self.assertEqual(main(arguments, generated_at=NOW), 2)

    def test_weather_failure_preserves_existing_output_and_redacts_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            output_path = Path(directory) / "latest.json"
            output_path.write_text('{"last_good":true}')
            stdout, stderr = io.StringIO(), io.StringIO()
            with patch("pipeline.__main__.fetch_weather_grid", side_effect=SourceError(TEST_TOKEN)), \
                 patch("pipeline.__main__.load_ebird_api_key", return_value=TEST_TOKEN), \
                 redirect_stdout(stdout), redirect_stderr(stderr):
                self.assertEqual(main(["--output", str(output_path)], generated_at=NOW), 1)
            self.assertEqual(output_path.read_text(), '{"last_good":true}')
            self.assertNotIn(TEST_TOKEN, stdout.getvalue() + stderr.getvalue())

    def test_malformed_optional_observations_do_not_prevent_weather_publication(self):
        weather, birds, _ = live_shaped_inputs()
        def malformed_ticks(bounds, retrieved_at):
            return fetch_tick_observations(bounds, retrieved_at, requester=lambda *args, **kwargs: {
                "total_results": 2, "results": [tick_record(time_observed_at=123), tick_record(id=[])]})
        with tempfile.TemporaryDirectory() as directory:
            locations_path = Path(directory) / "locations.json"
            locations_path.write_text(json.dumps(LOCATIONS))
            output_path = Path(directory) / "latest.json"
            with patch("pipeline.__main__.fetch_weather_grid", return_value=weather), \
                 patch("pipeline.__main__.fetch_bird_observations", return_value=birds), \
                 patch("pipeline.__main__.fetch_tick_observations", side_effect=malformed_ticks), \
                 patch("pipeline.__main__.load_ebird_api_key", return_value=TEST_TOKEN), \
                 redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                result = main(["--locations", str(locations_path), "--output", str(output_path)], generated_at=NOW)
            self.assertEqual(result, 2)
            published = json.loads(output_path.read_text())
            self.assertEqual(published["frames"][0]["weather_suitability"]["features"][0]["properties"]["questing_index_0_to_100"], 100)
            self.assertEqual(published["sources"]["ticks"]["status"], "partial")

    def test_cached_weather_does_not_gain_a_new_freshness_window(self):
        weather, birds, ticks = live_shaped_inputs()
        weather["retrieved_at"] = "2026-11-07T20:00:00Z"
        weather["data_retrieved_at"] = "2026-11-07T20:00:00Z"
        snapshot = build_snapshot(LOCATIONS, weather, birds, ticks, NOW)
        self.assertEqual(snapshot["stale_after"], "2026-11-08T08:00:00Z")


if __name__ == "__main__":
    unittest.main()
