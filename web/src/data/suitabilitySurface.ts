import type { Position } from 'geojson';
import type { StateBounds } from './regionFocus.ts';

export const tickSuitabilityColorStops = [
  { value: 0, color: '#46764f' }, { value: 0.2, color: '#75a05d' }, { value: 0.4, color: '#b5ad67' },
  { value: 0.6, color: '#d99a5e' }, { value: 1, color: '#df7e44' },
];
const earthRadiusMeters = 6371008.8;
const radiansPerDegree = Math.PI / 180;

export interface SuitabilitySurfaceGrid {
  width: number;
  height: number;
  sampleCount: number;
  sampleOffsets: Uint32Array;
  sampleIndices: Int32Array;
  sampleWeights: Float32Array;
  nearestSampleIndices: Int32Array;
  bounds: StateBounds;
  projectedBounds: StateBounds;
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
}

function longitudeNear(longitude: number, reference: number) {
  return reference + ((longitude - reference + 180) % 360 + 360) % 360 - 180;
}

function projectPosition(position: Position, centerLongitude: number): [number, number] {
  return [earthRadiusMeters * longitudeNear(position[0], centerLongitude) * radiansPerDegree,
    earthRadiusMeters * Math.log(Math.tan(Math.PI / 4 + position[1] * radiansPerDegree / 2))];
}

export function surfacePixelForCoordinate(grid: SuitabilitySurfaceGrid, position: Position): [number, number] {
  const [[west, south], [east, north]] = grid.projectedBounds;
  const [x, y] = projectPosition(position, (grid.bounds[0][0] + grid.bounds[1][0]) / 2);
  return [(x - west) / (east - west) * grid.width, (north - y) / (north - south) * grid.height];
}

