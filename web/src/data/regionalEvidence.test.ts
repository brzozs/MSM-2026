import assert from 'node:assert/strict';
import test from 'node:test';
import type { BirdTickContext, EcologySnapshot, ObservationProperties, PointFeature, SuitabilityProperties } from '../../../pipeline/contracts.ts';
import { summarizeBirdTickContext, summarizeObservations, summarizeQuestingWeather, validBirdTickContext } from './regionalEvidence.ts';

const context: BirdTickContext = {
  model_version: 'bird-tick-context-v1', supported_cohort: true, migration_pressure: 0.6,
  radar_observed_date: '2026-11-07', radar_age_days: 1, stopover_weather_factor: 0.4,
  habitat: { status: 'sampled', land_cover_class: 41, habitat_factor: 0.8, year: 2025 }, stopover_index: 0.2,
  detachment_window_days: [3, 6], detachment_timing_weight: { lower: 0, central: 0.1, upper: 0.2 },
  deposition_potential: { lower: 0, central: 0.02, upper: 0.04 }, post_drop_moisture_support: null,
  post_drop_persistence_index: null, contributes_to_current_questing: false, development_status: 'outside_forecast_model',
  missing_inputs: ['post_drop_leaf_litter_microclimate'],
};
const frameWith = (properties: Partial<SuitabilityProperties>[]): EcologySnapshot['frames'][number] => ({
  date: '2026-11-08', outlook: 'near_term', weather_suitability: { type: 'FeatureCollection', features: properties.map((properties, index) => ({
    type: 'Feature', id: String(index), geometry: { type: 'Point', coordinates: [-74, 42] }, properties: properties as SuitabilityProperties,
  })) },
});
const observation = (id: string, properties: Partial<ObservationProperties>): PointFeature<ObservationProperties> => ({
  type: 'Feature', id, geometry: { type: 'Point', coordinates: [-74, 42] }, properties: {
    source: 'inaturalist', kind: 'tick', observed_date: '2026-10-01', observed_at: null, scientific_name: 'Ixodes scapularis',
    source_record_url: `https://www.inaturalist.org/observations/${id}`, attribution: 'Observer', license: 'CC BY',
    coordinate_uncertainty_meters: null, ...properties,
  },
});

test('weather summary ignores legacy radar and separate combined activity, retains zero and excludes null', () => {
  const summary = summarizeQuestingWeather(frameWith([
    { questing_suitability: 0.4, tick_prediction_index: 0.45, activity_components: { ecological_activity_index: 0.9 } as SuitabilityProperties['activity_components'] },
    { questing_suitability: 0 }, { questing_suitability: null },
  ]));
  assert.equal(summary.averageSuitability, 0.2);
  assert.equal(summary.validWeatherLocationCount, 2);
  assert.equal(summarizeQuestingWeather(null).averageSuitability, null);
});

test('regional questing mean withholds unsupported geography while retaining legacy source values', () => {
  const summary = summarizeQuestingWeather(frameWith([
    { questing_suitability: 0.8, bird_tick_context: { ...context, supported_cohort: false } },
    { questing_suitability: 0.2 }, { questing_suitability: 0 },
  ]));
  assert.equal(summary.averageSuitability, 0.1);
  assert.equal(summary.validWeatherLocationCount, 2);
});

test('regional observations count reports rather than individuals and preserve unknown tick stages', () => {
  const summary = summarizeObservations({ type: 'FeatureCollection', features: [
    observation('1', { individual_count: 500 }),
    observation('2', { life_stage: 'nymph', observed_date: '2026-11-01' }),
    observation('3', { scientific_name: null, observed_date: '2026-09-28' }),
  ] });
  assert.equal(summary.recordCount, 3);
  assert.equal(summary.observedDateStart, '2026-09-28');
  assert.equal(summary.observedDateEnd, '2026-11-01');
  assert.equal(summary.unknownLifeStageCount, 2);
  assert.deepEqual(summary.speciesGroups, [{ name: 'Ixodes scapularis', recordCount: 2 }, { name: 'Unidentified species', recordCount: 1 }]);
  assert.equal(summary.linkedRecords[0].id, '2');
});

test('linked evidence is capped and unsafe source URLs are omitted without changing report totals', () => {
  const summary = summarizeObservations({ type: 'FeatureCollection', features: Array.from({ length: 9 }, (_, index) =>
    observation(String(index), { source_record_url: index === 0 ? 'javascript:alert(1)' : `https://example.test/${index}` })) });
  assert.equal(summary.recordCount, 9);
  assert.equal(summary.linkedRecords.length, 6);
  assert.ok(summary.linkedRecords.every((record) => record.properties.source_record_url.startsWith('https://')));
  assert.equal(summarizeObservations({ type: 'FeatureCollection', features: [] }).observedDateStart, null);
});

test('connected summary keeps radar and habitat coverage separate and averages scenarios only where available', () => {
  const summary = summarizeBirdTickContext(frameWith([
    { bird_tick_context: context },
    { bird_tick_context: { ...context, habitat: { ...context.habitat, status: 'unavailable', habitat_factor: null }, stopover_index: null, deposition_potential: null } },
    { bird_tick_context: { ...context, supported_cohort: false, migration_pressure: null, radar_observed_date: null, habitat: { ...context.habitat, status: 'not_covered', habitat_factor: null }, stopover_index: null, deposition_potential: null } },
    {},
  ]));
  assert.equal(summary.locationCount, 4);
  assert.equal(summary.radarCoverageCount, 2);
  assert.equal(summary.supportedLocationCount, 2);
  assert.equal(summary.habitatSampledCount, 1);
  assert.equal(summary.depositionCoverageCount, 1);
  assert.deepEqual(summary.averageDeposition, { lower: 0, central: 0.02, upper: 0.04 });
  assert.equal(summary.averageStopoverIndex, 0.2);
  assert.deepEqual(summary.radarObservedDates, ['2026-11-07']);
  assert.deepEqual(summary.habitatYears, [2025]);
  assert.equal(summary.missingInputs[0], 'post_drop_leaf_litter_microclimate');
  assert.equal(summarizeBirdTickContext(null).averageDeposition, null);
});

test('connected evidence rejects nonfinite, reversed and out-of-range scenarios while retaining null and zero', () => {
  assert.equal(validBirdTickContext(context), true);
  for (const deposition_potential of [
    { lower: 0.4, central: 0.2, upper: 0.5 }, { lower: 0, central: 1.2, upper: 1.2 },
    { lower: 0, central: Number.NaN, upper: 1 }, { lower: -0.1, central: 0.2, upper: 0.3 },
  ]) assert.equal(validBirdTickContext({ ...context, deposition_potential }), false);
  assert.equal(validBirdTickContext({ ...context, habitat: { ...context.habitat, status: 'unavailable' } }), false);
});
