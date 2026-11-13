import type { MigrationRoute } from './mapFrames.ts';

export interface MigrationFlyway {
  id: string;
  species: string;
  breedingRegion: string;
  winteringRegion: string;
  sourceUrl: string;
  northboundRoute: MigrationRoute;
  southboundRoute: MigrationRoute;
}

// Illustrative corridors between representative regions, not recorded bird tracks.
// Waypoints and exaggerated display altitudes are hand chosen; see docs/migration-routes.md.
export const migrationFlyways: readonly MigrationFlyway[] = [
  {
    id: 'northern-pintail-pacific',
    species: 'Northern pintail',
    breedingRegion: 'Alaska',
    winteringRegion: 'California Central Valley',
    sourceUrl: 'https://research.fs.usda.gov/feis/species-reviews/anac',
    northboundRoute: [
      [-121.5, 38.5, 480000], [-122.5, 43, 520000], [-123, 48.5, 560000],
      [-130, 54, 600000], [-140, 60, 540000], [-149, 64, 480000],
    ],
    southboundRoute: [
      [-149, 64, 480000], [-140, 60, 540000], [-130, 54, 600000],
      [-123, 48.5, 560000], [-122.5, 43, 520000], [-121.5, 38.5, 480000],
    ],
  },
  {
    id: 'sandhill-crane-midcontinent',
    species: 'Sandhill crane',
    breedingRegion: 'Northwest Canada',
    winteringRegion: 'Northern Mexico',
    sourceUrl: 'https://www.fws.gov/project/sandhill-crane-surveys',
    northboundRoute: [
      [-106, 29, 480000], [-101.5, 34, 520000], [-99, 40.7, 560000],
      [-100.5, 47, 600000], [-106, 54, 540000], [-115, 62, 480000],
    ],
    southboundRoute: [
      [-115, 62, 480000], [-106, 54, 540000], [-100.5, 47, 600000],
      [-99, 40.7, 560000], [-101.5, 34, 520000], [-106, 29, 480000],
    ],
  },
  {
    id: 'swainsons-hawk-americas',
    species: "Swainson's hawk",
    breedingRegion: 'Western United States',
    winteringRegion: 'Argentine Pampas',
    sourceUrl: 'https://tpwd.texas.gov/huntwild/wild/species/swainson/',
    northboundRoute: [
      [-63.5, -34.5, 480000], [-65, -20, 520000], [-71, -5, 560000],
      [-75, 5, 600000], [-79.5, 9, 600000], [-84, 10, 600000],
      [-91, 15, 600000], [-94.5, 16.5, 580000], [-96.5, 19.2, 560000],
      [-97.6, 27.9, 540000], [-104, 38, 520000], [-111, 45, 480000],
    ],
    southboundRoute: [
      [-111, 45, 480000], [-104, 38, 520000], [-97.6, 27.9, 540000],
      [-96.5, 19.2, 560000], [-94.5, 16.5, 580000], [-91, 15, 600000],
      [-84, 10, 600000], [-79.5, 9, 600000], [-75, 5, 600000],
      [-71, -5, 560000], [-65, -20, 520000], [-63.5, -34.5, 480000],
    ],
  },
  {
    id: 'blackpoll-warbler-atlantic-loop',
    species: 'Blackpoll warbler',
    breedingRegion: 'Northeastern Canadian boreal forest',
    winteringRegion: 'Northern South America',
    sourceUrl: 'https://www.birds.cornell.edu/landtrust/blackpoll-warbler-blpw/',
    northboundRoute: [
      [-65, 8, 480000], [-69, 18, 520000], [-77, 23, 560000],
      [-80.5, 27, 600000], [-78, 35, 560000], [-74, 42, 520000], [-65, 52, 480000],
    ],
    southboundRoute: [
      [-65, 52, 480000], [-64, 45, 520000], [-70, 42, 560000],
      [-61, 30, 600000], [-60, 20, 540000], [-65, 8, 480000],
    ],
  },
];
