import io
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from pipeline.habitat import fetch_reference_habitat


def snapshot():
    def point(identifier, state, longitude, latitude):
        return {'geometry': {'coordinates': [longitude, latitude]}, 'properties': {'location_id': identifier, 'state_code': state}}
    return {'frames': [{'weather_suitability': {'features': [point('ny1', 'NY', -74, 43), point('ny2', 'NY', -73, 43),
        point('ca', 'CA', -120, 36), point('ak', 'AK', -150, 65), point('hi', 'HI', -155, 20)]}}]}


class HabitatTests(unittest.TestCase):
    def test_sparse_conus_reference_samples_cache_original_vintage_and_age(self):
        response = json.dumps({'features': [{'properties': {'PALETTE_INDEX': 41}}]}).encode()
        original_time = datetime(2026, 11, 8, 12, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as directory:
            with patch('pipeline.habitat.urllib.request.urlopen', side_effect=lambda *args, **kwargs: io.BytesIO(response)) as request:
                habitat = fetch_reference_habitat(snapshot(), directory, original_time)
            self.assertEqual(request.call_count, 2)
            self.assertEqual(habitat['sampled_location_count'], 2)
            self.assertEqual(habitat['status'], 'partial')
            self.assertEqual(habitat['dataset_year'], 2025)
            self.assertNotIn('ak', habitat['samples'])
            self.assertNotIn('hi', habitat['samples'])
            request_url = request.call_args_list[0].args[0]
            self.assertIn('time=2025-01-01T00%3A00%3A00Z', request_url)
            with patch('pipeline.habitat.urllib.request.urlopen', side_effect=AssertionError('static cache should avoid requests')):
                cached = fetch_reference_habitat(snapshot(), directory, datetime(2026, 11, 9, tzinfo=timezone.utc))
            self.assertEqual(cached['data_retrieved_at'], habitat['data_retrieved_at'])
            self.assertEqual(cached['cache_hit_count'], 2)

    def test_nodata_failure_and_malformed_response_leave_other_samples_available(self):
        def response_for_url(url, **kwargs):
            payload = {'features': [{'properties': {'PALETTE_INDEX': 250 if 'bbox=-74.' in url else 42}}]}
            return io.BytesIO(json.dumps(payload).encode())
        with tempfile.TemporaryDirectory() as directory:
            with patch('pipeline.habitat.urllib.request.urlopen', side_effect=response_for_url):
                result = fetch_reference_habitat(snapshot(), directory, datetime(2026, 11, 8, tzinfo=timezone.utc))
            self.assertEqual(result['sampled_location_count'], 1)
            self.assertEqual(result['status'], 'partial')
            self.assertEqual(len(result['errors']), 1)
            self.assertEqual(len(list(Path(directory).glob('*.json'))), 1)
        for response in [b'not JSON', b'{}', b'{"features":[{"properties":{"PALETTE_INDEX":true}}]}']:
            with tempfile.TemporaryDirectory() as directory:
                with patch('pipeline.habitat.urllib.request.urlopen', side_effect=lambda *args, **kwargs: io.BytesIO(response)):
                    result = fetch_reference_habitat(snapshot(), directory, datetime(2026, 11, 8, tzinfo=timezone.utc))
                self.assertEqual(result['status'], 'unavailable')
                self.assertEqual(result['samples'], {})
                self.assertEqual(len(list(Path(directory).glob('*.json'))), 0)

    def test_bad_cache_is_rejected_and_refetched_instead_of_becoming_measured_habitat(self):
        response = b'{"features":[{"properties":{"PALETTE_INDEX":41}}]}'
        with tempfile.TemporaryDirectory() as directory:
            with patch('pipeline.habitat.urllib.request.urlopen', side_effect=lambda *args, **kwargs: io.BytesIO(response)):
                fetch_reference_habitat(snapshot(), directory, datetime(2026, 11, 8, tzinfo=timezone.utc))
            for cache_path in Path(directory).glob('*.json'):
                cache_path.write_text('{"land_cover_class":41,"coordinate":[0,0]}')
            with patch('pipeline.habitat.urllib.request.urlopen', side_effect=lambda *args, **kwargs: io.BytesIO(response)) as request:
                result = fetch_reference_habitat(snapshot(), directory, datetime(2026, 11, 9, tzinfo=timezone.utc))
            self.assertEqual(request.call_count, 2)
            self.assertEqual(result['cache_hit_count'], 0)

    def test_malformed_cached_retrieval_time_does_not_abort_optional_collection(self):
        response = b'{"features":[{"properties":{"PALETTE_INDEX":41}}]}'
        for invalid_timestamp in (None, 123, '2026-11-08T12:00:00'):
            with tempfile.TemporaryDirectory() as directory:
                with patch('pipeline.habitat.urllib.request.urlopen', side_effect=lambda *args, **kwargs: io.BytesIO(response)):
                    fetch_reference_habitat(snapshot(), directory, datetime(2026, 11, 8, tzinfo=timezone.utc))
                for cache_path in Path(directory).glob('*.json'):
                    data = json.loads(cache_path.read_text())
                    data['retrieved_at'] = invalid_timestamp
                    cache_path.write_text(json.dumps(data))
                with patch('pipeline.habitat.urllib.request.urlopen', side_effect=lambda *args, **kwargs: io.BytesIO(response)) as request:
                    result = fetch_reference_habitat(snapshot(), directory, datetime(2026, 11, 9, tzinfo=timezone.utc))
                self.assertEqual(request.call_count, 2)
                self.assertEqual(result['sampled_location_count'], 2)
