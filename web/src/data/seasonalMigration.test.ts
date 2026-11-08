import assert from 'node:assert/strict';
import test from 'node:test';
import { getSeasonalMigrationDirection, orientSeasonalRoutes } from './seasonalMigration.ts';
import { getBirdFeatures, type MigrationRoute } from './mapFrames.ts';
import { buildBirdGeometry } from './migrationGeometry.ts';

const route: MigrationRoute = [[-90, 28, 460000], [-90, 38, 640000], [-90, 48, 460000]];

test('seasonal guidance follows broad spring/fall patterns and withholds other months', () => {
  assert.equal(getSeasonalMigrationDirection('2026-04-12'), 'northbound');
  assert.equal(getSeasonalMigrationDirection('2026-11-08'), 'southbound');
  assert.equal(getSeasonalMigrationDirection('2026-07-01'), null);
  assert.equal(getSeasonalMigrationDirection('2026-01-01'), null);
  assert.throws(() => getSeasonalMigrationDirection('invalid'), RangeError);
});

test('fall flocks face and travel south while spring flocks face and travel north', () => {
  for (const [direction, sign] of [['northbound', 1], ['southbound', -1]] as const) {
    const routes = orientSeasonalRoutes([route], direction);
    const first = getBirdFeatures(10, routes).features[0];
    const next = getBirdFeatures(10.1, routes).features[0];
    assert.ok((next.geometry.coordinates[1] - first.geometry.coordinates[1]) * sign > 0);
    assert.ok(Math.cos(first.properties.bearing * Math.PI / 180) * sign > 0);
  }
  assert.deepEqual(orientSeasonalRoutes([route], null), []);
  assert.deepEqual(route[0], [-90, 28, 460000]);
});

test('changing forecast dates in the same season does not reverse or reset flock travel', () => {
  const firstRoutes = orientSeasonalRoutes([route], getSeasonalMigrationDirection('2026-11-14'));
  const earlierDayRoutes = orientSeasonalRoutes([route], getSeasonalMigrationDirection('2026-11-08'));
  const first = getBirdFeatures(10, firstRoutes).features[0];
  const next = getBirdFeatures(10.033, earlierDayRoutes).features[0];
  assert.ok(next.properties.route_progress > first.properties.route_progress);
  assert.ok(next.geometry.coordinates[1] < first.geometry.coordinates[1]);
});

test('wings flap even with the travel clock held fixed', () => {
  const first = buildBirdGeometry(0.05, 1000, [route], 0);
  const next = buildBirdGeometry(0.25, 1000, [route], 0);
  assert.deepEqual(first.slice(0, 100), next.slice(0, 100), 'body position stays fixed');
  assert.notDeepEqual(first, next, 'wing geometry changes independently of travel');
});
