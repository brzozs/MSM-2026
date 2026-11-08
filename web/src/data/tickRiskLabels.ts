import type { FeatureCollection, Point } from 'geojson';
import { buildDemoFrame, sampleTickActivityAtCoordinate } from './mapFrames.ts';
import type { StateActivityFrame } from './mapFrames';

export interface CountyLabelProperties { geoid: string; name: string; state_fips: string }
export type CountyLabelPoints = FeatureCollection<Point, CountyLabelProperties>;
export interface TickRiskLabelProperties {
  geoid: string;
  name: string;
  sample_risk_percent: number;
  display_height: number;
  is_example: true;
}
export type TickRiskLabels = FeatureCollection<Point, TickRiskLabelProperties>;

// These percentages are display indices of synthetic activity, not infection
// probabilities, measured infestation or an epidemiological risk model.
export function buildTickRiskLabels(states: StateActivityFrame, counties: CountyLabelPoints, selectedDayIndex: number, selectedStateCode: string | null) {
  const observations = buildDemoFrame(selectedDayIndex).observations.features;
  const statesByFips = new Map(states.features.map((state) => [state.properties.fips, state]));
  const labelProperties = (name: string, activity: number, displayHeight: number, geoid: string): TickRiskLabelProperties => {
    const percentage = Math.round(activity * 100);
    return { geoid, name, sample_risk_percent: percentage,
      display_height: displayHeight, is_example: true };
  };
  const stateLabels: TickRiskLabels = { type: 'FeatureCollection', features: states.features.map((state) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: state.properties.center },
    properties: labelProperties(state.properties.code, state.properties.sample_tick_activity, selectedStateCode ? 4000 : state.properties.display_height + 4000, state.properties.fips),
  })) };
  const countyLabels: TickRiskLabels = { type: 'FeatureCollection', features: counties.features.flatMap((county) => {
    const state = statesByFips.get(county.properties.state_fips);
    if (!state) throw new Error(`County ${county.properties.geoid} has no matching state.`);
    if (selectedStateCode && state.properties.code !== selectedStateCode) return [];
    return [{ type: 'Feature' as const, geometry: county.geometry,
      properties: labelProperties(county.properties.name, sampleTickActivityAtCoordinate(county.geometry.coordinates, observations),
        selectedStateCode ? 20 : state.properties.display_height + 4000, county.properties.geoid) }];
  }) };
  return { states: stateLabels, counties: countyLabels };
}

export function buildRegionalLabelSource(counties: TickRiskLabels, regionalBoundaries: FeatureCollection | null): FeatureCollection {
  return { type: 'FeatureCollection', features: [
    ...counties.features.map((county) => ({ ...county, properties: { ...county.properties, kind: 'county' } })),
    ...(regionalBoundaries?.features.filter((feature) => feature.properties?.kind !== 'county') ?? []),
  ] };
}
