import assert from 'node:assert/strict';
import test from 'node:test';
import { getElapsedAnimationSeconds } from './animationTiming.ts';
import { getBirdFeatures } from './mapFrames.ts';

test('a frame timestamp slightly before effect setup produces a valid initial flock', () => {
  assert.throws(() => getBirdFeatures((999.5 - 1000) / 1000), RangeError);
  const elapsedSeconds = getElapsedAnimationSeconds(999.5, 1000);
  assert.equal(elapsedSeconds, 0);
  assert.equal(getBirdFeatures(elapsedSeconds).features[0].properties.route_progress, 0);
  assert.equal(getElapsedAnimationSeconds(2000, 1000), 1);
});

test('invalid animation clocks fail explicitly', () => {
  assert.throws(() => getElapsedAnimationSeconds(Number.NaN, 0), RangeError);
});
