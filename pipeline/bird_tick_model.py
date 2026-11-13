"""Conditional immature blacklegged-tick deposition, separate from questing.

All weights are uncalibrated scenario indices. Radar is neither tick carriage nor
species identity. See docs/connected-ecology.md for source evidence and assumptions.
"""

import math
from datetime import date

from .habitat import DATASET_YEAR, LAND_COVER_CLASSES
from .model import validated_number

MODEL_VERSION = 'bird-tick-context-v1'
ATTACHMENT_DURATION_SCENARIOS_DAYS = (3, 4, 5, 6)
# An explicit woodland/ground-use classification assumption, not measured suitability.
HABITAT_FACTORS = {41: 1, 42: 1, 43: 1, 90: 1, 52: 0.5, 95: 0.25, 71: 0.1, 81: 0.1}


def _scenario_range(values):
    return {'lower': min(values), 'central': sum(values) / len(values), 'upper': max(values)}


def calculate_bird_tick_context(point, habitat_sample):
    properties = point['properties']
    longitude, latitude = point['geometry']['coordinates']
    state_code = properties.get('state_code')
    # Operational coarse envelope matching the eastern-U.S. focus, not establishment data.
    supported = state_code not in ('AK', 'HI') and -100 <= longitude <= -66 and 24 <= latitude <= 50
    habitat = {'status': 'not_covered' if state_code in ('AK', 'HI') else 'unavailable',
        'land_cover_class': None, 'habitat_factor': None, 'year': DATASET_YEAR}
    if habitat_sample is not None:
        land_cover_class = habitat_sample.get('land_cover_class')
        if (habitat_sample.get('location_id') != properties['location_id']
            or habitat_sample.get('coordinate') != point['geometry']['coordinates']
            or habitat_sample.get('year') != DATASET_YEAR or type(land_cover_class) is not int
            or land_cover_class not in LAND_COVER_CLASSES):
            raise ValueError('Habitat must match an admitted NLCD class at the exact reference and vintage')
        habitat.update(status='sampled', land_cover_class=land_cover_class,
            habitat_factor=HABITAT_FACTORS.get(land_cover_class, 0))
    radar = properties.get('measured_migration')
    pressure = observed_date = radar_age_days = None
    if radar is not None:
        density = validated_number(radar['airborne_birds_per_square_km'], 'radar density', 0)
        distance = validated_number(radar['distance_km'], 'radar distance', 0)
        observed_date = radar['observed_date']
        radar_age_days = (date.fromisoformat(properties['date']) - date.fromisoformat(observed_date)).days
        if density is not None and distance is not None and distance <= 150 and radar_age_days >= 0:
            pressure = min(1, math.log1p(density) / math.log(101))
    weather_proxy = validated_number(properties.get('stopover_weather_proxy'), 'stopover weather proxy', 0, 1)
    # Rest occurs in fair weather too; rain/low cloud only add hypothetical grounding support.
    weather_factor = None if weather_proxy is None else 0.5 + 0.5 * weather_proxy
    stopover = pressure * weather_factor * habitat['habitat_factor'] if supported and all(
        value is not None for value in (pressure, weather_factor, habitat['habitat_factor'])) else None
    timing = deposition = None
    if pressure is not None and radar_age_days is not None:
        # Uniform unknown attachment age on measured night: one-day residual feeding
        # overlap for each fixed duration. This is a scenario, not a fitted probability.
        interval_start = max(0, radar_age_days - 1)
        weights = [max(0, min(interval_start + 1, duration) - interval_start) / duration
            for duration in ATTACHMENT_DURATION_SCENARIOS_DAYS]
        timing = _scenario_range(weights)
        if stopover is not None:
            deposition = {key: stopover * value for key, value in timing.items()}
    missing = []
    for field, missing_value in (('supported_immature_ixodes_scapularis_geography', not supported),
        ('measured_migration_within_150km', pressure is None), ('stopover_weather', weather_factor is None),
        ('sampled_habitat', habitat['habitat_factor'] is None)):
        if missing_value:
            missing.append(field)
    missing.extend(('bird_tick_carriage_and_attachment_age', 'post_drop_leaf_litter_microclimate_and_fed_tick_survival',
        'field_development_and_diapausing_cohorts'))
    return {'model_version': MODEL_VERSION, 'supported_cohort': supported, 'migration_pressure': pressure,
        'radar_observed_date': observed_date, 'radar_age_days': radar_age_days,
        'stopover_weather_factor': weather_factor, 'habitat': habitat, 'stopover_index': stopover,
        'detachment_window_days': [3, 6], 'detachment_timing_weight': timing,
        'deposition_potential': deposition, 'post_drop_moisture_support': None, 'post_drop_persistence_index': None,
        'contributes_to_current_questing': False, 'development_status': 'outside_forecast_model' if supported else 'unsupported',
        'missing_inputs': missing}


def apply_connected_ecology(snapshot, habitat_evidence):
    samples = habitat_evidence.get('samples', {})
    for frame in snapshot['frames']:
        for point in frame['weather_suitability']['features']:
            properties = point['properties']
            properties['tick_prediction_index'] = properties['questing_suitability']
            properties['bird_tick_context'] = calculate_bird_tick_context(point, samples.get(properties['location_id']))
    snapshot['sources']['habitat'] = {key: value for key, value in habitat_evidence.items() if key != 'samples'}
    snapshot['semantics'].update(
        questing_index='Experimental weather-only 0–100 suitability index for I. scapularis nymphs; never a probability. Radar and deposited fed ticks do not increase it.',
        migration_model='Latest admitted nocturnal BirdCast density within 150 km is observed passage evidence for a separate conditional stopover/deposition scenario. No radar adjustment to current questing; no species identity or tick carriage inferred.',
        model_cohort='Questing: Ixodes scapularis nymphs, unvalidated weather heuristic. Deposition: larvae and nymphs on birds, conditional scenario in a coarse eastern-CONUS envelope (100°W–66°W, 24–50°N), not local establishment or nationwide species coverage.',
        bird_tick_model='bird-tick-context-v1; relative conditional indices, no abundance/carriage/count calibration. pressure=min(1,log1p(radar density)/log(101)); stopover=pressure*(0.5+0.5*rain/cloud proxy)*habitat class weight. Latest observed night is fixed across future weather dates, not predicted migration or observed stopover.',
        deposition_scenario='Assume ticks already attached to suitable ground-foraging bird hosts, uniform unknown attachment age and equally weighted fixed 3/4/5/6-day feeding scenarios. Daily detachment is residual overlap/duration; lower/central/upper are scenario envelope/mean, not confidence intervals. No release location or tick count inferred.',
        deposition_survival='Fed deposited larvae must molt/mature before nymphal questing; fed nymphs develop toward adults. Field development/diapause and leaf-litter microclimate/survival are unavailable. Persistence is withheld; deposition never adds to current questing.',
        model_sources='https://pmc.ncbi.nlm.nih.gov/articles/PMC7225381/ ; https://doi.org/10.1186/s13071-015-1185-7 ; https://www.cdc.gov/ticks/about/where-ticks-live.html ; https://www.usgs.gov/centers/eros/science/about-annual-nlcd')
    return snapshot
