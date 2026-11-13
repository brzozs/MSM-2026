import copy
import unittest
from datetime import datetime, timezone

from pipeline.bird_tick_model import apply_connected_ecology, calculate_bird_tick_context


def weather_point(forecast_date='2026-11-08', longitude=-74):
    return {'type': 'Feature', 'id': 'ny-reference', 'geometry': {'type': 'Point', 'coordinates': [longitude, 43]},
        'properties': {'location_id': 'ny-reference', 'state_code': 'NY', 'date': forecast_date,
            'questing_suitability': 0.2, 'tick_prediction_index': 0.25,
            'stopover_weather_proxy': 0.4,
            'measured_migration': {'observed_date': '2026-11-07', 'airborne_birds_per_square_km': 25,
                'distance_km': 30, 'radar': 'KENX'},
            'activity_components': {'ecological_activity_index': None},
            'conditions_at_peak': {'relative_humidity_percent': 85}}}


def habitat_sample():
    return {'location_id': 'ny-reference', 'coordinate': [-74, 43], 'land_cover_class': 41, 'year': 2025}


class BirdTickModelTests(unittest.TestCase):
    def test_release_is_conditional_and_does_not_raise_current_questing(self):
        point = weather_point()
        result = calculate_bird_tick_context(point, habitat_sample())
        self.assertTrue(result['supported_cohort'])
        self.assertGreater(result['stopover_index'], 0)
        self.assertGreater(result['deposition_potential']['central'], 0)
        self.assertLessEqual(result['deposition_potential']['lower'], result['deposition_potential']['central'])
        self.assertLessEqual(result['deposition_potential']['central'], result['deposition_potential']['upper'])
        self.assertFalse(result['contributes_to_current_questing'])
        self.assertEqual(result['development_status'], 'outside_forecast_model')
        self.assertIsNone(result['post_drop_persistence_index'])
        self.assertIn('post_drop_leaf_litter_microclimate_and_fed_tick_survival', result['missing_inputs'])
        self.assertEqual(point['properties']['questing_suitability'], 0.2)

    def test_missing_habitat_keeps_radar_and_weather_but_withholds_dependent_estimates(self):
        result = calculate_bird_tick_context(weather_point(), None)
        self.assertGreater(result['migration_pressure'], 0)
        self.assertEqual(result['stopover_weather_factor'], 0.7)
        self.assertIsNone(result['stopover_index'])
        self.assertIsNone(result['deposition_potential'])
        self.assertIn('sampled_habitat', result['missing_inputs'])

    def test_missing_radar_is_not_replaced_by_sightings_or_illustrative_flyways(self):
        point = weather_point()
        point['properties'].pop('measured_migration')
        point['properties']['bird_reports_72h'] = 1000
        result = calculate_bird_tick_context(point, habitat_sample())
        self.assertIsNone(result['migration_pressure'])
        self.assertIsNone(result['deposition_potential'])

    def test_genuine_zero_and_known_unsuitable_habitat_are_not_missing(self):
        point = weather_point()
        point['properties']['measured_migration']['airborne_birds_per_square_km'] = 0
        result = calculate_bird_tick_context(point, habitat_sample())
        self.assertEqual(result['stopover_index'], 0)
        self.assertEqual(result['deposition_potential']['central'], 0)
        sample = {**habitat_sample(), 'land_cover_class': 24}
        self.assertEqual(calculate_bird_tick_context(weather_point(), sample)['stopover_index'], 0)

    def test_attachment_scenarios_expire_without_creating_questing_ticks(self):
        first = calculate_bird_tick_context(weather_point('2026-11-08'), habitat_sample())
        later = calculate_bird_tick_context(weather_point('2026-11-12'), habitat_sample())
        expired = calculate_bird_tick_context(weather_point('2026-11-14'), habitat_sample())
        self.assertLess(later['deposition_potential']['central'], first['deposition_potential']['central'])
        self.assertEqual(expired['deposition_potential']['upper'], 0)
        self.assertFalse(expired['contributes_to_current_questing'])

    def test_west_alaska_hawaii_have_explicit_unsupported_cohort_but_keep_weather(self):
        for longitude, state in [(-120, 'CA'), (-150, 'AK'), (-155, 'HI')]:
            point = weather_point(longitude=longitude)
            point['properties']['state_code'] = state
            result = calculate_bird_tick_context(point, None)
            self.assertFalse(result['supported_cohort'])
            self.assertIsNone(result['deposition_potential'])
            self.assertEqual(result['habitat']['status'], 'not_covered' if state in ('AK', 'HI') else 'unavailable')
            self.assertEqual(point['properties']['questing_suitability'], 0.2)

    def test_missing_weather_and_invalid_inputs_remain_explicit(self):
        point = weather_point()
        point['properties']['stopover_weather_proxy'] = None
        result = calculate_bird_tick_context(point, habitat_sample())
        self.assertIsNone(result['stopover_index'])
        for invalid in [float('nan'), -1, True]:
            point['properties']['measured_migration']['airborne_birds_per_square_km'] = invalid
            with self.assertRaises(ValueError):
                calculate_bird_tick_context(point, habitat_sample())

    def test_habitat_must_match_exact_reference_and_vintage(self):
        for change in [{'coordinate': [-73, 43]}, {'year': 2024}, {'land_cover_class': 250}]:
            with self.assertRaises(ValueError):
                calculate_bird_tick_context(weather_point(), {**habitat_sample(), **change})

    def test_attach_preserves_partial_evidence_and_quality_gates_and_source_age(self):
        point = weather_point()
        snapshot = {'frames': [{'date': '2026-11-08', 'weather_suitability': {'features': [point]}}],
            'sources': {'birds': {'status': 'partial', 'window_complete': False}, 'ticks': {'status': 'available', 'window_complete': False}},
            'semantics': {}, 'stale_after': '2026-11-08T12:58:37Z', 'observations': {'birds': {'features': []}}}
        original = copy.deepcopy(snapshot)
        habitat = {'provider': 'usgs_nlcd', 'status': 'partial', 'retrieved_at': '2026-11-08T13:00:00Z', 'samples': {'ny-reference': habitat_sample()}}
        apply_connected_ecology(snapshot, habitat)
        self.assertEqual(snapshot['sources']['birds'], original['sources']['birds'])
        self.assertEqual(snapshot['stale_after'], original['stale_after'])
        self.assertEqual(point['properties']['activity_components']['ecological_activity_index'], None)
        self.assertEqual(point['properties']['tick_prediction_index'], 0.2)
        self.assertIn('bird_tick_context', point['properties'])
        self.assertNotIn('samples', snapshot['sources']['habitat'])
