import type { BirdTickContext, EcologySnapshot, ObservationProperties, PointCollection, RelativeScenarioRange } from '../../../pipeline/contracts.ts';
import type { WeatherFrame } from './ecologyData.ts';

type EvidenceFrame = WeatherFrame | EcologySnapshot['frames'][number] | null | undefined;
export function questingValueWithinScope(properties: { questing_suitability: number | null; bird_tick_context?: BirdTickContext }): number | null {
  return properties.bird_tick_context?.supported_cohort === false ? null : properties.questing_suitability;
}
const mean = (values: number[]): number | null => values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
const availableNumbers = (values: (number | null | undefined)[]): number[] => values.filter((value): value is number => value != null);
function averageRanges(ranges: (RelativeScenarioRange | null)[]): RelativeScenarioRange | null {
  const available = ranges.filter((range): range is RelativeScenarioRange => range !== null);
  return available.length ? {
    lower: mean(available.map((range) => range.lower))!, central: mean(available.map((range) => range.central))!,
    upper: mean(available.map((range) => range.upper))!,
  } : null;
}

export function summarizeQuestingWeather(frame: EvidenceFrame) {
  const values = availableNumbers(frame?.weather_suitability.features.map((point) => questingValueWithinScope(point.properties)) ?? []);
  return { validWeatherLocationCount: values.length, averageSuitability: mean(values) };
}

export function summarizeObservations(collection: PointCollection<ObservationProperties>) {
  const records = collection.features;
  const dates = records.map((record) => record.properties.observed_date).filter(Boolean).sort();
  const speciesCounts = new Map<string, number>();
  for (const record of records) {
    const name = record.properties.scientific_name || record.properties.common_name || 'Unidentified species';
    speciesCounts.set(name, (speciesCounts.get(name) ?? 0) + 1);
  }
  const linkedRecords = records.filter((record) => {
    try { return ['https:', 'http:'].includes(new URL(record.properties.source_record_url).protocol); }
    catch { return false; }
  }).sort((first, second) => second.properties.observed_date.localeCompare(first.properties.observed_date)).slice(0, 6);
  return {
    recordCount: records.length, observedDateStart: dates[0] ?? null, observedDateEnd: dates.at(-1) ?? null,
    unknownLifeStageCount: records.filter((record) => record.properties.kind === 'tick' && !record.properties.life_stage).length,
    speciesGroups: [...speciesCounts].map(([name, recordCount]) => ({ name, recordCount }))
      .sort((first, second) => second.recordCount - first.recordCount || first.name.localeCompare(second.name)),
    linkedRecords,
  };
}

export function summarizeBirdTickContext(frame: EvidenceFrame) {
  const points = frame?.weather_suitability.features ?? [];
  const contexts = points.flatMap((point) => point.properties.bird_tick_context ? [point.properties.bird_tick_context] : []);
  const radarContexts = contexts.filter((context) => context.migration_pressure !== null);
  const habitatContexts = contexts.filter((context) => context.habitat.status === 'sampled');
  return {
    locationCount: points.length, contextLocationCount: contexts.length,
    supportedLocationCount: contexts.filter((context) => context.supported_cohort).length,
    radarCoverageCount: radarContexts.length,
    radarObservedDates: [...new Set(radarContexts.flatMap((context) => context.radar_observed_date ? [context.radar_observed_date] : []))].sort(),
    averageRadarPressure: mean(availableNumbers(radarContexts.map((context) => context.migration_pressure))),
    radarAgeDays: availableNumbers(radarContexts.map((context) => context.radar_age_days)),
    habitatSampledCount: habitatContexts.length,
    habitatYears: [...new Set(habitatContexts.map((context) => context.habitat.year))].sort(),
    averageStopoverWeather: mean(availableNumbers(contexts.map((context) => context.stopover_weather_factor))),
    stopoverCoverageCount: contexts.filter((context) => context.stopover_index !== null).length,
    averageStopoverIndex: mean(availableNumbers(contexts.map((context) => context.stopover_index))),
    depositionCoverageCount: contexts.filter((context) => context.deposition_potential !== null).length,
    averageDeposition: averageRanges(contexts.map((context) => context.deposition_potential)),
    averageDetachmentTiming: averageRanges(contexts.map((context) => context.detachment_timing_weight)),
    missingInputs: [...new Set(contexts.flatMap((context) => context.missing_inputs))].sort(),
    combinedActivityLocationCount: points.filter((point) => 'activity_components' in point.properties
      && point.properties.activity_components?.ecological_activity_index != null).length,
  };
}

export function validBirdTickContext(context: BirdTickContext): boolean {
  const unitOrNull = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1);
  const validRange = (range: RelativeScenarioRange | null) => range === null || (range !== undefined
    && [range.lower, range.central, range.upper].every((value) => value !== null && unitOrNull(value))
    && range.lower <= range.central && range.central <= range.upper);
  return context?.model_version === 'bird-tick-context-v1' && typeof context.supported_cohort === 'boolean'
    && [context.migration_pressure, context.stopover_weather_factor, context.stopover_index, context.post_drop_moisture_support].every(unitOrNull)
    && (context.radar_observed_date === null || /^\d{4}-\d{2}-\d{2}$/.test(context.radar_observed_date))
    && (context.radar_age_days === null || Number.isFinite(context.radar_age_days) && context.radar_age_days >= 0)
    && !!context.habitat && ['sampled', 'unavailable', 'not_covered'].includes(context.habitat.status)
    && unitOrNull(context.habitat.habitat_factor) && Number.isInteger(context.habitat.year) && context.habitat.year > 0
    && (context.habitat.land_cover_class === null || Number.isInteger(context.habitat.land_cover_class))
    && Array.isArray(context.detachment_window_days) && context.detachment_window_days.length === 2
    && context.detachment_window_days.every((value) => Number.isFinite(value) && value >= 0)
    && context.detachment_window_days[0] <= context.detachment_window_days[1]
    && [context.detachment_timing_weight, context.deposition_potential, context.post_drop_persistence_index].every(validRange)
    && (context.habitat.status === 'sampled' || context.stopover_index === null && context.deposition_potential === null)
    && context.contributes_to_current_questing === false && ['outside_forecast_model', 'unsupported'].includes(context.development_status)
    && Array.isArray(context.missing_inputs) && context.missing_inputs.every((input) => typeof input === 'string');
}
