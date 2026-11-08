import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEcologyMapData, buildStateHeatmap, interpolateStateActivity, loadEcologyAtlas, loadStateSnapshot, snapshotIsStale } from './ecologyData.ts';
import type { EcologyAtlasManifest, EcologyOverview, EcologySnapshot } from '../../../pipeline/contracts.ts';
import type { StateBoundaries } from './mapTypes.ts';

const generatedAt = '2026-11-08T06:00:00Z';
const date = '2026-11-08';
const manifest = { schema_version: 1, kind: 'ecology-atlas', model_version: 'vectorcast-heuristic-v1', generated_at: generatedAt,
  stale_after: '2026-11-08T18:00:00Z', dates: [date], overview_url: 'generation-example/overview.json',
  states: [{ state_code: 'NY', region_code: 'US-NY', snapshot_url: 'generation-example/US-NY.json' }] } as EcologyAtlasManifest;
const weatherPoint = (value: number | null, locationId = 'NY-1') => ({ type: 'Feature' as const, id: locationId,
  geometry: { type: 'Point' as const, coordinates: [-74, 42] as [number, number] }, properties: {
    location_id: locationId, name: locationId, valid_weather_hours: 24, is_experimental: true as const,
    state_code: 'NY', date, questing_suitability: value, questing_index_0_to_100: value === null ? null : value * 100,
  } });
const overview = { schema_version: 1, kind: 'ecology-overview', model_version: 'vectorcast-heuristic-v1', generated_at: generatedAt,
  stale_after: manifest.stale_after, scope: { region_code: 'US' }, sources: {
    weather: { status: 'available' }, birds: { status: 'partial' }, ticks: { status: 'available' } }, observations: {
    birds: { type: 'FeatureCollection', features: [] }, ticks: { type: 'FeatureCollection', features: [] } },
  frames: [{ date, outlook: 'near_term', weather_suitability: { type: 'FeatureCollection', features: [weatherPoint(0), weatherPoint(null, 'NY-2')] } }],
} as unknown as EcologyOverview;
const boundaries: StateBoundaries = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] },
  properties: { code: 'NY', name: 'New York', fips: '36', center: [-74, 42] } }] };

function fixtureRequest(documents: Record<string, unknown>, requestedUrls: string[] = []): typeof fetch {
  return (async (input) => { const url = String(input); requestedUrls.push(url);
    return new Response(JSON.stringify(documents[url] ?? {}), { status: url in documents ? 200 : 404 }); }) as typeof fetch;
}

test('loads relative generation URLs under the hosted application path', async () => {
  const urls: string[] = [];
  const atlas = await loadEcologyAtlas('https://example.test/app/data/ecology/latest.json', undefined, fixtureRequest({
    'https://example.test/app/data/ecology/latest.json': manifest,
    'https://example.test/app/data/ecology/generation-example/overview.json': overview,
  }, urls));
  assert.equal(atlas.overview.generated_at, generatedAt);
  assert.equal(urls[1], 'https://example.test/app/data/ecology/generation-example/overview.json');
});

test('fails explicitly on missing data and mixed overview generations', async () => {
  const url = 'https://example.test/latest.json';
  await assert.rejects(loadEcologyAtlas(url, undefined, fixtureRequest({})), /404/);
  await assert.rejects(loadEcologyAtlas(url, undefined, fixtureRequest({ [url]: manifest,
    'https://example.test/generation-example/overview.json': { ...overview, generated_at: '2026-11-07T06:00:00Z' },
  })), /generation/i);
});

test('rejects a state response from another state or forecast window', async () => {
  const atlas = { manifest, overview, manifestUrl: 'https://example.test/latest.json' };
  const stateUrl = 'https://example.test/generation-example/US-NY.json';
  const snapshot = { ...overview, scope: { region_code: 'US-NY' } } as unknown as EcologySnapshot;
  assert.equal((await loadStateSnapshot(atlas, 'NY', undefined, fixtureRequest({ [stateUrl]: snapshot }))).scope.region_code, 'US-NY');
  await assert.rejects(loadStateSnapshot(atlas, 'NY', undefined, fixtureRequest({ [stateUrl]: { ...snapshot, scope: { region_code: 'US-MA' } } })), /state/i);
  await assert.rejects(loadStateSnapshot(atlas, 'NY', undefined, fixtureRequest({ [stateUrl]: { ...snapshot, frames: [] } })), /date|forecast/i);
});

