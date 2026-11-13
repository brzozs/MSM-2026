import type { Position } from 'geojson';
import type { StateBoundaries } from './mapTypes';

export type StateFeature = StateBoundaries['features'][number];
export type StateBounds = [[number, number], [number, number]];

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
