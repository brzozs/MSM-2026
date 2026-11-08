import assert from 'node:assert/strict';
import test from 'node:test';
import type { CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl';
import { MigrationLayer } from '../map/MigrationLayer.ts';

test('migration rendering reuses unchanged geometry and updates buffers when animation, zoom or routes change', () => {
  const uploads: { method: string; length: number }[] = [];
  let deletedBuffers = 0;
  let deletedVertexArrays = 0;
  let deletedPrograms = 0;
  let draws = 0;
  let zoom = 3.7;
  const noop = () => {};
  const graphics = {
    createBuffer: () => ({}), createVertexArray: () => ({}), createProgram: () => ({}), createShader: () => ({}),
    bindVertexArray: noop, bindBuffer: noop, enableVertexAttribArray: noop, vertexAttribPointer: noop,
    useProgram: noop, uniformMatrix4fv: noop, uniform4fv: noop, uniform1f: noop, enable: noop,
    depthFunc: noop, disable: noop, blendFunc: noop, depthMask: noop, shaderSource: noop,
    compileShader: noop, attachShader: noop, linkProgram: noop, deleteShader: noop,
    getShaderParameter: () => true, getProgramParameter: () => true, getUniformLocation: () => null,
    bufferData: (_target: number, vertices: Float32Array) => uploads.push({ method: 'allocate', length: vertices.length }),
    bufferSubData: (_target: number, _offset: number, vertices: Float32Array) => uploads.push({ method: 'update', length: vertices.length }),
    drawArrays: () => { draws += 1; },
    deleteBuffer: () => { deletedBuffers += 1; },
    deleteVertexArray: () => { deletedVertexArrays += 1; },
    deleteProgram: () => { deletedPrograms += 1; },
  } as unknown as WebGL2RenderingContext;
  const map = { getZoom: () => zoom, triggerRepaint: noop } as unknown as MapLibreMap;
  const renderInput = {
    shaderData: { variantName: 'test-mercator', vertexShaderPrelude: '', define: '' },
    getProjectionData: () => ({ mainMatrix: [], fallbackMatrix: [], tileMercatorCoords: [], clippingPlane: [], projectionTransition: 0 }),
  } as unknown as CustomRenderMethodInput;
  const layer = new MigrationLayer();
  layer.onAdd(map, graphics);
  layer.render(graphics, renderInput);
  assert.deepEqual(uploads, [{ method: 'allocate', length: 0 }, { method: 'allocate', length: 0 }], 'An empty initial season still needs allocated GL storage.');
  uploads.length = 0;
  layer.setSeasonalDirection('northbound');
  layer.render(graphics, renderInput);
  assert.deepEqual(uploads.map((upload) => upload.method), ['allocate', 'allocate']);
  const firstBirdLength = uploads[1].length;
  uploads.length = 0;

  layer.render(graphics, renderInput);
  layer.setFrame(0);
  layer.render(graphics, renderInput);
  assert.equal(uploads.length, 0, 'Static repaints must draw the existing GPU meshes.');
  layer.setFrame(0.2);
  layer.render(graphics, renderInput);
  assert.deepEqual(uploads, [{ method: 'update', length: firstBirdLength }]);

  uploads.length = 0;
  layer.setRegionRoute(null, false);
  layer.setSeasonalDirection('northbound');
  layer.render(graphics, renderInput);
  assert.equal(uploads.length, 0, 'Same-season date changes must not rebuild routes or rewind birds.');
  zoom += 0.001;
  layer.render(graphics, renderInput);
  assert.equal(uploads.length, 2, 'Even a tiny zoom smoothly changes wind and bird geometry.');
  uploads.length = 0;
  zoom = 5;
  layer.render(graphics, renderInput);
  assert.equal(uploads.length, 2, 'Zoom changes both the wind radius and bird scale.');
  assert.ok(uploads.every((upload) => upload.method === 'update'));
  uploads.length = 0;
  layer.setRegionRoute([[-75, 40, 5000], [-74, 43, 10000], [-73, 45, 5000]], true);
  layer.render(graphics, renderInput);
  assert.ok(uploads.every((upload) => upload.method === 'allocate'));
  assert.equal(uploads[1].length, firstBirdLength / 4);

  layer.setRegionRoute(null, true);
  layer.render(graphics, renderInput);
  assert.deepEqual(uploads.slice(-2), [{ method: 'allocate', length: 0 }, { method: 'allocate', length: 0 }]);
  const drawsBeforeHiding = draws;
  layer.setVisible(false);
  layer.render(graphics, renderInput);
  assert.equal(draws, drawsBeforeHiding);
  layer.onRemove(map, graphics);
  assert.equal(deletedBuffers, 2);
  assert.equal(deletedVertexArrays, 2);
  assert.equal(deletedPrograms, 1);
});
