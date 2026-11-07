import { birdWingPhaseCount, getBirdFeatures, getMigrationRoutePosition, migrationRouteCount } from './mapFrames.ts';
import type { MigrationRoute } from './mapFrames.ts';

type Vector3 = [number, number, number];
type Color = [number, number, number, number];
export const migrationVertexStride = 8;
const metersPerDegree = 111320;

function appendVertex(vertices: number[], position: Vector3, color: Color, progress: number) {
  const [longitude, latitude, altitude] = position;
  const latitudeRadians = latitude * Math.PI / 180;
  vertices.push((longitude + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + latitudeRadians / 2)) / Math.PI) / 2,
    altitude, ...color, progress);
}

export function buildWindGeometry(radiusMeters: number, routes?: readonly MigrationRoute[]): Float32Array {
  const vertices: number[] = [];
  const segmentCount = 56;
  const sideCount = 6;
  for (let routeIndex = 0; routeIndex < (routes?.length ?? migrationRouteCount); routeIndex += 1) {
    for (const streamlineOffset of [-1, 0, 1]) {
      const ringVertex = (progress: number, sideIndex: number): { position: Vector3; color: Color } => {
        const position = getMigrationRoutePosition(routeIndex, progress, routes);
        const before = getMigrationRoutePosition(routeIndex, Math.max(0, progress - 0.001), routes);
        const after = getMigrationRoutePosition(routeIndex, Math.min(1, progress + 0.001), routes);
        const longitudeScale = Math.cos(position[1] * Math.PI / 180);
        const east = (after[0] - before[0]) * longitudeScale;
        const north = after[1] - before[1];
        const tangentLength = Math.hypot(east, north);
        const angle = sideIndex * Math.PI * 2 / sideCount;
        const gustOffset = Math.sin(progress * Math.PI * 3 + streamlineOffset * 0.7) * radiusMeters * 1.1;
        const lateralDistance = streamlineOffset * radiusMeters * 3.2 + gustOffset + Math.cos(angle) * radiusMeters;
        const light = 0.5 + 0.5 * Math.sin(angle);
        return {
          position: [position[0] + north / tangentLength * lateralDistance / (metersPerDegree * longitudeScale),
            position[1] - east / tangentLength * lateralDistance / metersPerDegree,
            position[2] + Math.sin(angle) * radiusMeters + streamlineOffset * radiusMeters * 0.6
              + Math.sin(progress * Math.PI * 2 + streamlineOffset * 0.55) * radiusMeters * 1.5],
          color: [0.32 + light * 0.42, 0.49 + light * 0.38, 0.47 + light * 0.36, 0.54],
        };
      };
      for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
        const startProgress = segmentIndex / segmentCount;
        const endProgress = (segmentIndex + 1) / segmentCount;
        for (let sideIndex = 0; sideIndex < sideCount; sideIndex += 1) {
          const first = ringVertex(startProgress, sideIndex);
          const second = ringVertex(startProgress, sideIndex + 1);
          const third = ringVertex(endProgress, sideIndex);
          const fourth = ringVertex(endProgress, sideIndex + 1);
          for (const [vertex, progress] of [[first, startProgress], [second, startProgress], [third, endProgress],
            [second, startProgress], [fourth, endProgress], [third, endProgress]] as const) {
            appendVertex(vertices, vertex.position, vertex.color, progress);
          }
        }
      }
    }
  }
  return new Float32Array(vertices);
}

