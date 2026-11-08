import { birdWingPhaseCount, getBirdFeatures, getMigrationRoutePosition, migrationRouteCount } from './mapFrames.ts';
import type { MigrationRoute } from './mapFrames.ts';

type Vector3 = [number, number, number];
type Color = [number, number, number, number];
export const migrationVertexStride = 8;
const metersPerDegree = 111320;

const windSegmentCount = 56;
const windSideCount = 6;
const windRingStride = (windSideCount + 1) * migrationVertexStride;
const windTriangleCorners = [0, 1, 2, 1, 3, 2];
const windSideAngles = Array.from({ length: windSideCount + 1 }, (_, index) => ({
  sine: Math.sin(index * Math.PI * 2 / windSideCount), cosine: Math.cos(index * Math.PI * 2 / windSideCount),
}));

export function buildWindGeometry(radiusMeters: number, routes?: readonly MigrationRoute[], reusableVertices?: Float32Array): Float32Array {
  const routeCount = routes?.length ?? migrationRouteCount;
  const requiredLength = routeCount * 3 * windSegmentCount * windSideCount * 6 * migrationVertexStride;
  const vertices = reusableVertices?.length === requiredLength ? reusableVertices : new Float32Array(requiredLength);
  const rings = new Float32Array((windSegmentCount + 1) * windRingStride);
  let destinationOffset = 0;
  for (let routeIndex = 0; routeIndex < routeCount; routeIndex++) {
    for (const streamlineOffset of [-1, 0, 1]) {
      // Compute each shared ring once, then copy its vertices into adjacent triangles.
      for (let ringIndex = 0; ringIndex <= windSegmentCount; ringIndex++) {
        const progress = ringIndex / windSegmentCount;
        const position = getMigrationRoutePosition(routeIndex, progress, routes);
        const before = getMigrationRoutePosition(routeIndex, Math.max(0, progress - 0.001), routes);
        const after = getMigrationRoutePosition(routeIndex, Math.min(1, progress + 0.001), routes);
        const longitudeScale = Math.cos(position[1] * Math.PI / 180);
        const east = (after[0] - before[0]) * longitudeScale;
        const north = after[1] - before[1];
        const tangentLength = Math.hypot(east, north);
        const gustOffset = Math.sin(progress * Math.PI * 3 + streamlineOffset * 0.7) * radiusMeters * 1.1;
        for (let sideIndex = 0; sideIndex <= windSideCount; sideIndex++) {
          const { sine, cosine } = windSideAngles[sideIndex];
          const lateralDistance = streamlineOffset * radiusMeters * 3.2 + gustOffset + cosine * radiusMeters;
          const longitude = position[0] + north / tangentLength * lateralDistance / (metersPerDegree * longitudeScale);
          const latitude = position[1] - east / tangentLength * lateralDistance / metersPerDegree;
          const latitudeRadians = latitude * Math.PI / 180;
          const light = 0.5 + 0.5 * sine;
          const offset = ringIndex * windRingStride + sideIndex * migrationVertexStride;
          rings[offset] = (longitude + 180) / 360;
          rings[offset + 1] = (1 - Math.log(Math.tan(Math.PI / 4 + latitudeRadians / 2)) / Math.PI) / 2;
          rings[offset + 2] = position[2] + sine * radiusMeters + streamlineOffset * radiusMeters * 0.6
            + Math.sin(progress * Math.PI * 2 + streamlineOffset * 0.55) * radiusMeters * 1.5;
          rings[offset + 3] = 0.32 + light * 0.42;
          rings[offset + 4] = 0.49 + light * 0.38;
          rings[offset + 5] = 0.47 + light * 0.36;
          rings[offset + 6] = 0.54;
          rings[offset + 7] = progress;
        }
      }
      for (let segmentIndex = 0; segmentIndex < windSegmentCount; segmentIndex++) {
        for (let sideIndex = 0; sideIndex < windSideCount; sideIndex++) {
          for (const corner of windTriangleCorners) {
            const sourceOffset = (segmentIndex + (corner >= 2 ? 1 : 0)) * windRingStride
              + (sideIndex + corner % 2) * migrationVertexStride;
            for (let componentIndex = 0; componentIndex < migrationVertexStride; componentIndex++) {
              vertices[destinationOffset++] = rings[sourceOffset + componentIndex];
            }
          }
        }
      }
    }
  }
  return vertices;
}

