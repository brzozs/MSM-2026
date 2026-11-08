import json
import unittest
from pathlib import Path

from pipeline.coverage import generate_sampling_locations, state_contains_coordinate

BOUNDARIES_PATH = Path(__file__).resolve().parents[2] / "web/public/data/states.geojson"
EXPECTED_CODES = set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split())


def state_feature(code, coordinates, geometry_type="Polygon"):
    return {"type": "Feature", "properties": {"code": code, "name": code, "fips": "02" if code == "AK" else "11"},
            "geometry": {"type": geometry_type, "coordinates": coordinates}}


class NationalCoverageTests(unittest.TestCase):
    def test_every_state_and_dc_gets_the_same_grid_policy_and_contained_samples(self):
        boundaries = json.loads(BOUNDARIES_PATH.read_text())
        locations = generate_sampling_locations(boundaries, "US", 50)
        self.assertEqual({location["state_code"] for location in locations}, EXPECTED_CODES)
        self.assertEqual({location["sampling_spacing_km"] for location in locations}, {50})
        self.assertEqual(len({location["id"] for location in locations}), len(locations))
        self.assertLessEqual(len(locations), 4500)
        states = {feature["properties"]["code"]: feature for feature in boundaries["features"]}
        for location in locations:
            self.assertTrue(state_contains_coordinate(states[location["state_code"]], [location["longitude"], location["latitude"]]))
        self.assertTrue(any(location["state_code"] == "DC" for location in locations))
        self.assertGreater(sum(location["state_code"] == "AK" for location in locations), 1)
        self.assertGreater(sum(location["state_code"] == "HI" for location in locations), 1)

    def test_antimeridian_geometry_does_not_fill_the_rest_of_the_world(self):
        alaska = state_feature("AK", [[[175, 50], [-175, 50], [-175, 51], [175, 51], [175, 50]]])
        locations = generate_sampling_locations({"type": "FeatureCollection", "features": [alaska]}, "US-AK", 50)
        self.assertTrue(locations)
        self.assertLess(len(locations), 100)
        self.assertTrue(all(abs(location["longitude"]) >= 175 for location in locations))
        self.assertTrue(state_contains_coordinate(alaska, [179, 50.5]))
        self.assertTrue(state_contains_coordinate(alaska, [-179, 50.5]))
        self.assertFalse(state_contains_coordinate(alaska, [0, 50.5]))

    def test_holes_are_not_sampled_and_disconnected_land_gets_a_fallback(self):
        outer = [[-78, 38], [-76, 38], [-76, 40], [-78, 40], [-78, 38]]
        hole = [[-77.5, 38.5], [-76.5, 38.5], [-76.5, 39.5], [-77.5, 39.5], [-77.5, 38.5]]
        district = state_feature("DC", [outer, hole])
        locations = generate_sampling_locations({"type": "FeatureCollection", "features": [district]}, "US-DC", 50)
        self.assertTrue(locations)
        self.assertFalse(any(-77.5 < location["longitude"] < -76.5 and 38.5 < location["latitude"] < 39.5 for location in locations))
        islands = state_feature("HI", [
            [[[-156, 20], [-155.99, 20], [-155.99, 20.01], [-156, 20.01], [-156, 20]]],
            [[[-155, 21], [-154.99, 21], [-154.99, 21.01], [-155, 21.01], [-155, 21]]],
        ], "MultiPolygon")
        locations = generate_sampling_locations({"type": "FeatureCollection", "features": [islands]}, "US-HI", 50)
        self.assertEqual(len(locations), 2)
        self.assertTrue(all(location["sampling_is_fallback"] for location in locations))

    def test_state_detail_uses_the_same_generator_without_a_capital_region_branch(self):
        boundaries = json.loads(BOUNDARIES_PATH.read_text())
        for region_code in ["US-NY", "US-CA", "US-AK", "US-HI", "US-DC"]:
            locations = generate_sampling_locations(boundaries, region_code, 50)
            self.assertTrue(locations)
            self.assertEqual({location["state_code"] for location in locations}, {region_code[-2:]})
        with self.assertRaises(ValueError):
            generate_sampling_locations(boundaries, "US-XX", 50)
        with self.assertRaises(ValueError):
            generate_sampling_locations(boundaries, "US", 0)


if __name__ == "__main__":
    unittest.main()
