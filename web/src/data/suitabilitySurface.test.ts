import assert from 'node:assert/strict';
import test from 'node:test';
import { createSuitabilitySurfaceGrid, renderSuitabilitySurface } from './suitabilitySurface.ts';

test('surface colors represent model values, including real zero, rather than sample density', () => {
  const grid = createSuitabilitySurfaceGrid([[0, 0]], [[-0.01, -0.01], [0.01, 0.01]], 25000, 1);
  assert.deepEqual([...renderSuitabilitySurface(grid, [0])], [70, 118, 79, 255]);
  assert.deepEqual([...renderSuitabilitySurface(grid, [1])], [223, 126, 68, 255]);
  const pairedGrid = createSuitabilitySurfaceGrid([[-0.01, 0], [0.01, 0]], [[-0.001, -0.001], [0.001, 0.001]], 25000, 1);
  const blended = renderSuitabilitySurface(pairedGrid, [0, 1]);
  assert.equal(blended[3], 255);
  assert.ok(Math.abs(blended[0] - 199) <= 1 && Math.abs(blended[1] - 164) <= 1);
});

test('surface retains nearby border weather cells and leaves unsupported areas transparent', () => {
  const bounds: [[number, number], [number, number]] = [[-0.01, -0.01], [0.01, 0.01]];
  const nearBorder = createSuitabilitySurfaceGrid([[0.1, 0]], bounds, 25000, 1);
  assert.equal(renderSuitabilitySurface(nearBorder, [0.8])[3], 255);
  const beyondSupport = createSuitabilitySurfaceGrid([[0.3, 0]], bounds, 25000, 1);
  assert.deepEqual([...renderSuitabilitySurface(beyondSupport, [1])], [0, 0, 0, 0]);
});

test('surface uses the short distance across the antimeridian', () => {
  const grid = createSuitabilitySurfaceGrid([[179.99, 60]], [[-180.02, 59.99], [-179.98, 60.01]], 25000, 1);
  assert.equal(renderSuitabilitySurface(grid, [0.6])[3], 255);
});

test('surface rejects mismatched or invalid model values', () => {
  const grid = createSuitabilitySurfaceGrid([[0, 0]], [[-0.01, -0.01], [0.01, 0.01]], 25000, 1);
  assert.throws(() => renderSuitabilitySurface(grid, []), RangeError);
  assert.throws(() => renderSuitabilitySurface(grid, [NaN]), RangeError);
  assert.throws(() => renderSuitabilitySurface(grid, [1.1]), RangeError);
});

test('50 km reference samples blend across the space between grid points', () => {
  // Four samples about 50 km apart: their center is outside every old 25 km disk.
  const grid = createSuitabilitySurfaceGrid([[-0.225, -0.225], [0.225, -0.225], [-0.225, 0.225], [0.225, 0.225]],
    [[-0.001, -0.001], [0.001, 0.001]], 25000, 1, 50);
  const pixels = renderSuitabilitySurface(grid, [0, 1, 0, 1]);
  assert.equal(pixels[3], 255);
  assert.ok(Math.abs(pixels[0] - 199) <= 1 && Math.abs(pixels[1] - 164) <= 1);
});

test('nearby extreme samples form a broad gradient instead of isolated color spikes', () => {
  const grid = createSuitabilitySurfaceGrid([[0, 0], [0.45, 0]], [[-0.0001, -0.0001], [0.0001, 0.0001]], 75000, 1);
  const pixels = renderSuitabilitySurface(grid, [0, 1]);
  // The warm neighbor still contributes at a cool reference point, removing bullseyes.
  assert.equal(pixels[3], 255);
  assert.ok(pixels[0] > 120 && pixels[0] < 170);
});

test('a missing nearest sample stays transparent rather than borrowing surrounding values', () => {
  const grid = createSuitabilitySurfaceGrid([[0, 0], [0.45, 0]], [[-0.0001, -0.0001], [0.0001, 0.0001]], 75000, 1);
  assert.deepEqual([...renderSuitabilitySurface(grid, [null, 1])], [0, 0, 0, 0]);
  assert.deepEqual([...renderSuitabilitySurface(grid, [0, null])], [70, 118, 79, 255]);
});
