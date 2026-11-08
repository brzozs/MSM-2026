import type { FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson';
import type { EcologyAtlasManifest, EcologyOverview, EcologySnapshot } from '../../../pipeline/contracts.ts';
import type { StateBoundaries, StateProperties } from './mapTypes.ts';
import type { TimelineDay } from './mapFrames.ts';

export type WeatherFrame = EcologyOverview['frames'][number];
export interface LoadedAtlas { manifest: EcologyAtlasManifest; overview: EcologyOverview; manifestUrl: string }
export interface StateHeatmap {
  model: 'weather_only' | 'combined' | 'unavailable';
  points: FeatureCollection<Point, { model_value: number }>;
}
export type EcologyStateFrame = FeatureCollection<Polygon | MultiPolygon, StateProperties & {
  questing_suitability: number | null; display_height: number;
}>;
const baseStateHeightMeters = 45000;
const stateHeightRangeMeters = 275000;

async function requestDocument(url: string, signal: AbortSignal | undefined, request: typeof fetch): Promise<unknown> {
  const response = await request(url, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`Ecology data request failed (${response.status}).`);
  return response.json();
}

function generationUrl(relativeUrl: string, manifestUrl: string): string {
  const resolvedUrl = new URL(relativeUrl, manifestUrl);
  if (resolvedUrl.origin !== new URL(manifestUrl).origin) throw new Error('Ecology data must use the published origin.');
  return resolvedUrl.href;
}

function validMetadata(document: EcologyAtlasManifest | EcologyOverview | EcologySnapshot) {
  return document?.schema_version === 1 && document.model_version === 'vectorcast-heuristic-v1'
    && Number.isFinite(Date.parse(document.generated_at)) && Number.isFinite(Date.parse(document.stale_after));
}

function validateSnapshot(document: EcologyOverview | EcologySnapshot, manifest: EcologyAtlasManifest) {
  if (!validMetadata(document) || document.generated_at !== manifest.generated_at || document.stale_after !== manifest.stale_after) {
    throw new Error('Ecology snapshot generation does not match its manifest.');
  }
  if (!Array.isArray(document.frames) || JSON.stringify(document.frames.map((frame) => frame.date)) !== JSON.stringify(manifest.dates)) {
    throw new Error('Ecology snapshot forecast dates do not match its manifest.');
  }
  if (!document.scope || !document.sources || !['weather', 'birds', 'ticks'].every((key) => key in document.sources)
    || !Array.isArray(document.observations?.birds?.features) || !Array.isArray(document.observations?.ticks?.features)) {
    throw new Error('Ecology snapshot is missing source or observation data.');
  }
  for (const frame of document.frames) {
    if (!Array.isArray(frame.weather_suitability?.features)) throw new Error('Ecology snapshot has invalid weather data.');
    for (const point of frame.weather_suitability.features) {
      const value = point.properties?.questing_suitability;
      const coordinates = point.geometry?.coordinates;
      if (!point.properties?.location_id || (value !== null && (!Number.isFinite(value) || value < 0 || value > 1))
        || point.geometry.type !== 'Point' || coordinates?.length !== 2 || !coordinates.every(Number.isFinite)) {
        throw new Error('Ecology snapshot has an invalid weather sample.');
      }
    }
  }
}

export async function loadEcologyAtlas(manifestUrl: string, signal?: AbortSignal, request: typeof fetch = fetch, previous?: LoadedAtlas): Promise<LoadedAtlas> {
  const manifest = await requestDocument(manifestUrl, signal, request) as EcologyAtlasManifest;
  if (!validMetadata(manifest) || manifest.kind !== 'ecology-atlas' || !Array.isArray(manifest.states) || !manifest.states.length
    || !Array.isArray(manifest.dates) || !manifest.dates.length || manifest.dates.length > 7
    || manifest.dates.some((date, index) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || (index > 0 && date <= manifest.dates[index - 1]))
    || typeof manifest.overview_url !== 'string') throw new Error('Invalid ecology manifest.');
  if (previous?.manifestUrl === manifestUrl && JSON.stringify(previous.manifest) === JSON.stringify(manifest)) return previous;
  const overview = await requestDocument(generationUrl(manifest.overview_url, manifestUrl), signal, request) as EcologyOverview;
  validateSnapshot(overview, manifest);
  if (overview.kind !== 'ecology-overview') throw new Error('Invalid ecology overview.');
  return { manifest, overview, manifestUrl };
}

export async function loadStateSnapshot(atlas: LoadedAtlas, stateCode: string, signal?: AbortSignal, request: typeof fetch = fetch): Promise<EcologySnapshot> {
  const stateEntry = atlas.manifest.states.find((state) => state.state_code === stateCode);
  if (!stateEntry) throw new Error('This state has no published snapshot.');
  const snapshot = await requestDocument(generationUrl(stateEntry.snapshot_url, atlas.manifestUrl), signal, request) as EcologySnapshot;
  validateSnapshot(snapshot, atlas.manifest);
  if (snapshot.scope.region_code !== stateEntry.region_code) throw new Error('Ecology snapshot belongs to another state.');
  return snapshot;
}

export function snapshotIsStale(snapshot: { stale_after: string }, now = new Date()): boolean {
  const deadline = Date.parse(snapshot.stale_after);
  return !Number.isFinite(deadline) || now.getTime() >= deadline;
}

export function createForecastDays(dates: string[], now = new Date()): TimelineDay[] {
  return dates.map((date) => ({ date, weekday: new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)),
    dayOfMonth: date.slice(-2), isToday: date === now.toISOString().slice(0, 10) }));
}

