import type { FeatureCollection, LineString, Point, Position } from 'geojson';

export interface TimelineDay { date: string; weekday: string; dayOfMonth: string; isToday: boolean }
export interface DemoPointProperties { intensity: number; is_example: true }

// Synthetic display fixtures. These coordinates and weights are not observations.
const activityCenters = [
  [-74, 42], [-71.5, 43], [-76.5, 40.5], [-78, 37.5], [-81, 35],
  [-84, 33], [-87, 36], [-90, 34], [-92, 39], [-89, 43],
  [-84, 42], [-97, 32], [-100, 38], [-105, 40], [-121, 39], [-122, 45],
];
const migrationRoutes = [
  [[-82, 26], [-83, 38], [-71, 47]],
  [[-96, 27], [-89, 37], [-92, 49]],
  [[-104, 29], [-107, 38], [-105, 49]],
  [[-117, 31], [-125, 39], [-122, 49]],
];

function routePosition(route: number[][], progress: number): Position {
  return [0, 1].map((axis) => (1 - progress) ** 2 * route[0][axis]
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
  routes: FeatureCollection<LineString>;
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
          properties: { intensity: 0.25 + (Math.sin(centerIndex * 1.3 + selectedDayIndex * 0.7 + pointIndex) + 1) * 0.35, is_example: true as const },
        }))),
    },
    routes: {
      type: 'FeatureCollection',
      features: migrationRoutes.map((route, routeIndex) => ({
        type: 'Feature', properties: { route_id: routeIndex, is_example: true },
        geometry: { type: 'LineString', coordinates: Array.from({ length: 45 }, (_, index) => routePosition(route, index / 44)) },
      })),
    },
  };
}

export function getBirdFeatures(elapsedSeconds: number, selectedDayIndex: number): FeatureCollection<Point, { bearing: number; is_example: true }> {
  return {
    type: 'FeatureCollection',
    features: migrationRoutes.flatMap((route, routeIndex) => Array.from({ length: 4 }, (_, birdIndex) => {
      const progress = (elapsedSeconds * 0.022 + birdIndex / 4 + selectedDayIndex * 0.045 + routeIndex * 0.04) % 1;
      const position = routePosition(route, progress);
      const nextPosition = routePosition(route, Math.min(1, progress + 0.001));
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: position },
        properties: { bearing: Math.atan2((nextPosition[0] - position[0]) * Math.cos(position[1] * Math.PI / 180), nextPosition[1] - position[1]) * 180 / Math.PI, is_example: true as const },
      };
    })),
  };
}
