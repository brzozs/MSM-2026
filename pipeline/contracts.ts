/** Public batch output. No provider credentials belong in this contract. */
export interface PointFeature<Properties> {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: Properties;
}

export interface PointCollection<Properties> {
  type: 'FeatureCollection';
  features: PointFeature<Properties>[];
}

export interface SourceStatus {
  source_forecast_location_count?: number;
  predicted_location_count?: number;
  prediction_note?: string;
  provider: 'open_meteo' | 'ebird' | 'inaturalist' | 'birdcast';
  status: 'available' | 'partial' | 'unavailable' | 'not_configured';
  request_started_at?: string;
  retrieved_at: string;
  request_completed_at?: string;
  data_retrieved_at?: string;
  cache_hit_batches?: number;
  batches_fetched?: number;
  /** Weather only: UTC forecast window pinned once at run start (YYYY-MM-DD). */
  forecast_start_date?: string;
  forecast_end_date?: string;
  window_complete?: boolean;
  displayed_record_count?: number;
  source_query_eligible_record_count?: number;
  unassigned_observation_count?: number;
  reported_total?: number | null;
  exclusions?: Record<string, number>;
  errors?: string[];
  attribution?: string;
  terms_url?: string;
  [additionalProvenanceField: string]: unknown;
}

export interface ObservationProperties {
  source: 'ebird' | 'inaturalist';
  kind: 'bird' | 'tick';
  source_record_url: string;
  attribution: string;
  license: string;
  scientific_name: string | null;
  observed_date: string;
  observed_at: string | null;
  coordinate_uncertainty_meters: number | null;
  species_code?: string;
  common_name?: string | null;
  individual_count?: number | null;
  observed_local?: string;
  time_zone?: string | null;
  taxon_id?: number;
  life_stage?: string | null;
  is_measured_movement?: false;
}

export interface WeatherConditions {
  time: string;
  soil_temperature_c: number | null;
  soil_moisture_fraction: number | null;
  relative_humidity_percent: number | null;
  vapour_pressure_deficit_kpa: number | null;
  air_temperature_c: number | null;
  precipitation_mm: number | null;
  low_cloud_cover_percent: number | null;
  wind_speed_meters_per_second: number | null;
  wind_from_direction_degrees: number | null;
  is_day: 0 | 1 | null;
}

export interface ActivityComponents {
  questing_suitability: number | null;
  avian_activity_proxy: number | null;
  tick_reporting_intensity: number | null;
  stopover_potential: number | null;
  ecological_activity_index: number | null;
  missing_inputs: string[];
}

export interface SuitabilityProperties {
  tick_prediction_index?: number | null;
  migration_adjustment_status?: 'measured' | 'unavailable';
  is_predicted?: boolean;
  prediction_method?: 'four_neighbor_inverse_distance_v1';
  prediction_nearest_distance_km?: number;
  prediction_source_location_ids?: string[];
  location_id: string;
  name: string;
  state_code?: string;
  state_fips?: string;
  sampling_spacing_km?: number;
  sampling_is_fallback?: boolean;
  requested_latitude: number;
  requested_longitude: number;
  weather_grid_distance_meters: number;
  date: string;
  questing_suitability: number | null;
  questing_index_0_to_100: number | null;
  valid_weather_hours: number;
  questing_trigger_hours: number;
  stopover_weather_proxy: number | null;
  conditions_at_peak: WeatherConditions | null;
  factors_at_peak: {
    temperature_factor: number | null;
    humidity_factor: number | null;
    vapour_pressure_deficit_factor: number | null;
    soil_moisture_factor: number | null;
    questing_suitability: number | null;
    example_questing_trigger: boolean | null;
    missing_inputs: string[];
  } | null;
  activity_components: ActivityComponents;
  missing_inputs: string[];
  is_experimental: true;
}

export interface EcologySnapshot {
  schema_version: 1;
  model_version: 'vectorcast-heuristic-v1';
  generated_at: string;
  stale_after: string;
  scope: {
    region_code: string;
    weather_location_count: number;
    weather_coverage: string;
    state_codes: string[];
    sampling_spacing_km: number | null;
    maximum_interpolation_distance_meters: number;
    weather_bounds: [number, number, number, number];
  };
  semantics: Record<string, string>;
  sources: { weather: SourceStatus; birds: SourceStatus; ticks: SourceStatus; migration?: SourceStatus & { observed_date: string; valid_radar_count: number; maximum_support_km: number } };
  observations: {
    birds: PointCollection<ObservationProperties>;
    ticks: PointCollection<ObservationProperties>;
  };
  frames: {
    date: string;
    outlook: 'near_term' | 'lower_confidence';
    weather_suitability: PointCollection<SuitabilityProperties>;
  }[];
  unavailable_layers: { id: string; reason: string }[];
}

export interface EcologyAtlasManifest {
  schema_version: 1;
  kind: 'ecology-atlas';
  model_version: 'vectorcast-heuristic-v1';
  generated_at: string;
  stale_after: string;
  state_count: 51;
  weather_location_count: number;
  sampling_spacing_km: number;
  dates: string[];
  overview_url: string;
  states: {
    region_code: string;
    state_code: string;
    state_fips: string;
    name: string;
    snapshot_url: string;
    weather_location_count: number;
    available_forecast_values: number;
  }[];
}

export type OverviewSuitabilityProperties = Pick<SuitabilityProperties,
  'location_id' | 'name' | 'date' | 'questing_suitability' | 'questing_index_0_to_100' | 'valid_weather_hours' | 'is_experimental'> & {
  state_code: string;
  tick_prediction_index?: number | null;
  migration_adjustment_status?: 'measured' | 'unavailable';
  is_predicted?: boolean;
  prediction_nearest_distance_km?: number;
};

export interface EcologyOverview extends Omit<EcologySnapshot, 'frames'> {
  kind: 'ecology-overview';
  frames: {
    date: string;
    outlook: 'near_term' | 'lower_confidence';
    weather_suitability: PointCollection<OverviewSuitabilityProperties>;
  }[];
}