export function createSuitabilitySurfaceGrid(sampleCoordinates: Position[], bounds: StateBounds,
  maximumDistanceMeters: number, maximumDimensionPixels = 640, samplingSpacingKilometers: number | null = null): SuitabilitySurfaceGrid {
  const [[west, south], [east, north]] = bounds;
  if (!(east > west && north > south && south > -85.1 && north < 85.1)
    || !Number.isFinite(maximumDistanceMeters) || maximumDistanceMeters <= 0
    || (samplingSpacingKilometers !== null && (!Number.isFinite(samplingSpacingKilometers) || samplingSpacingKilometers <= 0))
    || !Number.isInteger(maximumDimensionPixels) || maximumDimensionPixels < 1
    || sampleCoordinates.some((point) => !point.every(Number.isFinite) || Math.abs(point[1]) >= 85.1)) {
    throw new RangeError('Suitability surface requires valid bounds, samples, distance and pixel dimensions.');
  }
  const centerLongitude = (west + east) / 2;
  const projectedBounds: StateBounds = [projectPosition([west, south], centerLongitude), projectPosition([east, north], centerLongitude)];
  const projectedWidth = projectedBounds[1][0] - projectedBounds[0][0];
  const projectedHeight = projectedBounds[1][1] - projectedBounds[0][1];
  const width = Math.max(1, Math.round(maximumDimensionPixels * Math.min(1, projectedWidth / projectedHeight)));
  const height = Math.max(1, Math.round(maximumDimensionPixels * Math.min(1, projectedHeight / projectedWidth)));
  const sampleOffsets = new Uint32Array(width * height + 1);
  const nearestSampleIndices = new Int32Array(width * height).fill(-1);
  const sampleIndices: number[] = [];
  const sampleWeights: number[] = [];
  // Coarse display smoothing is separate from the provider's coordinate-offset limit.
  const interpolationRadiusMeters = samplingSpacingKilometers === null ? maximumDistanceMeters : samplingSpacingKilometers * 1500;
  // A spatial bucket avoids comparing every pixel with every weather sample.
  const largestLatitude = Math.min(85, Math.max(Math.abs(south), Math.abs(north), ...sampleCoordinates.map((point) => Math.abs(point[1])))
    + interpolationRadiusMeters / earthRadiusMeters / radiansPerDegree);
  const bucketSize = interpolationRadiusMeters / Math.cos(largestLatitude * radiansPerDegree);
  const buckets = new Map<string, number[]>();
  sampleCoordinates.forEach((point, index) => {
    const [x, y] = projectPosition(point, centerLongitude);
    const key = `${Math.floor(x / bucketSize)},${Math.floor(y / bucketSize)}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(index); buckets.set(key, bucket);
  });
  // Reserve each pixel's footprint so raster filtering cannot extend the published support.
  const closestLatitudeToEquator = south <= 0 && north >= 0 ? 0 : Math.min(Math.abs(south), Math.abs(north));
  const pixelFootprintMeters = Math.hypot(projectedWidth / width, projectedHeight / height) * Math.cos(closestLatitudeToEquator * radiansPerDegree);
  const supportedDistanceMeters = Math.max(0, interpolationRadiusMeters - pixelFootprintMeters);
  for (let row = 0; row < height; row += 1) {
    const y = projectedBounds[1][1] - (row + 0.5) / height * projectedHeight;
    const latitude = (2 * Math.atan(Math.exp(y / earthRadiusMeters)) - Math.PI / 2) / radiansPerDegree;
    const latitudeRadians = latitude * radiansPerDegree;
    for (let column = 0; column < width; column += 1) {
      const x = projectedBounds[0][0] + (column + 0.5) / width * projectedWidth;
      const longitude = x / earthRadiusMeters / radiansPerDegree;
      const pixelIndex = row * width + column;
      sampleOffsets[pixelIndex] = sampleIndices.length;
      let nearestDistanceMeters = Infinity;
      for (let bucketRow = -1; bucketRow <= 1; bucketRow += 1) for (let bucketColumn = -1; bucketColumn <= 1; bucketColumn += 1) {
        const bucket = buckets.get(`${Math.floor(x / bucketSize) + bucketColumn},${Math.floor(y / bucketSize) + bucketRow}`);
        for (const index of bucket ?? []) {
          const point = sampleCoordinates[index];
          const haversine = Math.sin((point[1] - latitude) * radiansPerDegree / 2) ** 2
            + Math.cos(latitudeRadians) * Math.cos(point[1] * radiansPerDegree) * Math.sin((point[0] - longitude) * radiansPerDegree / 2) ** 2;
          const distance = 2 * earthRadiusMeters * Math.asin(Math.sqrt(Math.min(1, haversine)));
          if (distance >= supportedDistanceMeters) continue;
          if (distance < nearestDistanceMeters) {
            nearestDistanceMeters = distance;
            nearestSampleIndices[pixelIndex] = index;
          }
          // Every neighbor tapers smoothly to zero; no singular peaks or nearest-four seams.
          sampleIndices.push(index);
          sampleWeights.push((1 - (distance / supportedDistanceMeters) ** 2) ** 2);
        }
      }
    }
  }
  sampleOffsets[width * height] = sampleIndices.length;
  return { width, height, sampleCount: sampleCoordinates.length, sampleOffsets, nearestSampleIndices,
    sampleIndices: Int32Array.from(sampleIndices), sampleWeights: Float32Array.from(sampleWeights),
    bounds, projectedBounds, coordinates: [[west, north], [east, north], [east, south], [west, south]] };
}

const surfaceColorLookup = new Uint8ClampedArray(1025 * 3);
for (let index = 0; index <= 1024; index += 1) {
  const value = index / 1024;
  const upperIndex = Math.max(1, tickSuitabilityColorStops.findIndex((stop) => stop.value >= value));
  const lower = tickSuitabilityColorStops[upperIndex - 1];
  const upper = tickSuitabilityColorStops[upperIndex];
  const progress = (value - lower.value) / (upper.value - lower.value);
  for (let channel = 0; channel < 3; channel += 1) {
    const lowerChannel = parseInt(lower.color.slice(1 + channel * 2, 3 + channel * 2), 16);
    const upperChannel = parseInt(upper.color.slice(1 + channel * 2, 3 + channel * 2), 16);
    surfaceColorLookup[index * 3 + channel] = lowerChannel + (upperChannel - lowerChannel) * progress;
  }
}

export function renderSuitabilitySurface(grid: SuitabilitySurfaceGrid, values: (number | null)[],
  pixels = new Uint8ClampedArray(grid.width * grid.height * 4)): Uint8ClampedArray {
  if (values.length !== grid.sampleCount || values.some((value) => value !== null && (!Number.isFinite(value) || value < 0 || value > 1))
    || pixels.length !== grid.width * grid.height * 4) throw new RangeError('Surface values must match the samples and remain between zero and one.');
  pixels.fill(0);
  for (let pixel = 0; pixel < grid.width * grid.height; pixel += 1) {
    const nearestSampleIndex = grid.nearestSampleIndices[pixel];
    if (nearestSampleIndex === -1 || values[nearestSampleIndex] === null) continue;
    let weightedValue = 0;
    let totalWeight = 0;
    for (let offset = grid.sampleOffsets[pixel]; offset < grid.sampleOffsets[pixel + 1]; offset += 1) {
      const sampleValue = values[grid.sampleIndices[offset]];
      if (sampleValue === null) continue;
      weightedValue += sampleValue * grid.sampleWeights[offset];
      totalWeight += grid.sampleWeights[offset];
    }
    if (totalWeight === 0) continue;
    const value = weightedValue / totalWeight;
    const colorOffset = Math.min(1024, Math.max(0, Math.round(value * 1024))) * 3;
    pixels[pixel * 4] = surfaceColorLookup[colorOffset];
    pixels[pixel * 4 + 1] = surfaceColorLookup[colorOffset + 1];
    pixels[pixel * 4 + 2] = surfaceColorLookup[colorOffset + 2];
    pixels[pixel * 4 + 3] = 255;
  }
  return pixels;
}
