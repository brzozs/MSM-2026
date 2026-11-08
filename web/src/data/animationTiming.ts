export function getElapsedAnimationSeconds(animationFrameTimestampMilliseconds: number, animationStartedAtMilliseconds: number): number {
  if (!Number.isFinite(animationFrameTimestampMilliseconds) || !Number.isFinite(animationStartedAtMilliseconds)) {
    throw new RangeError('Animation timestamps must be finite.');
  }
  // RAF timestamps mark frame start, which can precede setup within that frame.
  return Math.max(0, (animationFrameTimestampMilliseconds - animationStartedAtMilliseconds) / 1000);
}