export function buildBirdGeometry(elapsedSeconds: number, selectedDayIndex: number, modelScaleMeters: number, routes?: readonly MigrationRoute[]): Float32Array {
  const vertices: number[] = [];
  for (const bird of getBirdFeatures(elapsedSeconds, selectedDayIndex, routes).features) {
    const [longitude, latitude, altitude] = bird.geometry.coordinates;
    const bearing = bird.properties.bearing * Math.PI / 180;
    const wingAngle = Math.sin(elapsedSeconds * 9 + bird.properties.wing_phase * Math.PI * 2 / birdWingPhaseCount) * 0.7;
    const opacity = Math.min(1, bird.properties.route_progress / 0.035, (1 - bird.properties.route_progress) / 0.035);
    const toWorldPosition = ([x, y, z]: Vector3): Vector3 => {
      const flockX = x + bird.properties.flock_side * 4.5;
      const flockY = y - bird.properties.flock_rank * 5.5;
      const east = (flockX * Math.cos(bearing) + flockY * Math.sin(bearing)) * modelScaleMeters;
      const north = (-flockX * Math.sin(bearing) + flockY * Math.cos(bearing)) * modelScaleMeters;
      return [longitude + east / (metersPerDegree * Math.cos(latitude * Math.PI / 180)),
        latitude + north / metersPerDegree, altitude + (routes ? Math.max(100, Math.min(12000, altitude * 0.06)) : 12000)
          + (z + bird.properties.flock_side * 0.1) * modelScaleMeters];
    };
    const triangle = (first: Vector3, second: Vector3, third: Vector3, materialBrightness = 1) => {
      const firstEdge = second.map((value, index) => value - first[index]);
      const secondEdge = third.map((value, index) => value - first[index]);
      const normal = [firstEdge[1] * secondEdge[2] - firstEdge[2] * secondEdge[1],
        firstEdge[2] * secondEdge[0] - firstEdge[0] * secondEdge[2], firstEdge[0] * secondEdge[1] - firstEdge[1] * secondEdge[0]];
      const normalLength = Math.hypot(...normal) || 1;
      const lighting = Math.max(0, (-normal[0] * 0.4 + normal[1] * 0.3 + normal[2] * 0.86) / normalLength);
      const shade = (0.025 + lighting * 0.2) * materialBrightness;
      const color: Color = [shade * 0.78, shade * 0.86, shade, opacity];
      for (const position of [first, second, third]) appendVertex(vertices, toWorldPosition(position), color, -1);
    };
    const ellipsoid = (center: Vector3, radii: Vector3) => {
      const latitudeSegments = 3;
      const longitudeSegments = 6;
      const point = (latitudeIndex: number, longitudeIndex: number): Vector3 => {
        const latitudeAngle = -Math.PI / 2 + latitudeIndex * Math.PI / latitudeSegments;
        const longitudeAngle = longitudeIndex * Math.PI * 2 / longitudeSegments;
        return [center[0] + radii[0] * Math.cos(latitudeAngle) * Math.cos(longitudeAngle),
          center[1] + radii[1] * Math.cos(latitudeAngle) * Math.sin(longitudeAngle),
          center[2] + radii[2] * Math.sin(latitudeAngle)];
      };
      for (let latitudeIndex = 0; latitudeIndex < latitudeSegments; latitudeIndex += 1) {
        for (let longitudeIndex = 0; longitudeIndex < longitudeSegments; longitudeIndex += 1) {
          const first = point(latitudeIndex, longitudeIndex);
          const second = point(latitudeIndex, longitudeIndex + 1);
          const third = point(latitudeIndex + 1, longitudeIndex);
          const fourth = point(latitudeIndex + 1, longitudeIndex + 1);
          if (latitudeIndex > 0) triangle(first, second, third);
          if (latitudeIndex < latitudeSegments - 1) triangle(second, fourth, third);
        }
      }
    };
    ellipsoid([0, 0, 0], [0.65, 2.1, 0.65]);
    ellipsoid([0, 2.0, 0.35], [0.4, 0.65, 0.42]);
    triangle([-0.25, 2.25, 0.3], [0, 3.2, 0.2], [0.25, 2.25, 0.3], 0.7);
    triangle([-0.3, 2.25, 0.3], [0, 2.55, 0.65], [0, 3.2, 0.2]);
    triangle([0.3, 2.25, 0.3], [0, 3.2, 0.2], [0, 2.55, 0.65]);
    triangle([-0.4, -1.2, 0], [-1.1, -3.3, -0.25], [0, -2.9, 0.15]);
    triangle([0.4, -1.2, 0], [0, -2.9, 0.15], [1.1, -3.3, -0.25]);
    for (const wingDirection of [-1, 1]) {
      const wingPoint = ([x, y, z]: Vector3): Vector3 => [wingDirection * (0.35 + (x - 0.35) * Math.cos(wingAngle)), y,
        0.2 + z + (x - 0.35) * Math.sin(wingAngle)];
      const edge: Vector3[] = [[0.35, 1, 0], [2.2, 0.8, 0.15], [5.7, -0.15, 0], [5.1, -0.7, -0.05],
        [4.5, -0.5, -0.05], [4.3, -1.1, -0.05], [3.7, -0.85, 0], [2.5, -1.25, 0], [0.35, -0.65, 0]];
      const ridge = wingPoint([2.6, -0.1, 0.5]);
      const underside = wingPoint([2.6, -0.1, -0.18]);
      edge.forEach((point, index) => {
        const next = edge[(index + 1) % edge.length];
        const first = wingPoint(point);
        const second = wingPoint(next);
        if (wingDirection > 0) {
          triangle(ridge, second, first);
          triangle(underside, first, second, 0.45);
        } else {
          triangle(ridge, first, second);
          triangle(underside, second, first, 0.45);
        }
      });
    }
  }
  return new Float32Array(vertices);
}