export function buildStateHeatmap(snapshot: EcologySnapshot | null, forecastDate: string, stateCode: string): StateHeatmap {
  const empty: StateHeatmap = { model: 'unavailable', points: { type: 'FeatureCollection', features: [] } };
  if (!snapshot || snapshot.scope.region_code !== `US-${stateCode}`) return empty;
  const frame = snapshot.frames.find((candidate) => candidate.date === forecastDate);
  if (!frame?.weather_suitability.features.length) return empty;
  const combinedAvailable = frame.weather_suitability.features.every((point) => point.properties.activity_components?.ecological_activity_index != null);
  const points: StateHeatmap['points'] = { type: 'FeatureCollection', features: frame.weather_suitability.features.flatMap((point) => {
    const value = combinedAvailable ? point.properties.activity_components.ecological_activity_index : point.properties.questing_suitability;
    if (value === null) return [];
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Heatmap values must be finite model values between zero and one.');
    return [{ type: 'Feature' as const, id: point.id, geometry: point.geometry, properties: { model_value: value } }];
  }) };
  return { model: points.features.length ? combinedAvailable ? 'combined' : 'weather_only' : 'unavailable', points };
}

export function interpolateStateActivity(previous: EcologyStateFrame, next: EcologyStateFrame, progress: number): EcologyStateFrame {
  if (progress <= 0) return previous;
  if (progress >= 1) return next;
  const easedProgress = progress * progress * (3 - 2 * progress);
  const settlingEnvelope = Math.sin(progress * Math.PI) ** 2;
  const previousStates = new Map(previous.features.map((state) => [state.properties.code, state.properties]));
  return { type: 'FeatureCollection', features: next.features.map((state) => {
    const previousState = previousStates.get(state.properties.code);
    if (!previousState || previousState.questing_suitability === null || state.properties.questing_suitability === null) {
      return { ...state, properties: { ...state.properties, questing_suitability: null,
        display_height: previousState?.display_height ?? baseStateHeightMeters } };
    }
    const target = state.properties;
    const subtleLiftMeters = Math.min(3500, target.display_height * 0.012) * settlingEnvelope;
    return { ...state, properties: { ...target,
      questing_suitability: previousState.questing_suitability + (target.questing_suitability! - previousState.questing_suitability) * easedProgress,
      display_height: previousState.display_height + (target.display_height - previousState.display_height) * easedProgress + subtleLiftMeters,
    } };
  }) };
}

export function buildEcologyMapData(boundaries: StateBoundaries, frame: WeatherFrame | null): { states: EcologyStateFrame } {
  const stateValues = new Map<string, { total: number; count: number }>();
  for (const point of frame?.weather_suitability.features ?? []) {
    const value = point.properties.questing_suitability;
    if (value === null) continue;
    const stateCode = point.properties.state_code;
    const summary = stateValues.get(stateCode) ?? { total: 0, count: 0 };
    summary.total += value; summary.count += 1; stateValues.set(stateCode, summary);
  }
  const states: EcologyStateFrame = { type: 'FeatureCollection', features: boundaries.features.map((state) => {
    const summary = stateValues.get(state.properties.code);
    const value = summary ? summary.total / summary.count : null;
    return { ...state, properties: { ...state.properties, questing_suitability: value,
      display_height: baseStateHeightMeters + (value ?? 0) * stateHeightRangeMeters } };
  }) };
  return { states };
}
