import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';

export interface StateProperties { code: string; name: string; fips: string; center: [number, number] }
export type StateBoundaries = FeatureCollection<Polygon | MultiPolygon, StateProperties>;
export type VisibleLayers = Record<'bird_activity' | 'tick_activity', boolean>;

export const layerDefinitions: { id: keyof VisibleLayers; label: string; description: string; color: string }[] = [
  { id: 'bird_activity', label: 'Bird migration', description: 'Seasonal flight illustration', color: '#ccdbaf' },
  { id: 'tick_activity', label: 'Tick activity', description: 'Questing weather index', color: '#e8b66e' },
];
