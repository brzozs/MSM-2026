import assert from 'node:assert/strict';
import test from 'node:test';
import { getSeasonalMigrationDirection, getSeasonalMigrationRoutes } from './seasonalMigration.ts';
import { getBirdFeatures, getMigrationRoutePosition, type MigrationRoute } from './mapFrames.ts';
import { buildBirdGeometry } from './migrationGeometry.ts';
import { migrationFlyways } from './migrationFlyways.ts';

const route: MigrationRoute = [[-90, 28, 460000], [-90, 38, 640000], [-90, 48, 460000]];

test('state focus keeps the same route geography and flock progress instead of inventing a local north/south path', () => {
  for (const direction of ['northbound', 'southbound'] as const) {
    const nationalRoutes = getSeasonalMigrationRoutes(direction);
    const regionalRoutes = getSeasonalMigrationRoutes(direction, true);
    assert.ok(nationalRoutes.length > 0);
    const nationalBirds = getBirdFeatures(17, nationalRoutes).features;
    const regionalBirds = getBirdFeatures(17, regionalRoutes).features;
    assert.equal(regionalBirds.length, nationalBirds.length);
    for (const [birdIndex, bird] of nationalBirds.entries()) {
      assert.deepEqual(regionalBirds[birdIndex].geometry.coordinates.slice(0, 2), bird.geometry.coordinates.slice(0, 2));
      assert.deepEqual(regionalBirds[birdIndex].properties, bird.properties);
      assert.ok(regionalBirds[birdIndex].geometry.coordinates[2] < 20000);
    }
  }
  assert.deepEqual(getSeasonalMigrationRoutes(null), []);
});

test('seasonal guidance follows broad spring/fall patterns and withholds other months', () => {
  assert.equal(getSeasonalMigrationDirection('2026-04-12'), 'northbound');
  assert.equal(getSeasonalMigrationDirection('2026-11-08'), 'southbound');
  assert.equal(getSeasonalMigrationDirection('2026-07-01'), null);
  assert.equal(getSeasonalMigrationDirection('2026-01-01'), null);
  assert.throws(() => getSeasonalMigrationDirection('invalid'), RangeError);
});

test('fall flocks face and travel south while spring flocks face and travel north', () => {
  for (const [direction, sign] of [['northbound', 1], ['southbound', -1]] as const) {
    const routes = getSeasonalMigrationRoutes(direction);
    const first = getBirdFeatures(10, routes).features[0];
    const next = getBirdFeatures(10.1, routes).features[0];
    assert.ok((next.geometry.coordinates[1] - first.geometry.coordinates[1]) * sign > 0);
    assert.ok(Math.cos(first.properties.bearing * Math.PI / 180) * sign > 0);
  }
  assert.deepEqual(getSeasonalMigrationRoutes(null), []);
  assert.deepEqual(route[0], [-90, 28, 460000]);
});

test('changing forecast dates in the same season does not reverse or reset flock travel', () => {
  const firstRoutes = getSeasonalMigrationRoutes(getSeasonalMigrationDirection('2026-11-14'));
  const earlierDayRoutes = getSeasonalMigrationRoutes(getSeasonalMigrationDirection('2026-11-08'));
  const first = getBirdFeatures(10, firstRoutes).features[0];
  const next = getBirdFeatures(10.033, earlierDayRoutes).features[0];
  assert.ok(next.properties.route_progress > first.properties.route_progress);
  assert.ok(next.geometry.coordinates[1] < first.geometry.coordinates[1]);
});

test('seasonal routes join named departure and destination regions, including the distinct Atlantic fall crossing', () => {
  for (const direction of ['northbound', 'southbound'] as const) {
    const routes = getSeasonalMigrationRoutes(direction);
    for (const [routeIndex, migrationRoute] of routes.entries()) {
      assert.deepEqual(getMigrationRoutePosition(routeIndex, 0, routes), migrationRoute[0]);
      assert.deepEqual(getMigrationRoutePosition(routeIndex, 1, routes), migrationRoute[migrationRoute.length - 1]);
    }
  }
  const blackpoll = migrationFlyways.find((flyway) => flyway.id === 'blackpoll-warbler-atlantic-loop')!;
  assert.deepEqual(blackpoll.southboundRoute[0].slice(0, 2), [-65, 52]);
  assert.deepEqual(blackpoll.southboundRoute.at(-1)!.slice(0, 2), [-65, 8]);
  assert.ok(blackpoll.southboundRoute.some(([longitude, latitude]) => longitude > -65 && latitude > 20 && latitude < 35), 'Fall route goes offshore in the Atlantic.');
  assert.ok(blackpoll.northboundRoute.some(([longitude, latitude]) => longitude < -80 && latitude > 25 && latitude < 30), 'Spring route returns through Florida.');
  assert.notDeepEqual(blackpoll.northboundRoute, [...blackpoll.southboundRoute].reverse());
});

test('wings flap even with the travel clock held fixed', () => {
  const first = buildBirdGeometry(0.05, 1000, [route], 0);
  const next = buildBirdGeometry(0.25, 1000, [route], 0);
  assert.deepEqual(first.slice(0, 100), next.slice(0, 100), 'body position stays fixed');
  assert.notDeepEqual(first, next, 'wing geometry changes independently of travel');
});
