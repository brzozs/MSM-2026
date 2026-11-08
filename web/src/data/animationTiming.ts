export function getElapsedAnimationSeconds(animationFrameTimestampMilliseconds: number, animationStartedAtMilliseconds: number): number {
  if (!Number.isFinite(animationFrameTimestampMilliseconds) || !Number.isFinite(animationStartedAtMilliseconds)) {
    throw new RangeError('Animation timestamps must be finite.');
  }
  // RAF timestamps mark frame start, which can precede setup within that frame.
  return Math.max(0, (animationFrameTimestampMilliseconds - animationStartedAtMilliseconds) / 1000);
}

export interface AnimationClock { elapsedSeconds: number }

interface AnimationScheduler {
  now: () => number;
  requestFrame: (callback: (timestamp: number) => void) => number;
  cancelFrame: (frameId: number) => void;
}

// The caller retains the clock across pauses, layer toggles and map recreation.
export function startAnimationLoop(clock: AnimationClock, onFrame: (elapsedSeconds: number) => void, scheduler: AnimationScheduler): () => void {
  let previousTimestamp = scheduler.now();
  let stopped = false;
  let frameId = 0;
  const animate = (timestamp: number) => {
    if (stopped) return;
    clock.elapsedSeconds += getElapsedAnimationSeconds(timestamp, previousTimestamp);
    previousTimestamp = Math.max(previousTimestamp, timestamp);
    onFrame(clock.elapsedSeconds);
    frameId = scheduler.requestFrame(animate);
  };
  frameId = scheduler.requestFrame(animate);
  return () => { stopped = true; scheduler.cancelFrame(frameId); };
}
