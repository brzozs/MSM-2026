"""Attach current BirdCast radar-derived migration evidence to the experimental index."""

import argparse
import calendar
import csv
import io
import json
import math
import re
import urllib.error
import urllib.request
import xml.etree.ElementTree as ElementTree
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .national_snapshot import publish_national_snapshot
from .recover_cached_atlas import distance_kilometers
from .sources import utc_timestamp

ARCHIVE_URL = 'https://birdcastdata.s3.amazonaws.com'
MAXIMUM_PROFILE_BYTES = 8 * 1024 * 1024


def is_night(timestamp, latitude, longitude):
    # NOAA fractional-year solar approximation; require the sun below civil twilight.
    fractional_year = 2 * math.pi / (366 if calendar.isleap(timestamp.year) else 365) * (timestamp.timetuple().tm_yday - 1 + (timestamp.hour - 12) / 24)
    declination = (0.006918 - 0.399912 * math.cos(fractional_year) + 0.070257 * math.sin(fractional_year)
        - 0.006758 * math.cos(2 * fractional_year) + 0.000907 * math.sin(2 * fractional_year)
        - 0.002697 * math.cos(3 * fractional_year) + 0.00148 * math.sin(3 * fractional_year))
    equation_minutes = 229.18 * (0.000075 + 0.001868 * math.cos(fractional_year) - 0.032077 * math.sin(fractional_year)
        - 0.014615 * math.cos(2 * fractional_year) - 0.040849 * math.sin(2 * fractional_year))
    solar_minutes = (timestamp.hour * 60 + timestamp.minute + equation_minutes + 4 * longitude) % 1440
    hour_angle = math.radians(solar_minutes / 4 - 180)
    latitude_radians = math.radians(latitude)
    cosine_zenith = math.sin(latitude_radians) * math.sin(declination) + math.cos(latitude_radians) * math.cos(declination) * math.cos(hour_angle)
    return cosine_zenith < math.sin(math.radians(-6))


def summarize_radar_profile(text, radar, observed_date):
    profiles = {}
    coordinate = None
    for row in csv.DictReader(io.StringIO(text)):
        if row.get('radar') != radar or row.get('height_reference') != 'sea' or row.get('gap', '').lower() != 'false' or not row.get('dens'):
            continue
        try:
            timestamp = datetime.fromisoformat(row['datetime'].replace('Z', '+00:00'))
            latitude, longitude = float(row['radar_latitude']), float(row['radar_longitude'])
            height_above_radar = float(row['height']) - float(row['radar_height'])
            density = float(row['dens'])
            values = [latitude, longitude, height_above_radar, density]
            if not all(math.isfinite(value) for value in values) or not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
                continue
            if timestamp.tzinfo is None or timestamp.date() != observed_date or not 200 <= height_above_radar <= 3000 or not 0 <= density <= 100000:
                continue
            if not is_night(timestamp, latitude, longitude):
                continue
            coordinate = [longitude, latitude]
            layer = float(row['height'])
            profile = profiles.setdefault(row['datetime'], {})
            if layer in profile:
                raise ValueError('Duplicate radar altitude/time bin')
            profile[layer] = density
        except (KeyError, TypeError, OverflowError):
            continue
    # VPTS density is birds/km³ in 100 m layers; integrate to birds/km².
    valid_profiles = [sum(profile.values()) * 0.1 for profile in profiles.values() if len(profile) >= 3]
    if coordinate is None or len(valid_profiles) < 12:
        return None
    return {'radar': radar, 'coordinate': coordinate, 'observed_date': observed_date.isoformat(),
        'airborne_birds_per_square_km': sum(valid_profiles) / len(valid_profiles),
        'valid_night_profiles': len(valid_profiles), 'source_url': f'{ARCHIVE_URL}/nexrad/daily/{radar}/{observed_date.year}/{radar}_vpts_{observed_date:%Y%m%d}.csv'}


