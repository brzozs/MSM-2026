import type { MigrationRoute } from './mapFrames.ts';

export type SeasonalMigrationDirection = 'northbound' | 'southbound' | null;

// Broad seasonal guide, not measured headings, species tracks or precise national phenology.
// Spring/fall month boundaries are an application convention supported by the sources below.
export const seasonalMigrationSources = [
  { label: 'Cornell migration basics', url: 'https://www.allaboutbirds.org/news/the-basics-how-why-and-where-of-bird-migration/' },
  { label: 'USFWS fall migration', url: 'https://www.fws.gov/story/2026-10/fall-flights-migration-hot-spots-supported-industry-excise-tax' },
  { label: 'USFWS seasonal birding', url: 'https://www.fws.gov/locations/ash-meadows-national-wildlife-refuge/birding' },
];

export function getSeasonalMigrationDirection(forecastDate: string): SeasonalMigrationDirection {
  const date = new Date(`${forecastDate}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(forecastDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== forecastDate) {
    throw new RangeError('Seasonal migration needs a valid UTC forecast date.');
  }
  const month = date.getUTCMonth() + 1;
  if (month >= 3 && month <= 5) return 'northbound';
  if (month >= 9 && month <= 11) return 'southbound';
  return null;
}

export function orientSeasonalRoutes(routes: readonly MigrationRoute[], direction: SeasonalMigrationDirection): readonly MigrationRoute[] {
  if (direction === null) return [];
  return direction === 'northbound' ? routes : routes.map((route) => [route[2], route[1], route[0]]);
}
