import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { EcologicalLayerId } from './contracts';

export interface StateProperties { code: string; name: string; fips: string; center: [number, number] }
export type StateBoundaries = FeatureCollection<Polygon | MultiPolygon, StateProperties>;
export type VisibleLayers = Record<EcologicalLayerId, boolean>;

export const layerDefinitions: { id: EcologicalLayerId; label: string; description: string; color: string }[] = [
  { id: 'bird_activity', label: 'Bird migration', description: 'Northbound flocks + wind', color: '#ccdbaf' },
  { id: 'tick_activity', label: 'Tick activity', description: 'Sample activity surface', color: '#e8b66e' },
  { id: 'pathogen_evidence', label: 'Pathogen context', description: 'Coverage preview', color: '#c3a6a1' },
  { id: 'community_exposure', label: 'Community exposure', description: 'Layer preview', color: '#94b4bd' },
];
