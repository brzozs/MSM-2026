import copy
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path
from unittest.mock import patch

from pipeline.coverage import generate_sampling_locations
from pipeline.measured_migration import main as attach_measured_migration
from pipeline.national_snapshot import assign_observations_to_states, publish_national_snapshot
from pipeline.snapshot import build_snapshot
from pipeline.tests.test_coverage import BOUNDARIES_PATH, EXPECTED_CODES, state_feature
from pipeline.tests.test_snapshot import live_shaped_inputs
from pipeline.tests.test_sources import NOW, TEST_TOKEN


class NationalSnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.boundaries = json.loads(BOUNDARIES_PATH.read_text())
        first_locations = {}
        for location in generate_sampling_locations(cls.boundaries):
            first_locations.setdefault(location["state_code"], location)
        cls.locations = list(first_locations.values())

    def snapshot(self):
        weather, birds, ticks = live_shaped_inputs()
        weather_template = weather["locations"][0]
        weather["locations"] = [{**copy.deepcopy(weather_template), **location,
            "requested_latitude": location["latitude"], "requested_longitude": location["longitude"]} for location in self.locations]
        return build_snapshot(self.locations, weather, birds, ticks, NOW, region_code="US")

    def test_national_manifest_links_to_all_51_state_sized_snapshots_and_overview(self):
        snapshot = self.snapshot()
        with tempfile.TemporaryDirectory() as directory:
            manifest_path = Path(directory) / "latest.json"
            manifest = publish_national_snapshot(snapshot, self.boundaries, manifest_path, secret_values=(TEST_TOKEN,))
            self.assertEqual(manifest["kind"], "ecology-atlas")
            self.assertEqual(manifest["state_count"], 51)
            self.assertEqual({state["state_code"] for state in manifest["states"]}, EXPECTED_CODES)
            self.assertEqual(json.loads(manifest_path.read_text()), manifest)
            for state in manifest["states"]:
                self.assertFalse(Path(state["snapshot_url"]).is_absolute())
                state_snapshot = json.loads((manifest_path.parent / state["snapshot_url"]).read_text())
                self.assertEqual(state_snapshot["model_version"], "vectorcast-heuristic-v1")
                self.assertEqual(state_snapshot["scope"]["region_code"], "US-" + state["state_code"])
                self.assertEqual(len(state_snapshot["frames"]), 7)
                self.assertEqual(state_snapshot["frames"][0]["weather_suitability"]["features"][0]["properties"]["state_code"], state["state_code"])
                if state["state_code"] != "NY":
                    self.assertEqual(state_snapshot["observations"]["birds"]["features"], [])
            overview = json.loads((manifest_path.parent / manifest["overview_url"]).read_text())
            self.assertEqual(overview["kind"], "ecology-overview")
            self.assertEqual(len(overview["frames"][0]["weather_suitability"]["features"]), 51)
            self.assertNotIn("conditions_at_peak", overview["frames"][0]["weather_suitability"]["features"][0]["properties"])

    def test_boundary_reports_are_assigned_once_and_antimeridian_reports_are_kept(self):
        first = state_feature("AL", [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]])
        second = state_feature("DC", [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]])
        alaska = state_feature("AK", [[[175, 50], [-175, 50], [-175, 51], [175, 51], [175, 50]]])
        features = [{"type": "Feature", "id": identifier, "geometry": {"type": "Point", "coordinates": coordinates}, "properties": {}}
                    for identifier, coordinates in [("border", [1, 0.5]), ("dateline", [-179, 50.5]), ("outside", [10, 10])]]
        assignments, unassigned = assign_observations_to_states({"features": [second, alaska, first]}, features)
        self.assertEqual([feature["id"] for feature in assignments["AL"]], ["border"])
        self.assertEqual(assignments["DC"], [])
        self.assertEqual([feature["id"] for feature in assignments["AK"]], ["dateline"])
        self.assertEqual([feature["id"] for feature in unassigned], ["outside"])

    def test_failed_state_publication_or_secret_match_preserves_previous_manifest(self):
        for failure_kind in ["write", "secret"]:
            snapshot = self.snapshot()
            with tempfile.TemporaryDirectory() as directory:
                manifest_path = Path(directory) / "latest.json"
                manifest_path.write_text('{"previous":true}')
                if failure_kind == "secret":
                    snapshot["semantics"]["private_value"] = TEST_TOKEN
                    with self.assertRaises(ValueError):
                        publish_national_snapshot(snapshot, self.boundaries, manifest_path, secret_values=(TEST_TOKEN,))
                else:
                    with patch("pipeline.national_snapshot.write_snapshot_atomically", side_effect=OSError("state write failed")), self.assertRaises(OSError):
                        publish_national_snapshot(snapshot, self.boundaries, manifest_path)
                self.assertEqual(manifest_path.read_text(), '{"previous":true}')
                self.assertEqual([path.name for path in Path(directory).iterdir()], ["latest.json"])

    def test_locations_and_selected_days_use_their_own_inputs(self):
        weather, birds, ticks = live_shaped_inputs()
        locations = [self.locations[0], self.locations[1]]
        template = weather["locations"][0]
        weather["locations"] = [{**copy.deepcopy(template), **location} for location in locations]
        for index, location in enumerate(weather["locations"]):
            for hour in location["hours"]:
                date = hour["time"][:10]
                hour["soil_temperature_c"] = 7 if (index == 0 and date == "2026-11-07") or (index == 1 and date == "2026-11-08") else 18
        snapshot = build_snapshot(locations, weather, birds, ticks, NOW, region_code="US")
        first_day = [feature["properties"]["questing_index_0_to_100"] for feature in snapshot["frames"][0]["weather_suitability"]["features"]]
        next_day = [feature["properties"]["questing_index_0_to_100"] for feature in snapshot["frames"][1]["weather_suitability"]["features"]]
        self.assertEqual(first_day, [0, 100])
        self.assertEqual(next_day, [100, 0])

    def test_overview_display_count_excludes_unassigned_reports_without_losing_source_total(self):
        snapshot = self.snapshot()
        original = snapshot["observations"]["birds"]["features"][0]
        snapshot["observations"]["birds"]["features"].append({**original, "id": "offshore-report",
            "geometry": {"type": "Point", "coordinates": [-73, 35]}})
        snapshot["sources"]["birds"]["displayed_record_count"] = 2
        with tempfile.TemporaryDirectory() as directory:
            manifest_path = Path(directory) / "latest.json"
            manifest = publish_national_snapshot(snapshot, self.boundaries, manifest_path)
            overview = json.loads((manifest_path.parent / manifest["overview_url"]).read_text())
            self.assertEqual(len(overview["observations"]["birds"]["features"]), 1)
            self.assertEqual(overview["sources"]["birds"]["displayed_record_count"], 1)
            self.assertEqual(overview["sources"]["birds"]["source_query_eligible_record_count"], 2)
            self.assertEqual(overview["sources"]["birds"]["unassigned_observation_count"], 1)

    def test_republishing_overview_preserves_national_query_counts_for_every_region(self):
        snapshot = self.snapshot()
        original = snapshot['observations']['birds']['features'][0]
        for observation_kind, assigned_count, unassigned_count in [('birds', 1131, 22), ('ticks', 3, 2)]:
            snapshot['observations'][observation_kind]['features'] = [
                {**original, 'id': f'{observation_kind}-{index}'} for index in range(assigned_count)] + [
                {**original, 'id': f'{observation_kind}-offshore-{index}',
                    'geometry': {'type': 'Point', 'coordinates': [-73, 35]}} for index in range(unassigned_count)]
            snapshot['sources'][observation_kind]['displayed_record_count'] = assigned_count + unassigned_count
        with tempfile.TemporaryDirectory() as directory:
            manifest_path = Path(directory) / 'latest.json'
            for publication_number in range(3):
                manifest = publish_national_snapshot(snapshot, self.boundaries, manifest_path)
                overview = json.loads((manifest_path.parent / manifest['overview_url']).read_text())
                for observation_kind, expected_counts in [('birds', (1131, 1153, 22)), ('ticks', (3, 5, 2))]:
                    with self.subTest(publication=publication_number, observation_kind=observation_kind):
                        source = overview['sources'][observation_kind]
                        self.assertEqual((source['displayed_record_count'], source['source_query_eligible_record_count'],
                            source['unassigned_observation_count']), expected_counts)
                        for state in manifest['states']:
                            regional = json.loads((manifest_path.parent / state['snapshot_url']).read_text())
                            regional_source = regional['sources'][observation_kind]
                            self.assertEqual(regional_source['displayed_record_count'],
                                expected_counts[0] if state['state_code'] == 'NY' else 0)
                            self.assertEqual(regional_source['source_query_eligible_record_count'], expected_counts[1])
                            self.assertEqual(regional_source['unassigned_observation_count'], expected_counts[2])
                            self.assertEqual(regional_source['query_region_code'], 'US')
                snapshot = overview
                state_snapshots = [json.loads((manifest_path.parent / state['snapshot_url']).read_text())
                    for state in manifest['states']]
                for frame_index, frame in enumerate(snapshot['frames']):
                    frame['weather_suitability']['features'] = [point for state in state_snapshots
                        for point in state['frames'][frame_index]['weather_suitability']['features']]

    def test_overview_preserves_connected_ecology_context(self):
        snapshot = self.snapshot()
        snapshot['frames'][0]['weather_suitability']['features'][0]['properties']['bird_tick_context'] = {
            'status': 'unavailable', 'reason': 'Habitat is unavailable'}
        with tempfile.TemporaryDirectory() as directory:
            manifest_path = Path(directory) / 'latest.json'
            manifest = publish_national_snapshot(snapshot, self.boundaries, manifest_path)
            overview = json.loads((manifest_path.parent / manifest['overview_url']).read_text())
            properties = overview['frames'][0]['weather_suitability']['features'][0]['properties']
            self.assertEqual(properties['bird_tick_context'], {'status': 'unavailable', 'reason': 'Habitat is unavailable'})

    def test_malformed_radar_inventory_publishes_unavailable_evidence_and_preserves_weather(self):
        def attach_connected_context(snapshot, habitat):
            snapshot['semantics']['integration_fixture'] = [snapshot['sources']['migration']['status'], habitat['status']]
            return snapshot

        inventories = [
            b'<ListBucketResult>',
            b'<ListBucketResult><IsTruncated>false</IsTruncated><CommonPrefixes><Prefix/></CommonPrefixes></ListBucketResult>',
            b'<ListBucketResult><IsTruncated>true</IsTruncated><CommonPrefixes><Prefix>nexrad/daily/KABR/</Prefix></CommonPrefixes></ListBucketResult>',
            b'<ListBucketResult><IsTruncated>false</IsTruncated><CommonPrefixes><Prefix>nexrad/daily/KABR/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>nexrad/daily/KABR/</Prefix></CommonPrefixes></ListBucketResult>',
        ]
        for inventory in inventories:
            with self.subTest(inventory=inventory), tempfile.TemporaryDirectory() as directory:
                snapshot = self.snapshot()
                original_weather_source = copy.deepcopy(snapshot['sources']['weather'])
                original_weather_values = [[point['properties']['questing_suitability']
                    for point in frame['weather_suitability']['features']] for frame in snapshot['frames']]
                manifest_path = Path(directory) / 'latest.json'
                publish_national_snapshot(snapshot, self.boundaries, manifest_path)
                with patch('sys.argv', ['measured_migration', '--source', str(manifest_path)]), \
                        patch('pipeline.measured_migration.urllib.request.urlopen', side_effect=lambda *args, **kwargs: io.BytesIO(inventory)), \
                        patch('pipeline.measured_migration.fetch_reference_habitat', return_value={'status': 'unavailable'}), \
                        patch('pipeline.measured_migration.apply_connected_ecology', side_effect=attach_connected_context), \
                        redirect_stdout(io.StringIO()):
                    attach_measured_migration()
                manifest = json.loads(manifest_path.read_text())
                overview = json.loads((manifest_path.parent / manifest['overview_url']).read_text())
                migration = overview['sources']['migration']
                self.assertEqual(migration['status'], 'unavailable')
                self.assertEqual(migration['valid_radar_count'], 0)
                self.assertTrue(migration['errors'])
                self.assertIn('inventory', migration['reason'].lower())
                self.assertEqual(overview['semantics']['integration_fixture'], ['unavailable', 'unavailable'])
                self.assertEqual(overview['sources']['weather'], original_weather_source)
                self.assertEqual(overview['stale_after'], snapshot['stale_after'])
                for frame_index, frame in enumerate(overview['frames']):
                    self.assertEqual([point['properties']['questing_suitability']
                        for point in frame['weather_suitability']['features']], original_weather_values[frame_index])
                    self.assertEqual([point['properties']['tick_prediction_index']
                        for point in frame['weather_suitability']['features']], original_weather_values[frame_index])


if __name__ == "__main__":
    unittest.main()
