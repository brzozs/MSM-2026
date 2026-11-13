import copy
import io
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from pipeline.measured_migration import apply_measured_migration, fetch_measured_migration, is_night, summarize_radar_profile
from pipeline.snapshot import build_snapshot
from pipeline.tests.test_sources import LOCATIONS, NOW
from pipeline.tests.test_snapshot import live_shaped_inputs


class MeasuredMigrationTests(unittest.TestCase):
    def test_invalid_inventory_is_rejected_before_profile_collection(self):
        inventories = [
            b'<ListBucketResult><IsTruncated>false</IsTruncated><CommonPrefixes><Prefix/></CommonPrefixes></ListBucketResult>',
            b'<ListBucketResult><IsTruncated>false</IsTruncated><CommonPrefixes><Prefix>other/KABR/</Prefix></CommonPrefixes></ListBucketResult>',
            b'<ListBucketResult><IsTruncated>false</IsTruncated><CommonPrefixes><Prefix>nexrad/daily/KABR/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>nexrad/daily/KABR/</Prefix></CommonPrefixes></ListBucketResult>',
            b'<OtherResult><IsTruncated>false</IsTruncated><CommonPrefixes><Prefix>nexrad/daily/KABR/</Prefix></CommonPrefixes></OtherResult>',
            b'<ListBucketResult><IsTruncated>true</IsTruncated><CommonPrefixes><Prefix>nexrad/daily/KABR/</Prefix></CommonPrefixes></ListBucketResult>',
            b'<ListBucketResult><IsTruncated>false</IsTruncated>' + b' ' * 100000 + b'</ListBucketResult>',
        ]
        for inventory in inventories:
            with self.subTest(inventory=inventory[:100]), tempfile.TemporaryDirectory() as cache_directory:
                def inventory_response(url, timeout):
                    if '?list-type' not in url:
                        self.fail('An invalid inventory must not start profile collection')
                    return io.BytesIO(inventory)

                with patch('pipeline.measured_migration.urllib.request.urlopen', side_effect=inventory_response):
                    with self.assertRaisesRegex(ValueError, 'Unexpected BirdCast radar inventory'):
                        fetch_measured_migration(NOW, cache_directory)
                self.assertEqual(list(Path(cache_directory).iterdir()), [])

    def test_malformed_radar_rows_do_not_discard_other_valid_night_measurements(self):
        header = 'radar,datetime,height,height_reference,dens,gap,radar_latitude,radar_longitude,radar_height\n'
        rows = [f'KABR,2026-11-06T03:{minute:02d}:00Z,{height},sea,100,FALSE,45,-98,0'
                for minute in range(0, 60, 5) for height in [300, 400, 500]]
        rows.extend(['KABR,2026-11-06T04:00:00Z,300,sea,invalid,FALSE,45,-98,0',
                     'KABR,not-a-timestamp,300,sea,100,FALSE,45,-98,0',
                     'KABR,2026-11-06T04:00:00Z,300,sea,100'])
        summary = summarize_radar_profile(header + '\n'.join(rows), 'KABR', (NOW - timedelta(days=1)).date())
        self.assertEqual(summary['airborne_birds_per_square_km'], 30)
        self.assertEqual(summary['valid_night_profiles'], 12)
        with self.assertRaisesRegex(ValueError, 'Duplicate radar altitude/time bin'):
            summarize_radar_profile(header + '\n'.join([*rows, rows[0]]), 'KABR', (NOW - timedelta(days=1)).date())

    def test_invalid_radar_does_not_abort_other_radars_or_leave_an_invalid_cache(self):
        header = 'radar,datetime,height,height_reference,dens,gap,radar_latitude,radar_longitude,radar_height\n'
        rows = [f'KABR,2026-11-06T03:{minute:02d}:00Z,{height},sea,100,FALSE,45,-98,0'
                for minute in range(0, 60, 5) for height in [300, 400, 500]]
        valid_profile = header + '\n'.join(rows)
        invalid_profile = (header + '\n'.join([*rows, rows[0]])).replace('KABR', 'KABX')
        inventory = b'<ListBucketResult><IsTruncated>false</IsTruncated><CommonPrefixes><Prefix>nexrad/daily/KABR/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>nexrad/daily/KABX/</Prefix></CommonPrefixes></ListBucketResult>'

        def public_response(url, timeout):
            content = inventory if '?list-type' in url else valid_profile.encode() if '/KABR/' in url else invalid_profile.encode()
            return io.BytesIO(content)

        with tempfile.TemporaryDirectory() as cache_directory, patch('pipeline.measured_migration.urllib.request.urlopen', side_effect=public_response):
            summary = fetch_measured_migration(NOW, cache_directory)
            self.assertEqual(summary['status'], 'partial')
            self.assertEqual(summary['radars_checked'], 2)
            self.assertEqual(summary['valid_radar_count'], 1)
            self.assertEqual(summary['radars'][0]['airborne_birds_per_square_km'], 30)
            self.assertTrue(any('KABX' in error for error in summary['errors']))
            self.assertFalse((Path(cache_directory) / 'KABX-2026-11-06.csv').exists())

    def test_lost_local_radar_coverage_and_missing_weather_clear_radar_evidence(self):
        snapshot = build_snapshot(LOCATIONS, *live_shaped_inputs(), NOW)
        migration = {'provider': 'birdcast', 'observed_date': (NOW - timedelta(days=1)).date().isoformat(), 'radars': [{
            'coordinate': [LOCATIONS[0]['longitude'], LOCATIONS[0]['latitude']], 'radar': 'TEST',
            'airborne_birds_per_square_km': 100,
        }]}
        properties = snapshot['frames'][0]['weather_suitability']['features'][0]['properties']
        properties['questing_suitability'] = None
        apply_measured_migration(snapshot, migration, NOW)
        self.assertIsNone(properties['tick_prediction_index'])
        properties['questing_suitability'] = 0.5
        apply_measured_migration(snapshot, migration, NOW)
        self.assertEqual(properties['tick_prediction_index'], 0.5)
        distant_migration = {**migration, 'radars': [{**migration['radars'][0], 'coordinate': [-120, 35]}]}
        apply_measured_migration(snapshot, distant_migration, NOW)
        self.assertEqual(properties['tick_prediction_index'], 0.5)
        self.assertEqual(properties['migration_adjustment_status'], 'unavailable')
        self.assertNotIn('measured_migration', properties)

    def test_radar_outage_removes_previous_evidence_and_restores_unavailable_status(self):
        snapshot = build_snapshot(LOCATIONS, *live_shaped_inputs(), NOW)
        migration = {'provider': 'birdcast', 'observed_date': (NOW - timedelta(days=1)).date().isoformat(), 'radars': [{
            'coordinate': [LOCATIONS[0]['longitude'], LOCATIONS[0]['latitude']], 'radar': 'TEST',
            'airborne_birds_per_square_km': 100,
        }]}
        apply_measured_migration(snapshot, migration, NOW)
        apply_measured_migration(snapshot, {**migration, 'radars': []}, NOW)
        properties = snapshot['frames'][0]['weather_suitability']['features'][0]['properties']
        self.assertNotIn('measured_migration', properties)
        self.assertEqual(properties['migration_adjustment_status'], 'unavailable')
        self.assertEqual(properties['tick_prediction_index'], properties['questing_suitability'])
        self.assertEqual(sum(layer['id'] == 'measured_bird_movement' for layer in snapshot['unavailable_layers']), 1)

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

    def test_measured_density_attaches_evidence_without_changing_questing(self):
        snapshot = build_snapshot(LOCATIONS, *live_shaped_inputs(), NOW)
        for frame in snapshot['frames']:
            for point in frame['weather_suitability']['features']:
                point['properties']['questing_suitability'] = 0.5
        migration = {'provider': 'birdcast', 'observed_date': (NOW - timedelta(days=1)).date().isoformat(), 'radars': [{
            'coordinate': snapshot['frames'][0]['weather_suitability']['features'][0]['geometry']['coordinates'], 'radar': 'TEST',
            'airborne_birds_per_square_km': 100,
        }]}
        measured = apply_measured_migration(copy.deepcopy(snapshot), migration, NOW)
        properties = measured['frames'][0]['weather_suitability']['features'][0]['properties']
        self.assertEqual(properties['questing_suitability'], 0.5)
        self.assertEqual(properties['tick_prediction_index'], 0.5)
        self.assertEqual(properties['migration_adjustment_status'], 'measured')
        self.assertEqual(properties['measured_migration']['airborne_birds_per_square_km'], 100)
        self.assertEqual(properties['measured_migration']['distance_km'], 0)
        missing = apply_measured_migration(snapshot, {**migration, 'radars': []}, NOW)
        self.assertEqual(missing['frames'][0]['weather_suitability']['features'][0]['properties']['tick_prediction_index'], 0.5)
        for offset in [-1, 3]:
            with self.assertRaises(ValueError):
                apply_measured_migration(snapshot, {**migration, 'observed_date': (NOW - timedelta(days=offset)).date().isoformat()}, NOW)