def fetch_measured_migration(now, cache_directory):
    observed_date = now.date() - timedelta(days=1)
    with urllib.request.urlopen(f'{ARCHIVE_URL}/?list-type=2&prefix=nexrad/daily/&delimiter=/', timeout=20) as response:
        document = ElementTree.fromstring(response.read(100000))
    radars = [element.text.split('/')[-2] for element in document.findall('.//{*}CommonPrefixes/{*}Prefix')]
    radars = [radar for radar in radars if re.fullmatch(r'K[A-Z0-9]{3}|PA[A-Z0-9]{2}', radar)]
    if not 1 <= len(radars) <= 170 or document.findtext('{*}IsTruncated') != 'false':
        raise ValueError('Unexpected BirdCast radar inventory')
    cache_directory = Path(cache_directory)
    cache_directory.mkdir(parents=True, exist_ok=True)
    def collect_radar(radar):
        cache_path = cache_directory / f'{radar}-{observed_date}.csv'
        if cache_path.exists():
            text = cache_path.read_text()
        else:
            url = f'{ARCHIVE_URL}/nexrad/daily/{radar}/{observed_date.year}/{radar}_vpts_{observed_date:%Y%m%d}.csv'
            try:
                with urllib.request.urlopen(url, timeout=25) as response:
                    content = response.read(MAXIMUM_PROFILE_BYTES + 1)
                if len(content) > MAXIMUM_PROFILE_BYTES:
                    return None
                text = content.decode('utf-8')
            except (urllib.error.URLError, OSError, UnicodeError):
                return None
            cache_path.write_text(text)
        return summarize_radar_profile(text, radar, observed_date)
    summaries = []
    with ThreadPoolExecutor(max_workers=4) as executor:
        pending = [executor.submit(collect_radar, radar) for radar in radars]
        for index, future in enumerate(as_completed(pending), 1):
            summary = future.result()
            if summary is not None:
                summaries.append(summary)
            if index % 25 == 0:
                print(f'Measured migration: checked {index}/{len(radars)} radars', flush=True)
    return {'provider': 'birdcast', 'status': 'available' if len(summaries) == len(radars) else 'partial' if summaries else 'unavailable',
        'retrieved_at': utc_timestamp(now), 'observed_date': observed_date.isoformat(), 'radars_checked': len(radars),
        'valid_radar_count': len(summaries), 'maximum_support_km': 150,
        'attribution': 'BirdCast / Cornell Lab of Ornithology, NEXRAD VPTS archive',
        'terms_url': 'https://birdcast.org/data-interpretation/', 'radars': summaries}


def apply_measured_migration(snapshot, migration, now):
    observed_date = datetime.fromisoformat(migration['observed_date']).date()
    if not 0 <= (now.date() - observed_date).days <= 2:
        raise ValueError('Measured migration evidence is stale or from the future')
    radars = migration.get('radars', [])
    snapshot['generated_at'] = utc_timestamp(now)
    for frame in snapshot['frames']:
        for point in frame['weather_suitability']['features']:
            properties = point['properties']
            nearest = min(((distance_kilometers(point['geometry']['coordinates'], radar['coordinate']), radar) for radar in radars), key=lambda item: item[0], default=None)
            properties['tick_prediction_index'] = properties['questing_suitability']
            properties['migration_adjustment_status'] = 'unavailable'
            if nearest is None or nearest[0] > 150:
                continue
            radar = nearest[1]
            density = radar['airborne_birds_per_square_km']
            if not math.isfinite(density) or density < 0:
                raise ValueError('Measured migration density must be finite and nonnegative')
            pressure = min(1, math.log1p(density) / math.log(101))
            weather_value = properties['questing_suitability']
            properties.update(migration_adjustment_status='measured', measured_migration={**radar, 'distance_km': nearest[0]})
            # Explicit heuristic coefficient; this is not calibrated tick density or disease probability.
            properties['tick_prediction_index'] = None if weather_value is None else weather_value + 0.2 * pressure * weather_value * (1 - weather_value)
    snapshot['sources']['migration'] = {key: value for key, value in migration.items() if key != 'radars'}
    if radars:
        snapshot['unavailable_layers'] = [layer for layer in snapshot['unavailable_layers'] if layer['id'] != 'measured_bird_movement']
    snapshot['semantics']['migration_model'] = 'Latest measured nocturnal radar density within 150 km; pressure=min(1,log1p(density)/log(101)); index=weather+0.2*pressure*weather*(1-weather). The 0.2 effect is uncalibrated. Latest measured night held across weather forecast dates, not a forecast of future bird movement. No seasonal substitute.'
    return snapshot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('pipeline/output/latest.json'))
    options = parser.parse_args()
    manifest = json.loads(options.source.read_text())
    snapshot = json.loads((options.source.parent / manifest['overview_url']).read_text())
    snapshot.pop('kind', None)
    state_snapshots = [json.loads((options.source.parent / state['snapshot_url']).read_text()) for state in manifest['states']]
    for index, frame in enumerate(snapshot['frames']):
        frame['weather_suitability']['features'] = [point for state in state_snapshots for point in state['frames'][index]['weather_suitability']['features']]
    now = datetime.now(timezone.utc)
    try:
        migration = fetch_measured_migration(now, options.source.parent / 'migration-cache')
    except (urllib.error.URLError, OSError) as error:
        print(f'Measured migration collection unavailable: {type(error).__name__}; retaining weather-only indices.', flush=True)
        migration = {'provider': 'birdcast', 'status': 'unavailable', 'retrieved_at': utc_timestamp(now),
            'observed_date': (now.date() - timedelta(days=1)).isoformat(), 'radars_checked': 0, 'valid_radar_count': 0,
            'maximum_support_km': 150, 'radars': [], 'attribution': 'BirdCast / Cornell Lab of Ornithology',
            'terms_url': 'https://birdcast.org/data-interpretation/'}
    apply_measured_migration(snapshot, migration, now)
    boundaries = json.loads(Path('web/public/data/states.geojson').read_text())
    publish_national_snapshot(snapshot, boundaries, options.source)
    print(f"Attached measured migration from {migration['valid_radar_count']}/{migration['radars_checked']} radars; unsupported locations stay weather-only.")


if __name__ == '__main__':
    main()
