"""Publish source forecasts plus explicitly marked spatial estimates, without networking."""

import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

from .coverage import generate_sampling_locations
from .model import MODEL_VERSION, calculate_activity_components
from .national_snapshot import publish_national_snapshot
from .snapshot import build_snapshot
from .sources import WEATHER_FIELDS, utc_timestamp
from .weather_grid import MAXIMUM_BATCH_LOCATIONS, _encoded_json, _load_cached_weather


def distance_kilometers(first, second):
    latitude_difference = math.radians(second[1] - first[1])
    longitude_difference = math.radians(second[0] - first[0])
    haversine = math.sin(latitude_difference / 2) ** 2 + math.cos(math.radians(first[1])) * math.cos(math.radians(second[1])) * math.sin(longitude_difference / 2) ** 2
    return 12742.0176 * math.asin(math.sqrt(min(1, haversine)))


def fill_snapshot_gaps(snapshot, configured_locations):
    """Estimate the index, never invent weather hours, sightings, or peak conditions."""
    original_points = snapshot['frames'][0]['weather_suitability']['features']
    existing_ids = {point['id'] for point in original_points}
    missing_locations = [location for location in configured_locations if location['id'] not in existing_ids]
    nearest_neighbors = {}
    for location in missing_locations:
        coordinate = [location['longitude'], location['latitude']]
        neighbors = sorted((distance_kilometers(coordinate, point['geometry']['coordinates']), point['id']) for point in original_points)[:4]
        if not neighbors or neighbors[0][0] > 1500:
            raise ValueError('No source forecast within the 1500 km gap-estimation limit')
        nearest_neighbors[location['id']] = neighbors
    for frame in snapshot['frames']:
        source_points = {point['id']: point for point in frame['weather_suitability']['features']}
        for location in missing_locations:
            neighbors = nearest_neighbors[location['id']]
            valid_neighbors = [(distance, source_points[identifier]) for distance, identifier in neighbors
                               if source_points[identifier]['properties']['questing_suitability'] is not None]
            # A missing nearest source is not evidence for a numerical estimate.
            nearest_is_valid = source_points[neighbors[0][1]]['properties']['questing_suitability'] is not None
            total_weight = sum(1 / (distance + 25) ** 2 for distance, _ in valid_neighbors)
            value = sum(point['properties']['questing_suitability'] / (distance + 25) ** 2 for distance, point in valid_neighbors) / total_weight if total_weight and nearest_is_valid else None
            frame['weather_suitability']['features'].append({
                'type': 'Feature', 'id': location['id'],
                'geometry': {'type': 'Point', 'coordinates': [location['longitude'], location['latitude']]},
                'properties': {**location, 'location_id': location['id'], 'date': frame['date'],
                    'requested_latitude': location['latitude'], 'requested_longitude': location['longitude'],
                    'weather_grid_distance_meters': 0, 'questing_suitability': value,
                    'questing_index_0_to_100': None if value is None else value * 100,
                    'valid_weather_hours': 0, 'questing_trigger_hours': 0, 'conditions_at_peak': None,
                    'factors_at_peak': None, 'stopover_weather_proxy': None,
                    'activity_components': calculate_activity_components(value, None, None, False, None, False, None),
                    'missing_inputs': ['local_source_forecast', 'measured_migration'], 'is_experimental': True,
                    'is_predicted': True, 'prediction_method': 'four_neighbor_inverse_distance_v1',
                    'prediction_nearest_distance_km': neighbors[0][0],
                    'prediction_source_location_ids': [point['id'] for _, point in valid_neighbors],
                },
            })
    snapshot['scope'].update(weather_location_count=len(configured_locations),
        state_codes=sorted({location['state_code'] for location in configured_locations}),
        weather_coverage='Source forecast grid with explicitly marked, low-confidence spatial index estimates for gaps')
    snapshot['sources']['weather'].update(status='partial' if missing_locations else 'available',
        source_forecast_location_count=len(existing_ids), predicted_location_count=len(missing_locations),
        prediction_note='Uncalibrated inverse-distance index estimates from four source forecast locations; not local weather measurements')
    snapshot['semantics']['predicted_values'] = 'is_predicted=true means a low-confidence spatial index estimate; zero real weather hours and no invented conditions. This is not a validated tick-density or infection probability.'
    return snapshot


def recover_cached_atlas(boundaries, cache_directory, now):
    locations = generate_sampling_locations(boundaries)
    sources = []
    for offset in range(0, len(locations), MAXIMUM_BATCH_LOCATIONS):
        batch = locations[offset:offset + MAXIMUM_BATCH_LOCATIONS]
        fingerprint = hashlib.sha256(_encoded_json({'model_version': MODEL_VERSION, 'fields': list(WEATHER_FIELDS),
            'forecast_start_date': now.date().isoformat(), 'forecast_days': 7, 'locations': batch})).hexdigest()
        source = _load_cached_weather(Path(cache_directory) / f'{fingerprint}.json', fingerprint, batch, now.date(), 7, now)
        if source is not None:
            sources.append(source)
    if not sources:
        raise ValueError('No fresh, integrity-checked source forecast cache is available for today')
    source_locations = [location for source in sources for location in source['locations']]
    source_ids = {location['id'] for location in source_locations}
    weather = {**sources[0], 'locations': source_locations, 'data_retrieved_at': min(source['retrieved_at'] for source in sources),
               'cache_hit_batches': len(sources), 'batches_fetched': 0}
    unavailable = {'status': 'unavailable', 'retrieved_at': utc_timestamp(now), 'observations': [], 'window_complete': False,
                   'errors': ['No observation collection performed during cache-only recovery']}
    snapshot = build_snapshot([location for location in locations if location['id'] in source_ids], weather,
        {**unavailable, 'provider': 'ebird'}, {**unavailable, 'provider': 'inaturalist'}, now, region_code='US')
    return fill_snapshot_gaps(snapshot, locations)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=Path('pipeline/output/weather-cache'))
    parser.add_argument('--output', type=Path, default=Path('pipeline/output/latest.json'))
    options = parser.parse_args()
    boundaries = json.loads(Path('web/public/data/states.geojson').read_text())
    snapshot = recover_cached_atlas(boundaries, options.cache, datetime.now(timezone.utc))
    publish_national_snapshot(snapshot, boundaries, options.output)
    weather = snapshot['sources']['weather']
    print(f"Published source forecasts at {weather['source_forecast_location_count']} locations plus {weather['predicted_location_count']} marked spatial estimates; no network requests.")


if __name__ == '__main__':
    main()
