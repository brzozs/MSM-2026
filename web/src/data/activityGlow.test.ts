import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildElevatedActivity } from './activityGlow.ts';
import { buildStateActivityFrame } from './mapFrames.ts';
import type { StateBoundaries } from './mapTypes';

test('heatmap glows follow the same daily roof height used to extrude their containing state', () => {
  const boundaries: StateBoundaries = JSON.parse(readFileSync(new URL('../../public/data/states.geojson', import.meta.url), 'utf8'));
  const observations = { type: 'FeatureCollection' as const, features: [{ type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [-75, 43] }, properties: { intensity: 0.8, is_example: true as const } }] };
  const heights: number[] = [];
  for (const dayIndex of [0, 4]) {
    const stateFrame = buildStateActivityFrame(boundaries, dayIndex);
    const roof = stateFrame.features.find((state) => state.properties.code === 'NY')!.properties.display_height;
    const glow = buildElevatedActivity(stateFrame, observations);
    assert.equal(glow.features.length, 1);
    const height = glow.features[0].properties.display_height;
    assert.ok(height > roof && height <= roof + 2000);
    heights.push(height);
  }
  assert.notEqual(heights[0], heights[1]);
});
