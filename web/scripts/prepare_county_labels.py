"""Build a small, public-domain county label index from bundled Census geometry."""
import json
from pathlib import Path

data_directory = Path(__file__).resolve().parents[1] / 'public' / 'data'


def unwrapped_ring(ring):
    origin = ring[0][0]
    return [[origin + (longitude - origin + 180) % 360 - 180, latitude]
            for longitude, latitude in ring]


def polygon_area(polygon):
    ring = unwrapped_ring(polygon[0])
    return abs(sum(first[0] * second[1] - second[0] * first[1]
                   for first, second in zip(ring, ring[1:])))


def interior_label_point(geometry):
    polygons = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
    rings = [unwrapped_ring(ring) for ring in max(polygons, key=polygon_area)]
    latitude = (min(point[1] for point in rings[0]) + max(point[1] for point in rings[0])) / 2
    intersections = []
    for ring in rings:
        for first, second in zip(ring, ring[1:]):
            if (first[1] > latitude) != (second[1] > latitude):
                intersections.append(first[0] + (latitude - first[1]) * (second[0] - first[0]) / (second[1] - first[1]))
    intersections.sort()
    spans = list(zip(intersections[::2], intersections[1::2]))
    if not spans:
        raise ValueError('County geometry has no interior label span')
    west, east = max(spans, key=lambda span: span[1] - span[0])
    return [round(((west + east) / 2 + 180) % 360 - 180, 5), round(latitude, 5)]


features = []
for region_file in sorted((data_directory / 'regions').glob('*.geojson')):
    for county in json.loads(region_file.read_text(encoding='utf-8'))['features']:
        if county['properties']['kind'] != 'county':
            continue
        features.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': interior_label_point(county['geometry'])},
                         'properties': {'geoid': county['properties']['geoid'], 'name': county['properties']['name'],
                                        'state_fips': region_file.stem}})
output = data_directory / 'county-labels.geojson'
output.write_text(json.dumps({'type': 'FeatureCollection', 'features': features}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(f'Wrote {len(features):,} county label points ({output.stat().st_size:,} bytes).')
