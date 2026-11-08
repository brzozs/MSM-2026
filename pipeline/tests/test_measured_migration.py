import copy
import unittest
from datetime import datetime, timedelta, timezone

from pipeline.measured_migration import apply_measured_migration, is_night, summarize_radar_profile
from pipeline.snapshot import build_snapshot
from pipeline.tests.test_sources import LOCATIONS, NOW
from pipeline.tests.test_snapshot import live_shaped_inputs


class MeasuredMigrationTests(unittest.TestCase):
    def test_radar_profiles_integrate_valid_night_layers_and_exclude_gaps_daylight(self):
        header = 'radar,datetime,height,height_reference,dens,gap,radar_latitude,radar_longitude,radar_height\n'
        rows = [f'KABR,2026-11-06T03:{minute:02d}:00Z,{height},sea,100,FALSE,45,-98,0'
                for minute in range(0, 60, 5) for height in [300, 400, 500]]
        rows.extend(['KABR,2026-11-06T18:00:00Z,300,sea,99999,FALSE,45,-98,0',
                     'KABR,2026-11-06T04:00:00Z,300,sea,99999,TRUE,45,-98,0'])
        summary = summarize_radar_profile(header + '\n'.join(rows), 'KABR', (NOW - timedelta(days=1)).date())
        self.assertEqual(summary['airborne_birds_per_square_km'], 30)
        self.assertEqual(summary['valid_night_profiles'], 12)
        self.assertIsNone(summarize_radar_profile(header, 'KABR', NOW.date()))
        self.assertFalse(is_night(datetime(2026, 6, 21, 12, tzinfo=timezone.utc), 0, 0))
        self.assertTrue(is_night(datetime(2026, 6, 21, 0, tzinfo=timezone.utc), 0, 0))

    def test_measured_density_changes_the_index_without_a_seasonal_substitute(self):
        snapshot = build_snapshot(LOCATIONS, *live_shaped_inputs(), NOW)
        for frame in snapshot['frames']:
            for point in frame['weather_suitability']['features']:
                point['properties']['questing_suitability'] = 0.5
        migration = {'provider': 'birdcast', 'observed_date': (NOW - timedelta(days=1)).date().isoformat(), 'radars': [{
            'coordinate': [LOCATIONS[0]['longitude'], LOCATIONS[0]['latitude']], 'radar': 'TEST',
            'airborne_birds_per_square_km': 100,
        }]}
        measured = apply_measured_migration(copy.deepcopy(snapshot), migration, NOW)
        properties = measured['frames'][0]['weather_suitability']['features'][0]['properties']
        self.assertEqual(properties['questing_suitability'], 0.5)
        self.assertAlmostEqual(properties['tick_prediction_index'], 0.55)
        self.assertEqual(properties['migration_adjustment_status'], 'measured')
        missing = apply_measured_migration(snapshot, {**migration, 'radars': []}, NOW)
        self.assertEqual(missing['frames'][0]['weather_suitability']['features'][0]['properties']['tick_prediction_index'], 0.5)
        for offset in [-1, 3]:
            with self.assertRaises(ValueError):
                apply_measured_migration(snapshot, {**migration, 'observed_date': (NOW - timedelta(days=offset)).date().isoformat()}, NOW)
