import assert from 'node:assert/strict';
import test from 'node:test';
import { getElapsedAnimationSeconds, startAnimationLoop } from './animationTiming.ts';
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

function fakeScheduler() {
  let currentTime = 1000;
  let nextFrameId = 0;
  const callbacks = new Map<number, (timestamp: number) => void>();
  return {
    now: () => currentTime,
    requestFrame: (callback: (timestamp: number) => void) => { callbacks.set(++nextFrameId, callback); return nextFrameId; },
    cancelFrame: (frameId: number) => { callbacks.delete(frameId); },
    advance(milliseconds: number) {
      currentTime += milliseconds;
      const queued = [...callbacks.values()]; callbacks.clear();
      for (const callback of queued) callback(currentTime);
    },
    get callbacks() { return [...callbacks.values()]; },
  };
}

test('bird animation uses every display frame at 60, 120 and 144 Hz', () => {
  for (const refreshRate of [60, 120, 144]) {
    const scheduler = fakeScheduler();
    const clock = { elapsedSeconds: 0 };
    const times: number[] = [];
    const stop = startAnimationLoop(clock, (time) => times.push(time), scheduler);
    for (let index = 0; index < refreshRate; index++) scheduler.advance(1000 / refreshRate);
    stop();
    assert.equal(times.length, refreshRate);
    assert.ok(Math.abs(clock.elapsedSeconds - 1) < 1e-9);
    assert.ok(times.every((time, index) => index === 0 || time > times[index - 1]));
  }
});

test('hidden tabs, reduced motion and layer toggles pause without rewinding or jumping', () => {
  const scheduler = fakeScheduler();
  const clock = { elapsedSeconds: 7 };
  const times: number[] = [];
  const stop = startAnimationLoop(clock, (time) => times.push(time), scheduler);
  scheduler.advance(20);
  const lateCallback = scheduler.callbacks[0];
  stop();
  scheduler.advance(60000);
  lateCallback(scheduler.now());
  assert.deepEqual(times, [7.02], 'a cancelled frame cannot mutate the clock or start a second loop');
  const stopResumed = startAnimationLoop(clock, (time) => times.push(time), scheduler);
  scheduler.advance(20);
  stopResumed();
  assert.ok(Math.abs(clock.elapsedSeconds - 7.04) < 1e-9);
  assert.equal(scheduler.callbacks.length, 0);
});
