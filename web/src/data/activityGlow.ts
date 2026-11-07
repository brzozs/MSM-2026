import type { FeatureCollection, Point } from 'geojson';
import type { DemoPointProperties, StateActivityFrame } from './mapFrames';
import { getStateBounds, stateContainsCoordinate } from './regionFocus.ts';

export interface ActivityGlowProperties extends DemoPointProperties { display_height: number }
export type ActivityGlowFrame = FeatureCollection<Point, ActivityGlowProperties>;

export function buildElevatedActivity(states: StateActivityFrame, observations: FeatureCollection<Point, DemoPointProperties>): ActivityGlowFrame {
  const boundaries = states.features.map((state) => ({ state, bounds: getStateBounds(state) }));
  return { type: 'FeatureCollection', features: observations.features.filter((_, index) => index % 4 === 0).flatMap((observation) => {
    const containing = boundaries.find(({ state, bounds }) => stateContainsCoordinate(state, observation.geometry.coordinates, bounds));
    if (!containing) return [];
    const roofHeight = containing.state.properties.display_height;
    return [{ ...observation, properties: { ...observation.properties,
      display_height: roofHeight + Math.max(20, Math.min(2000, roofHeight * 0.025)) } }];
  }) };
}
