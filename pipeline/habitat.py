"""Sparse measured NLCD pixels at existing weather references, never a habitat map.

One reference per CONUS jurisdiction bounds the optional public-service budget.
Unsampled points stay missing; a 30 m land-cover pixel cannot represent a 50 km cell.
"""

import hashlib
import json
import math
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

from .sources import utc_timestamp

DATASET_YEAR = 2025
LAND_COVER_CLASSES = frozenset((11, 12, 21, 22, 23, 24, 31, 41, 42, 43, 52, 71, 81, 82, 90, 95))
HABITAT_SERVICE_URL = 'https://dmsdata.cr.usgs.gov/geoserver/mrlc_Land-Cover-Native_conus_year_data/wms'
HABITAT_LAYER = 'Land-Cover-Native_conus_year_data'


def _reference_locations(snapshot):
    by_state = {}
    for point in snapshot['frames'][0]['weather_suitability']['features']:
        state_code = point['properties']['state_code']
        if state_code not in ('AK', 'HI'):
            by_state.setdefault(state_code, []).append(point)
    references = []
    for state_code in sorted(by_state):
        points = by_state[state_code]
        center = [sum(point['geometry']['coordinates'][axis] for point in points) / len(points) for axis in (0, 1)]
        longitude_scale = math.cos(math.radians(center[1]))
        references.append(min(points, key=lambda point: (
            ((point['geometry']['coordinates'][0] - center[0]) * longitude_scale) ** 2
            + (point['geometry']['coordinates'][1] - center[1]) ** 2, point['properties']['location_id'])))
    if len(references) > 49:
        raise ValueError('NLCD collection supports at most the 48 CONUS states and D.C.')
    return references


def _validate_sample(sample, location_id, coordinate):
    if (not isinstance(sample, dict) or sample.get('location_id') != location_id
        or sample.get('coordinate') != coordinate or sample.get('year') != DATASET_YEAR
        or type(sample.get('land_cover_class')) is not int or sample['land_cover_class'] not in LAND_COVER_CLASSES):
        raise ValueError('Invalid NLCD sample class, coordinate, reference or vintage')
    if not isinstance(sample.get('retrieved_at'), str):
        raise ValueError('NLCD retrieval time must be an ISO timestamp')
    retrieved_at = datetime.fromisoformat(sample['retrieved_at'].replace('Z', '+00:00'))
    if retrieved_at.tzinfo is None:
        raise ValueError('NLCD retrieval time must have a UTC offset')
    return sample


def fetch_reference_habitat(snapshot, cache_directory, now):
    references = _reference_locations(snapshot)
    cache_directory = Path(cache_directory)
    cache_directory.mkdir(parents=True, exist_ok=True)

    def collect_reference(point):
        location_id = point['properties']['location_id']
        coordinate = point['geometry']['coordinates']
        cache_key = hashlib.sha256(json.dumps([DATASET_YEAR, location_id, coordinate]).encode()).hexdigest()[:24]
        cache_path = cache_directory / f'{cache_key}.json'
        if cache_path.exists():
            try:
                sample = _validate_sample(json.loads(cache_path.read_text()), location_id, coordinate)
                if datetime.fromisoformat(sample['retrieved_at'].replace('Z', '+00:00')) > now:
                    raise ValueError('NLCD cache retrieval time is in the future')
                return sample, True, None
            except (ValueError, KeyError, TypeError, OSError):
                cache_path.unlink(missing_ok=True)
        longitude, latitude = coordinate
        query = urllib.parse.urlencode({'service': 'WMS', 'version': '1.1.1', 'request': 'GetFeatureInfo',
            'layers': HABITAT_LAYER, 'query_layers': HABITAT_LAYER, 'styles': '', 'format': 'image/png',
            'info_format': 'application/json', 'srs': 'EPSG:4326',
            'bbox': f'{longitude-.005},{latitude-.005},{longitude+.005},{latitude+.005}',
            'width': 101, 'height': 101, 'x': 50, 'y': 50, 'time': f'{DATASET_YEAR}-01-01T00:00:00Z'})
        try:
            with urllib.request.urlopen(f'{HABITAT_SERVICE_URL}?{query}', timeout=20) as response:
                content = response.read(65537)
            if len(content) > 65536:
                raise ValueError('NLCD response exceeds the point-response budget')
            features = json.loads(content)['features']
            if not isinstance(features, list) or len(features) != 1:
                raise ValueError('NLCD point response must contain one pixel')
            land_cover_class = features[0]['properties']['PALETTE_INDEX']
            sample = _validate_sample({'location_id': location_id, 'coordinate': coordinate,
                'land_cover_class': land_cover_class, 'year': DATASET_YEAR, 'retrieved_at': utc_timestamp(now)}, location_id, coordinate)
            cache_path.write_text(json.dumps(sample, allow_nan=False))
            return sample, False, None
        except (urllib.error.URLError, OSError, ValueError, KeyError, TypeError, IndexError) as error:
            return None, False, f'NLCD reference {location_id} unavailable ({type(error).__name__})'

    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(collect_reference, references))
    samples = {sample['location_id']: sample for sample, _, _ in results if sample is not None}
    errors = [error for _, _, error in results if error is not None]
    original_times = [sample['retrieved_at'] for sample in samples.values()]
    return {'provider': 'usgs_nlcd', 'status': 'partial' if samples else 'unavailable',
        'retrieved_at': utc_timestamp(now), 'data_retrieved_at': min(original_times) if original_times else utc_timestamp(now),
        'dataset_year': DATASET_YEAR, 'pixel_size_meters': 30, 'sampled_location_count': len(samples),
        'requested_location_count': len(references), 'total_reference_location_count': len(snapshot['frames'][0]['weather_suitability']['features']),
        'cache_hit_count': sum(cache_hit for _, cache_hit, _ in results), 'errors': errors,
        'attribution': 'USGS Annual National Land Cover Database (Annual NLCD), 2025 land cover',
        'terms_url': 'https://www.usgs.gov/centers/eros/science/about-annual-nlcd', 'service_url': HABITAT_SERVICE_URL,
        'sampling_note': 'One 30 m pixel at an existing weather reference nearest each CONUS state/DC sample centroid; sparse point classes, not regional habitat fractions. No interpolation; AK/HI and unsampled references unavailable.',
        'samples': samples}
