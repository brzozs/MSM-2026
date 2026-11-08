import json
import tempfile
import unittest
import urllib.parse
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from pipeline.weather_grid import fetch_weather_grid
from pipeline.sources import SourceError
from pipeline.tests.test_sources import LOCATIONS, NOW, weather_response


class WeatherGridCollectionTests(unittest.TestCase):
    def setUp(self):
        self.locations = [{**LOCATIONS[0], "id": f"sample-{index}"} for index in range(65)]
        self.requests = []
        self.requested_start_dates = []

    def response(self, url, headers=None):
        location_count = len(urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)["latitude"][0].split(","))
        self.requests.append(location_count)
        self.requested_start_dates.append(urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)["start_date"][0])
        payload = [weather_response() for _ in range(location_count)]
        return payload if location_count > 1 else payload[0]

    def test_large_grid_uses_bounded_paced_batches_and_reuses_public_cache(self):
        with tempfile.TemporaryDirectory() as directory, patch("pipeline.weather_grid.time.sleep") as sleep, \
             patch("pipeline.weather_grid.time.monotonic", return_value=0):
            result = fetch_weather_grid(self.locations, NOW.date(), 1, NOW, requester=self.response,
                cache_directory=Path(directory), clock=lambda: NOW)
            self.assertEqual(self.requests, [64, 1])
            self.assertEqual(len(result["locations"]), 65)
            self.assertEqual(result["batches_fetched"], 2)
            self.assertGreaterEqual(sleep.call_args.args[0], 6.4)
            def forbidden_request(*args, **kwargs):
                self.fail("A fresh valid cached batch must not issue a new request")
            cached = fetch_weather_grid(self.locations, NOW.date(), 1, NOW + timedelta(minutes=30), requester=forbidden_request,
                cache_directory=Path(directory), clock=lambda: NOW + timedelta(minutes=30))
            self.assertEqual(cached["cache_hit_batches"], 2)
            self.assertEqual(cached["batches_fetched"], 0)
            self.assertEqual(cached["data_retrieved_at"], "2026-11-07T23:00:00Z")

    def test_corrupt_and_stale_cached_batches_are_refetched(self):
        initial_time = NOW.replace(hour=1)
        with tempfile.TemporaryDirectory() as directory, patch("pipeline.weather_grid.time.sleep"):
            arguments = {"requester": self.response, "cache_directory": Path(directory), "clock": lambda: initial_time}
            fetch_weather_grid(self.locations[:1], NOW.date(), 1, initial_time, **arguments)
            cache_path = next(Path(directory).glob("*.json"))
            cache_path.write_text("{broken json")
            fetch_weather_grid(self.locations[:1], NOW.date(), 1, initial_time, **arguments)
            self.assertEqual(self.requests, [1, 1])
            later_time = initial_time + timedelta(hours=7)
            fetch_weather_grid(self.locations[:1], NOW.date(), 1, later_time, requester=self.response,
                cache_directory=Path(directory), clock=lambda: later_time)
            self.assertEqual(self.requests, [1, 1, 1])

    def test_a_failed_later_batch_resumes_from_the_completed_batch(self):
        with tempfile.TemporaryDirectory() as directory, patch("pipeline.weather_grid.time.sleep"), \
             patch("pipeline.weather_grid.time.monotonic", return_value=0):
            def fail_second_batch(url, headers=None):
                if len(self.requests) == 1:
                    raise SourceError("Temporary provider failure")
                return self.response(url, headers)
            with self.assertRaises(SourceError):
                fetch_weather_grid(self.locations, NOW.date(), 1, NOW, requester=fail_second_batch,
                    cache_directory=Path(directory), clock=lambda: NOW)
            self.assertEqual(len(list(Path(directory).glob("*.json"))), 1)
            resumed = fetch_weather_grid(self.locations, NOW.date(), 1, NOW, requester=self.response,
                cache_directory=Path(directory), clock=lambda: NOW)
            self.assertEqual(resumed["cache_hit_batches"], 1)
            self.assertEqual(self.requests, [64, 1])

    def test_batches_crossing_utc_midnight_share_one_pinned_forecast_window_and_cache(self):
        clock_readings = iter([NOW.replace(hour=23, minute=59, second=59)])
        after_midnight = NOW.replace(hour=0) + timedelta(days=1)
        with tempfile.TemporaryDirectory() as directory, patch("pipeline.weather_grid.time.sleep"),              patch("pipeline.weather_grid.time.monotonic", return_value=0):
            fetch_weather_grid(self.locations, NOW.date(), 1, NOW, requester=self.response,
                cache_directory=Path(directory), clock=lambda: next(clock_readings, after_midnight))
            self.assertEqual(self.requested_start_dates, ["2026-11-07", "2026-11-07"])
            def forbidden_request(*args, **kwargs):
                self.fail("The same pinned window must reuse its checkpoints after midnight")
            cached = fetch_weather_grid(self.locations, NOW.date(), 1, after_midnight, requester=forbidden_request,
                cache_directory=Path(directory), clock=lambda: after_midnight)
            self.assertEqual(cached["cache_hit_batches"], 2)
            self.assertEqual(cached["forecast_start_date"], "2026-11-07")

    def test_a_run_exceeding_the_free_service_budget_is_rejected_before_networking(self):
        def forbidden_request(*args, **kwargs):
            self.fail("Over-budget request must be rejected before networking")
        with self.assertRaises(ValueError):
            fetch_weather_grid(self.locations[:1] * 4501, NOW.date(), 1, NOW, requester=forbidden_request)


if __name__ == "__main__":
    unittest.main()
