import assert from 'node:assert/strict';
import test from 'node:test';
import { createMapStyle } from '../map/mapStyle.ts';

test('national map starts without outline overlays or point dots and retains text labels', () => {
  const style = createMapStyle({ type: 'FeatureCollection', features: [] }, '/');
  assert.equal(style.layers.some((layer) => (layer.type === 'circle' && layer.layout?.visibility !== 'none') || layer.id === 'bird-reports' || layer.id === 'tick-reports'), false);
  for (const layer of style.layers.filter((layer) => layer.id === 'selected-state-outline' || layer.id.startsWith('surrounding-state-') || layer.id.startsWith('local-') || ('source' in layer && layer.source === 'regional-boundaries'))) {
    assert.equal(layer.layout?.visibility, 'none', layer.id);
  }
  assert.equal(style.layers.some((layer) => layer.id === 'state-outlines'), false);
  const countyNames = style.layers.find((layer) => layer.id === 'county-labels');
  assert.ok(countyNames?.type === 'symbol');
  assert.ok(countyNames.layout?.['text-field']);
  assert.equal(countyNames.layout?.['icon-image'], undefined);
});

test('county borders are thicker than city and town borders', () => {
  const style = createMapStyle({ type: 'FeatureCollection', features: [] }, '/');
  const county = style.layers.find((layer) => layer.id === 'regional-county-borders');
  const city = style.layers.find((layer) => layer.id === 'regional-town-borders');
  assert.ok(county?.type === 'line' && city?.type === 'line');
  assert.ok(Number(county.paint?.['line-width']) >= Number(city.paint?.['line-width']) * 2);
});
