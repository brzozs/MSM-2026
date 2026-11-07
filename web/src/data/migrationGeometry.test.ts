import assert from 'node:assert/strict';
import test from 'node:test';
import { getMigrationRoutePosition, migrationRouteCount } from './mapFrames.ts';
import { buildBirdGeometry, buildWindGeometry, migrationVertexStride } from './migrationGeometry.ts';

test('every sample wind route travels north and stays above the tallest state block', () => {
  for (let routeIndex = 0; routeIndex < migrationRouteCount; routeIndex += 1) {
    let previousLatitude = -90;
    for (let sampleIndex = 0; sampleIndex <= 50; sampleIndex += 1) {
      const [longitude, latitude, altitude] = getMigrationRoutePosition(routeIndex, sampleIndex / 50);
      assert.ok(Number.isFinite(longitude));
      assert.ok(latitude > previousLatitude);
      assert.ok(altitude > 320000);
      previousLatitude = latitude;
    }
  }
  assert.throws(() => getMigrationRoutePosition(-1, 0), RangeError);
  assert.throws(() => getMigrationRoutePosition(0, 1.1), RangeError);
});

test('bird and wind meshes contain finite 3D triangles with bounded colors and altitude', () => {
  for (const geometry of [buildWindGeometry(10000), buildBirdGeometry(0, 3, 20000), buildBirdGeometry(0.2, 3, 20000)]) {
    assert.equal(geometry.length % (migrationVertexStride * 3), 0);
    assert.ok(geometry.length > 0 && geometry.length < 1000000);
    for (let offset = 0; offset < geometry.length; offset += migrationVertexStride) {
      assert.ok(geometry.slice(offset, offset + migrationVertexStride).every(Number.isFinite));
      assert.ok(geometry[offset] >= 0 && geometry[offset] <= 1);
      assert.ok(geometry[offset + 1] >= 0 && geometry[offset + 1] <= 1);
      assert.ok(geometry[offset + 2] > 320000);
      for (let colorIndex = 3; colorIndex <= 6; colorIndex += 1) assert.ok(geometry[offset + colorIndex] >= 0 && geometry[offset + colorIndex] <= 1);
    }
  }
  const startingBirds = buildBirdGeometry(0, 3, 20000);
  const flappingBirds = buildBirdGeometry(0.2, 3, 20000);
  assert.notDeepEqual(startingBirds, flappingBirds);
  const altitudes = Array.from(startingBirds).filter((_, index) => index % migrationVertexStride === 2);
  assert.ok(Math.max(...altitudes) - Math.min(...altitudes) > 50000);
});
