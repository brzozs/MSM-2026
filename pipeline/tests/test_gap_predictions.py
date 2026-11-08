import copy
import tempfile
import unittest
from pathlib import Path

from pipeline.recover_cached_atlas import fill_snapshot_gaps
from pipeline.snapshot import build_snapshot, write_snapshot_atomically
from pipeline.tests.test_sources import LOCATIONS, NOW
from pipeline.tests.test_snapshot import live_shaped_inputs


class GapPredictionTests(unittest.TestCase):
    def snapshot(self):
        return build_snapshot(LOCATIONS, *live_shaped_inputs(), NOW)

    def missing_location(self):
        return {**LOCATIONS[0], 'id': 'missing-local-forecast', 'name': 'Estimated location', 'state_code': 'NY',
                'longitude': LOCATIONS[0]['longitude'] + 0.1, 'sampling_spacing_km': 50}

    def test_gap_estimates_keep_source_values_and_never_invent_weather_hours(self):
        snapshot = self.snapshot()
        original = copy.deepcopy(snapshot['frames'][0]['weather_suitability']['features'])
        fill_snapshot_gaps(snapshot, [*[{**location, 'state_code': 'NY'} for location in LOCATIONS], self.missing_location()])
        features = snapshot['frames'][0]['weather_suitability']['features']
        self.assertEqual(features[:-1], original)
        predicted = features[-1]['properties']
        self.assertTrue(predicted['is_predicted'])
        self.assertEqual(predicted['valid_weather_hours'], 0)
        self.assertIsNone(predicted['conditions_at_peak'])
        self.assertIsNone(predicted['factors_at_peak'])
        self.assertEqual(predicted['questing_suitability'], 1)
        self.assertEqual(snapshot['sources']['weather']['predicted_location_count'], 1)
        with tempfile.TemporaryDirectory() as directory:
            write_snapshot_atomically(snapshot, Path(directory) / 'snapshot.json')
            predicted['valid_weather_hours'] = 24
            with self.assertRaises(ValueError):
                write_snapshot_atomically(snapshot, Path(directory) / 'invalid.json')

    def test_missing_nearest_inputs_stay_unknown_and_extreme_distances_are_refused(self):
        snapshot = self.snapshot()
        for frame in snapshot['frames']:
            for point in frame['weather_suitability']['features']:
                point['properties']['questing_suitability'] = None
        fill_snapshot_gaps(snapshot, [*[{**location, 'state_code': 'NY'} for location in LOCATIONS], self.missing_location()])
        self.assertIsNone(snapshot['frames'][0]['weather_suitability']['features'][-1]['properties']['questing_suitability'])
        distant = {**self.missing_location(), 'longitude': 0, 'latitude': 0}
        with self.assertRaises(ValueError):
            fill_snapshot_gaps(self.snapshot(), [*[{**location, 'state_code': 'NY'} for location in LOCATIONS], distant])
