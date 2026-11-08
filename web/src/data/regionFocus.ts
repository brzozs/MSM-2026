import type { Position } from 'geojson';
import type { StateBoundaries } from './mapTypes';
import type { MigrationRoute } from './mapFrames';
import type { ActivityGlowFrame } from './activityGlow';

export type StateFeature = StateBoundaries['features'][number];
export type StateBounds = [[number, number], [number, number]];
export interface RegionalPreview {
  bounds: StateBounds;
  hotspots: ActivityGlowFrame;
  migrationRoute: MigrationRoute | null;
  platformHeightMeters: number;
}

function unwrapLongitude(longitude: number, west: number): number {
  const distance = ((longitude - west) % 360 + 360) % 360;
  return west + (distance > 360 - 1e-9 ? 0 : distance);
}

export function getStateBounds(state: StateFeature): StateBounds {
  const polygons = state.geometry.type === 'Polygon' ? [state.geometry.coordinates] : state.geometry.coordinates;
  const positions = polygons.flat(2);
  if (!positions.length) throw new Error(`State ${state.properties.code} has no boundary coordinates.`);
  const longitudes = positions.map(([longitude]) => ((longitude % 360) + 360) % 360).sort((first, second) => first - second);
  let largestGap = -1;
  let west = longitudes[0];
  for (let index = 0; index < longitudes.length; index += 1) {
    const next = index + 1 < longitudes.length ? longitudes[index + 1] : longitudes[0] + 360;
    if (next - longitudes[index] > largestGap) {
      largestGap = next - longitudes[index];
      west = next % 360;
    }
  }
  if (west > 180) west -= 360;
  return [[west, Math.min(...positions.map((position) => position[1]))],
    [west + 360 - largestGap, Math.max(...positions.map((position) => position[1]))]];
}

export function stateContainsCoordinate(state: StateFeature, position: Position, bounds = getStateBounds(state)): boolean {
  const longitude = unwrapLongitude(position[0], bounds[0][0]);
  const latitude = position[1];
  if (longitude > bounds[1][0] || latitude < bounds[0][1] || latitude > bounds[1][1]) return false;
  const polygons = state.geometry.type === 'Polygon' ? [state.geometry.coordinates] : state.geometry.coordinates;
  const insideRing = (ring: Position[]) => {
    let inside = false;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
      const currentX = unwrapLongitude(ring[index][0], bounds[0][0]);
      const previousX = unwrapLongitude(ring[previous][0], bounds[0][0]);
      const currentY = ring[index][1];
      const previousY = ring[previous][1];
      if ((currentY > latitude) !== (previousY > latitude)
        && longitude < (previousX - currentX) * (latitude - currentY) / (previousY - currentY) + currentX) inside = !inside;
    }
    return inside;
  };
  return polygons.some((polygon) => insideRing(polygon[0]) && !polygon.slice(1).some(insideRing));
}

export function buildRegionalPreview(state: StateFeature, selectedDayIndex: number): RegionalPreview {
  if (!Number.isInteger(selectedDayIndex) || selectedDayIndex < 0 || selectedDayIndex > 6) throw new RangeError('Preview day must be an integer from 0 through 6.');
  const bounds = getStateBounds(state);
  const [[west, south], [east, north]] = bounds;
  const regionalHeightScale = Math.min(30000, (north - south) * 111320 * 0.025);
  if (!(east > west && north > south)) throw new Error(`State ${state.properties.code} has no usable boundary area.`);
  const hotspots: ActivityGlowFrame = { type: 'FeatureCollection', features: [] };
  let seed = Number(state.properties.fips) + 1;
  const nextRandom = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  // Fixed, clearly synthetic positions; daily sample intensity changes independently.
  for (let attempt = 0; attempt < 6000 && hotspots.features.length < 32; attempt += 1) {
    const position = [west + nextRandom() * (east - west), south + nextRandom() * (north - south)];
    if (!stateContainsCoordinate(state, position, bounds)) continue;
    const intensity = 0.25 + (Math.sin(hotspots.features.length * 1.7 + selectedDayIndex * 0.65 + Number(state.properties.fips) * 0.23) + 1) * 0.3;
    hotspots.features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: position },
      properties: { intensity, display_height: 20, is_example: true } });
  }
  const routePosition = (latitudeFraction: number): [number, number, number] => {
    const targetLatitude = south + (north - south) * latitudeFraction;
    const targetLongitude = (west + east) / 2;
    const nearestPoint = hotspots.features.reduce((nearest, point) => {
      const score = (feature: typeof point) => Math.abs(feature.geometry.coordinates[1] - targetLatitude)
        + Math.abs(feature.geometry.coordinates[0] - targetLongitude) * 0.15;
      return score(point) < score(nearest) ? point : nearest;
    });
    return [nearestPoint.geometry.coordinates[0], nearestPoint.geometry.coordinates[1], regionalHeightScale * (latitudeFraction === 0.5 ? 4 : 2)];
  };
  const migrationRoute: MigrationRoute | null = hotspots.features.length ? [routePosition(0.15), routePosition(0.5), routePosition(0.85)] : null;
  return { bounds, hotspots, migrationRoute, platformHeightMeters: 0 };
}