test('retains genuine zero suitability and withholds missing samples and state means', () => {
  const mapData = buildEcologyMapData(boundaries, overview.frames[0]);
  assert.equal(mapData.states.features[0].properties.questing_suitability, 0);
  assert.equal(mapData.states.features[0].geometry, boundaries.features[0].geometry);
  const unavailable = buildEcologyMapData(boundaries, { ...overview.frames[0], weather_suitability: { type: 'FeatureCollection', features: [] } });
  assert.equal(unavailable.states.features[0].properties.questing_suitability, null);
});

test('day transitions smoothly blend values and settle exactly at the actual next day', () => {
  const first = buildEcologyMapData(boundaries, overview.frames[0]).states;
  const next = buildEcologyMapData(boundaries, { ...overview.frames[0], weather_suitability: { type: 'FeatureCollection', features: [weatherPoint(0.02)] } }).states;
  const halfway = interpolateStateActivity(first, next, 0.5).features[0].properties;
  const linearHeight = (first.features[0].properties.display_height + next.features[0].properties.display_height) / 2;
  assert.equal(halfway.questing_suitability, 0.01);
  assert.ok(halfway.display_height > linearHeight);
  assert.ok(halfway.display_height - linearHeight <= 3500, 'settling movement stays subtle');
  assert.equal(interpolateStateActivity(first, next, 0), first);
  assert.equal(interpolateStateActivity(first, next, 1), next);
  assert.equal(first.features[0].properties.questing_suitability, 0);
});

test('rapid day changes continue from the displayed height and unknown values stay unknown', () => {
  const first = buildEcologyMapData(boundaries, overview.frames[0]).states;
  const next = buildEcologyMapData(boundaries, { ...overview.frames[0], weather_suitability: { type: 'FeatureCollection', features: [weatherPoint(0.03)] } }).states;
  const displayed = interpolateStateActivity(first, next, 0.4);
  assert.equal(interpolateStateActivity(displayed, first, 0), displayed);
  const unavailable = buildEcologyMapData(boundaries, null).states;
  assert.equal(interpolateStateActivity(unavailable, next, 0.5).features[0].properties.questing_suitability, null);
});

test('freshness expires at the source deadline, independent of publication time', () => {
  assert.equal(snapshotIsStale(manifest, new Date('2026-11-08T17:59:59Z')), false);
  assert.equal(snapshotIsStale(manifest, new Date('2026-11-08T18:00:00Z')), true);
  assert.equal(snapshotIsStale({ stale_after: 'invalid' }, new Date()), true);
});

test('local heatmap retains zero weather suitability, excludes missing inputs and withholds the bird composite', () => {
  const snapshot = { ...overview, scope: { region_code: 'US-NY' } } as unknown as EcologySnapshot;
  const heatmap = buildStateHeatmap(snapshot, date, 'NY');
  assert.equal(heatmap.model, 'weather_only');
  assert.equal(heatmap.points.features.length, 1);
  assert.equal(heatmap.points.features[0].properties.model_value, 0);
  assert.deepEqual(heatmap.points.features[0].geometry.coordinates, [-74, 42]);
  assert.equal(buildStateHeatmap(snapshot, date, 'MA').points.features.length, 0);
  assert.equal(buildStateHeatmap(snapshot, '2026-11-09', 'NY').points.features.length, 0);
});

test('local heatmap consumes the existing combined model only when its inputs actually produce values', () => {
  const snapshot = { ...overview, scope: { region_code: 'US-NY' }, frames: [{ ...overview.frames[0], weather_suitability: {
    type: 'FeatureCollection', features: [{ ...weatherPoint(0.8), properties: { ...weatherPoint(0.8).properties,
      activity_components: { ecological_activity_index: 0.3 } } }],
  } }] } as unknown as EcologySnapshot;
  const heatmap = buildStateHeatmap(snapshot, date, 'NY');
  assert.equal(heatmap.model, 'combined');
  assert.equal(heatmap.points.features[0].properties.model_value, 0.3);
});