function buildBirdModel(wingAngle: number): number[] {
  const vertices: number[] = [];
  const triangle = (first: Vector3, second: Vector3, third: Vector3, materialBrightness = 1) => {
    const firstEdge = second.map((value, index) => value - first[index]);
    const secondEdge = third.map((value, index) => value - first[index]);
    const normal = [firstEdge[1] * secondEdge[2] - firstEdge[2] * secondEdge[1],
      firstEdge[2] * secondEdge[0] - firstEdge[0] * secondEdge[2], firstEdge[0] * secondEdge[1] - firstEdge[1] * secondEdge[0]];
    const normalLength = Math.hypot(...normal) || 1;
    const lighting = Math.max(0, (-normal[0] * 0.4 + normal[1] * 0.3 + normal[2] * 0.86) / normalLength);
    const shade = (0.025 + lighting * 0.2) * materialBrightness;
    const color: Color = [shade * 0.78, shade * 0.86, shade, 1];
    for (const position of [first, second, third]) vertices.push(...position, ...color, -1);
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
  return vertices;
}

export function buildBirdGeometry(elapsedSeconds: number, modelScaleMeters: number, routes?: readonly MigrationRoute[], flightElapsedSeconds = elapsedSeconds, reusableVertices?: Float32Array): Float32Array {
  const birds = getBirdFeatures(flightElapsedSeconds, routes).features;
  if (!birds.length) return reusableVertices?.length === 0 ? reusableVertices : new Float32Array(0);
  // Flocks share three wing phases, so build each local model once per frame.
  const models = Array.from({ length: birdWingPhaseCount }, (_, wingPhase) =>
    buildBirdModel(Math.sin(elapsedSeconds * 9 + wingPhase * Math.PI * 2 / birdWingPhaseCount) * 0.7));
  const requiredLength = birds.length * models[0].length;
  const vertices = reusableVertices?.length === requiredLength ? reusableVertices : new Float32Array(requiredLength);
  let destinationOffset = 0;
  for (const bird of birds) {
    const [longitude, latitude, altitude] = bird.geometry.coordinates;
    const bearing = bird.properties.bearing * Math.PI / 180;
    const bearingCosine = Math.cos(bearing);
    const bearingSine = Math.sin(bearing);
    const longitudeMetersPerDegree = metersPerDegree * Math.cos(latitude * Math.PI / 180);
    const flightAltitude = altitude + (routes ? Math.max(100, Math.min(12000, altitude * 0.06)) : 12000);
    const opacity = Math.min(1, bird.properties.route_progress / 0.035, (1 - bird.properties.route_progress) / 0.035);
    const model = models[bird.properties.wing_phase];
    for (let offset = 0; offset < model.length; offset += migrationVertexStride) {
      const flockX = model[offset] + bird.properties.flock_side * 4.5;
      const flockY = model[offset + 1] - bird.properties.flock_rank * 5.5;
      const east = (flockX * bearingCosine + flockY * bearingSine) * modelScaleMeters;
      const north = (-flockX * bearingSine + flockY * bearingCosine) * modelScaleMeters;
      const vertexLongitude = longitude + east / longitudeMetersPerDegree;
      const latitudeRadians = (latitude + north / metersPerDegree) * Math.PI / 180;
      vertices[destinationOffset++] = (vertexLongitude + 180) / 360;
      vertices[destinationOffset++] = (1 - Math.log(Math.tan(Math.PI / 4 + latitudeRadians / 2)) / Math.PI) / 2;
      vertices[destinationOffset++] = flightAltitude + (model[offset + 2] + bird.properties.flock_side * 0.1) * modelScaleMeters;
      vertices[destinationOffset++] = model[offset + 3];
      vertices[destinationOffset++] = model[offset + 4];
      vertices[destinationOffset++] = model[offset + 5];
      vertices[destinationOffset++] = opacity;
      vertices[destinationOffset++] = -1;
    }
  }
  return vertices;
}
