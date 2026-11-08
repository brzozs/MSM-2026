export type DataAvailability =
  | 'fresh'
  | 'stale'
  | 'unavailable'
  | 'insufficient_data'
  | 'not_applicable';

export type EcologicalLayerId =
  | 'bird_activity'
  | 'tick_activity'
  | 'pathogen_evidence'
  | 'community_exposure';

export interface MetricValue {
  readonly value: number | null;
  readonly status: DataAvailability;
  readonly reason_codes: readonly string[];
  readonly source_refs: readonly string[];
}

export interface LayerSummary {
  readonly layer_id: EcologicalLayerId;
  readonly label: string;
  readonly metric: MetricValue;
}

// A small view model for the starter, not the full published snapshot schema.
export interface RegionOverview {
  readonly region_id: string;
  readonly region_name: string;
  readonly is_example: boolean;
  readonly layers: readonly LayerSummary[];
}
