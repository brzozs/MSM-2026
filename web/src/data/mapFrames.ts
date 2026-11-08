import type { FeatureCollection, MultiPolygon, Point, Polygon, Position } from 'geojson';
import type { StateBoundaries, StateProperties } from './mapTypes';

export interface TimelineDay { date: string; weekday: string; dayOfMonth: string; isToday: boolean }
export interface DemoPointProperties { intensity: number; is_example: true }
export type StateActivityFrame = FeatureCollection<Polygon | MultiPolygon, StateProperties & { sample_tick_activity: number; display_height: number; is_example: true }>;
export const baseStateHeightMeters = 45000;
export const maximumStateHeightMeters = 320000;
export const birdWingPhaseCount = 3;
export type MigrationRoute = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];
const flockFormation = [[0, 0], [-1, 1], [1, 1], [-2, 2], [2, 2], [-3, 3], [3, 3]] as const;
export const birdsPerFlock = flockFormation.length;
export const flocksPerRoute = 3;
interface DemoBirdProperties {
  bearing: number;
  wing_phase: number;
  route_id: number;
  route_progress: number;
  flock_side: number;
  flock_rank: number;
  flock_id: number;
  is_example: true;
}

// Synthetic display fixtures. These coordinates and weights are not observations.
const activityCenters = [
  [-74, 42], [-71.5, 43], [-76.5, 40.5], [-78, 37.5], [-81, 35],
  [-84, 33], [-87, 36], [-90, 34], [-92, 39], [-89, 43],
  [-84, 42], [-97, 32], [-100, 38], [-105, 40], [-121, 39], [-122, 45],
];
export const migrationRoutes: readonly MigrationRoute[] = [
  [[-82, 26, 460000], [-83, 38, 640000], [-71, 47, 460000]],
  [[-96, 27, 460000], [-89, 37, 640000], [-92, 49, 460000]],
  [[-104, 29, 460000], [-107, 38, 640000], [-105, 49, 460000]],
  [[-117, 31, 460000], [-125, 39, 640000], [-122, 49, 460000]],
];
export const migrationRouteCount = migrationRoutes.length;

export function getMigrationRoutePosition(routeIndex: number, progress: number, routes: readonly MigrationRoute[] = migrationRoutes): [number, number, number] {
  if (!Number.isInteger(routeIndex) || routeIndex < 0 || routeIndex >= routes.length || !Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new RangeError('Migration route and progress must identify a point on a sample route.');
  }
  return routePosition(routes[routeIndex], progress) as [number, number, number];
}

function routePosition(route: MigrationRoute, progress: number): Position {
  return [0, 1, 2].map((axis) => (1 - progress) ** 2 * route[0][axis]
    + 2 * (1 - progress) * progress * route[1][axis]
    + progress ** 2 * route[2][axis]);
}

export function createTimelineDays(referenceDate: Date): TimelineDay[] {
  const today = Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate());
  return Array.from({ length: 7 }, (_, dayIndex) => {
    const date = new Date(today + (dayIndex - 3) * 86_400_000);
    return {
      date: date.toISOString().slice(0, 10),
      weekday: new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(date),
      dayOfMonth: String(date.getUTCDate()).padStart(2, '0'),
      isToday: dayIndex === 3,
    };
  });
}

export function buildDemoFrame(selectedDayIndex: number): {
  observations: FeatureCollection<Point, DemoPointProperties>;
} {
  if (!Number.isInteger(selectedDayIndex) || selectedDayIndex < 0 || selectedDayIndex > 6) {
    throw new RangeError('Preview day must be an integer from 0 through 6.');
  }
  return {
    observations: {
      type: 'FeatureCollection',
      features: activityCenters.flatMap(([longitude, latitude], centerIndex) =>
        Array.from({ length: 8 }, (_, pointIndex) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [longitude + Math.sin(pointIndex * 2.4 + centerIndex) * 0.85, latitude + Math.cos(pointIndex * 1.8) * 0.6] },
          properties: { intensity: 0.12 + (Math.sin(centerIndex * 1.3 + selectedDayIndex * 0.7) + 1) * 0.3 + (Math.sin(pointIndex * 1.8) + 1) * 0.08, is_example: true as const },
        }))),
    },
  };
}

export function buildStateActivityFrame(stateBoundaries: StateBoundaries, selectedDayIndex: number): StateActivityFrame {
  const samplePoints = buildDemoFrame(selectedDayIndex).observations.features;
  return {
    type: 'FeatureCollection',
    features: stateBoundaries.features.map((state) => {
      const [stateLongitude, stateLatitude] = state.properties.center;
      // A display fixture sampled from the same synthetic hotspots as the glow.
      // This is not a state aggregation of observations or an ecological risk model.
      const sampleTickActivity = samplePoints.reduce((highestActivity, point) => {
        const longitudeDistance = (point.geometry.coordinates[0] - stateLongitude) * Math.cos(stateLatitude * Math.PI / 180);
        const latitudeDistance = point.geometry.coordinates[1] - stateLatitude;
        const proximity = Math.exp(-(longitudeDistance ** 2 + latitudeDistance ** 2) / 18);
        return Math.max(highestActivity, point.properties.intensity * proximity);
      }, 0);
      return { ...state, properties: { ...state.properties, sample_tick_activity: sampleTickActivity,
        display_height: baseStateHeightMeters + sampleTickActivity * (maximumStateHeightMeters - baseStateHeightMeters), is_example: true } };
    }),
  };
}

export function getBirdFeatures(elapsedSeconds: number, routes: readonly MigrationRoute[] = migrationRoutes): FeatureCollection<Point, DemoBirdProperties> {
  return {
    type: 'FeatureCollection',
    features: routes.flatMap((route, routeIndex) => Array.from({ length: flocksPerRoute }, (_, flockIndex) => flockFormation.map(([flockSide, flockRank], birdIndex) => {
      const progress = (elapsedSeconds * 0.022 + flockIndex / flocksPerRoute + routeIndex * 0.21) % 1;
      const position = getMigrationRoutePosition(routeIndex, progress, routes);
      const nextPosition = routePosition(route, Math.min(1, progress + 0.001));
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: position },
        properties: {
          bearing: Math.atan2((nextPosition[0] - position[0]) * Math.cos(position[1] * Math.PI / 180), nextPosition[1] - position[1]) * 180 / Math.PI,
          wing_phase: birdIndex % birdWingPhaseCount, route_id: routeIndex, route_progress: progress,
          flock_side: flockSide, flock_rank: flockRank, flock_id: flockIndex, is_example: true as const,
        },
      };
    })).flat()),
  };
}
