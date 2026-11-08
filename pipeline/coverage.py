"""One sampling policy for every state, including islands and the antimeridian."""

import math

STATE_CODES = frozenset("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split())


def _polygons(state):
    geometry = state.get("geometry", {})
    if geometry.get("type") == "Polygon":
        return [geometry["coordinates"]]
    if geometry.get("type") == "MultiPolygon":
        return geometry["coordinates"]
    raise ValueError("State boundaries must contain Polygon or MultiPolygon geometry")


def _unwrap_longitude(longitude, west):
    distance = (longitude - west) % 360
    return west + (0 if distance > 360 - 1e-9 else distance)


def _canonical_longitude(longitude):
    return (longitude + 180) % 360 - 180


def state_bounds(state):
    positions = [position for polygon in _polygons(state) for ring in polygon for position in ring]
    if not positions:
        raise ValueError("State boundary has no coordinates")
    longitudes = sorted(position[0] % 360 for position in positions)
    gaps = [(longitudes[(index + 1) % len(longitudes)] + (360 if index == len(longitudes) - 1 else 0) - longitude,
             longitudes[(index + 1) % len(longitudes)]) for index, longitude in enumerate(longitudes)]
    largest_gap, west = max(gaps)
    west = _canonical_longitude(west)
    return west, min(position[1] for position in positions), west + 360 - largest_gap, max(position[1] for position in positions)


def _inside_ring(ring, longitude, latitude, west):
    inside = False
    previous_x = _unwrap_longitude(ring[-1][0], west)
    previous_y = ring[-1][1]
    for position in ring:
        current_x, current_y = _unwrap_longitude(position[0], west), position[1]
        cross_product = (longitude - previous_x) * (current_y - previous_y) - (latitude - previous_y) * (current_x - previous_x)
        if abs(cross_product) <= 1e-9 and min(previous_x, current_x) - 1e-9 <= longitude <= max(previous_x, current_x) + 1e-9 and min(previous_y, current_y) - 1e-9 <= latitude <= max(previous_y, current_y) + 1e-9:
            return True
        if (current_y > latitude) != (previous_y > latitude) and longitude < (previous_x - current_x) * (latitude - current_y) / (previous_y - current_y) + current_x:
            inside = not inside
        previous_x, previous_y = current_x, current_y
    return inside


def state_contains_coordinate(state, coordinate, bounds=None):
    west, south, east, north = bounds or state_bounds(state)
    longitude, latitude = _unwrap_longitude(coordinate[0], west), coordinate[1]
    if longitude > east + 1e-9 or latitude < south - 1e-9 or latitude > north + 1e-9:
        return False
    return any(_inside_ring(polygon[0], longitude, latitude, west)
               and not any(_inside_ring(hole, longitude, latitude, west) for hole in polygon[1:]) for polygon in _polygons(state))


def _representative_point(component):
    west, south, east, north = bounds = state_bounds(component)
    candidates = [[(west + east) / 2, (south + north) / 2]]
    ring = _polygons(component)[0][0]
    unwrapped_ring = [[_unwrap_longitude(position[0], west), position[1]] for position in ring]
    cross_products = [first[0] * second[1] - second[0] * first[1] for first, second in zip(unwrapped_ring, unwrapped_ring[1:] + unwrapped_ring[:1])]
    area_sum = sum(cross_products)
    if abs(area_sum) > 1e-12:
        candidates.insert(0, [sum((first[axis] + second[axis]) * cross for first, second, cross in zip(
            unwrapped_ring, unwrapped_ring[1:] + unwrapped_ring[:1], cross_products)) / (3 * area_sum) for axis in (0, 1)])
    candidates.extend(sorted([[west + (east - west) * column / 20, south + (north - south) * row / 20]
        for row in range(1, 20) for column in range(1, 20)],
        key=lambda point: (point[0] - (west + east) / 2) ** 2 + (point[1] - (south + north) / 2) ** 2))
    candidates.extend(ring)
    for longitude, latitude in candidates:
        point = [_canonical_longitude(longitude), latitude]
        if state_contains_coordinate(component, point, bounds):
            return point
    raise ValueError("Could not find a representative point inside a land component")


def generate_sampling_locations(state_boundaries, region_code="US", spacing_km=50):
    if isinstance(spacing_km, bool) or not isinstance(spacing_km, (int, float)) or not math.isfinite(spacing_km) or not 25 <= spacing_km <= 250:
        raise ValueError("Sampling spacing must be between 25 and 250 km")
    states = state_boundaries.get("features", [])
    if region_code == "US":
        if {state["properties"]["code"] for state in states} != STATE_CODES or len(states) != 51:
            raise ValueError("National boundaries must contain exactly the 50 states and D.C.")
    else:
        states = [state for state in states if region_code == "US-" + state["properties"]["code"]]
        if len(states) != 1:
            raise ValueError("Automatic sampling requires US or a supported US state/DC code")
    latitude_step = math.degrees(spacing_km / 6371.0088)
    locations = []
    for state in sorted(states, key=lambda feature: feature["properties"]["code"]):
        properties = state["properties"]
        west, south, east, north = bounds = state_bounds(state)
        state_locations = []
        for row in range(math.ceil((south + 90) / latitude_step), math.floor((north + 90) / latitude_step) + 1):
            latitude = row * latitude_step - 90
            longitude_step = latitude_step / max(0.01, math.cos(math.radians(latitude)))
            for column in range(math.ceil((west + 180) / longitude_step), math.floor((east + 180) / longitude_step) + 1):
                longitude = _canonical_longitude(column * longitude_step - 180)
                if state_contains_coordinate(state, [longitude, latitude], bounds):
                    state_locations.append({"id": f"US-{properties['code']}-{spacing_km:g}km-r{row}-c{column}",
                        "name": f"{properties['name']} reference sample {len(state_locations) + 1}",
                        "latitude": latitude, "longitude": longitude, "state_code": properties["code"],
                        "state_fips": properties["fips"], "sampling_spacing_km": spacing_km, "sampling_is_fallback": False})
        for component_index, polygon in enumerate(_polygons(state)):
            component = {"geometry": {"type": "Polygon", "coordinates": polygon}}
            component_bounds = state_bounds(component)
            if any(state_contains_coordinate(component, [location["longitude"], location["latitude"]], component_bounds) for location in state_locations):
                continue
            longitude, latitude = _representative_point(component)
            state_locations.append({"id": f"US-{properties['code']}-{spacing_km:g}km-component-{component_index}",
                "name": f"{properties['name']} reference sample {len(state_locations) + 1}",
                "latitude": latitude, "longitude": longitude, "state_code": properties["code"],
                "state_fips": properties["fips"], "sampling_spacing_km": spacing_km, "sampling_is_fallback": True})
        locations.extend(state_locations)
    return locations
