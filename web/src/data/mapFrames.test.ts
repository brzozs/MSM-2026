import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDemoFrame, createTimelineDays, getBirdFeatures } from './mapFrames.ts';

test('timeline stays on UTC calendar days across the daylight-saving boundary', () => {
  const days = createTimelineDays(new Date('2026-11-01T02:00:00Z'));
  assert.equal(days.length, 7);
  assert.equal(days[0].date, '2026-10-29');
  assert.equal(days[3].date, '2026-11-01');
  assert.equal(days[6].date, '2026-11-04');
  assert.equal(days[3].isToday, true);
});

test('changing the preview day changes the illustrative overlay without mutating earlier frames', () => {
  const firstFrame = buildDemoFrame(0);
  const originalFrame = structuredClone(firstFrame);
  const laterFrame = buildDemoFrame(4);
  assert.notDeepEqual(firstFrame.observations, laterFrame.observations);
  assert.deepEqual(firstFrame, originalFrame);
  for (const feature of laterFrame.observations.features) {
    assert.equal(feature.properties.is_example, true);
    assert.ok(feature.properties.intensity >= 0 && feature.properties.intensity <= 1);
  }
});

test('invalid preview days are rejected rather than selecting an unrelated frame', () => {
  for (const invalidDay of [-1, 7, 1.5, Number.NaN]) {
    assert.throws(() => buildDemoFrame(invalidDay), RangeError);
  }
});

test('illustrative bird markers move along bounded routes with finite bearings', () => {
  const startingBirds = getBirdFeatures(0, 3);
  const laterBirds = getBirdFeatures(12, 3);
  assert.equal(startingBirds.features.length, 16);
  assert.notDeepEqual(startingBirds, laterBirds);
  for (const feature of laterBirds.features) {
    const [longitude, latitude] = feature.geometry.coordinates;
    assert.ok(longitude >= -130 && longitude <= -65);
    assert.ok(latitude >= 20 && latitude <= 55);
    assert.ok(Number.isFinite(feature.properties.bearing));
    assert.equal(feature.properties.is_example, true);
  }
});
