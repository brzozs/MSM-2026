"""Convert public-domain Census 2024 boundaries into state-sized static files.

Authoring-only dependency: pyshp. The web application has no new dependencies.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import io
import json
from pathlib import Path
import sys
import urllib.request
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--tools-directory')
arguments = parser.parse_args()
if arguments.tools_directory:
    sys.path.insert(0, arguments.tools_directory)
import shapefile

data_directory = Path(__file__).resolve().parents[1] / 'public' / 'data'
states = json.loads((data_directory / 'states.geojson').read_text(encoding='utf-8'))
features_by_state = {state['properties']['fips']: [] for state in states['features']}
source_root = 'https://www2.census.gov/geo/tiger/GENZ2024/shp/'


def download_geography(kind):
    filename = f'cb_2024_us_{kind}_500k.zip'
    with urllib.request.urlopen(source_root + filename, timeout=120) as response:
        archive_bytes = response.read()
    print(f'Downloaded {filename}: {len(archive_bytes):,} bytes', flush=True)
    return kind, archive_bytes


def rounded_coordinates(value):
    if isinstance(value, (tuple, list)):
        return [rounded_coordinates(element) for element in value]
    return round(value, 5) if isinstance(value, float) else value


with ThreadPoolExecutor(max_workers=3) as executor:
    archives = list(executor.map(download_geography, ['county', 'place', 'cousub']))

for kind, archive_bytes in archives:
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        basename = next(name[:-4] for name in archive.namelist() if name.endswith('.shp'))
        reader = shapefile.Reader(shp=io.BytesIO(archive.read(basename + '.shp')),
                                  shx=io.BytesIO(archive.read(basename + '.shx')),
                                  dbf=io.BytesIO(archive.read(basename + '.dbf')))
        count = 0
        for shape_record in reader.iterShapeRecords():
            properties = shape_record.record.as_dict()
            state_fips = properties['STATEFP']
            if state_fips not in features_by_state:
                continue
            full_name = properties.get('NAMELSAD', properties['NAME'])
            # Towns/townships supplement places; statistical CCDs are not towns.
            if kind == 'cousub' and not full_name.endswith((' town', ' township')):
                continue
            geometry = shape_record.shape.__geo_interface__
            geometry['coordinates'] = rounded_coordinates(geometry['coordinates'])
            features_by_state[state_fips].append({
                'type': 'Feature', 'geometry': geometry,
                'properties': {'geoid': properties['GEOID'], 'name': full_name if kind == 'county' else properties['NAME'],
                               'kind': 'town' if kind == 'cousub' else kind},
            })
            count += 1
        print(f'Converted {kind}: {count:,} features', flush=True)

output_directory = data_directory / 'regions'
output_directory.mkdir(exist_ok=True)
for state_fips, features in features_by_state.items():
    output = {'type': 'FeatureCollection', 'features': features}
    (output_directory / f'{state_fips}.geojson').write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(f'Wrote {len(features_by_state)} state boundary files.', flush=True)
