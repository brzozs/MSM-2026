import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Bird, Check, ChevronDown, Globe2, Layers2, MapPin, PanelLeftClose } from 'lucide-react';
import { layerDefinitions } from './data/mapTypes';
import type { StateBoundaries, VisibleLayers } from './data/mapTypes';
import { buildStateHeatmap, createForecastDays, loadEcologyAtlas, loadStateSnapshot, retainForecastDate, shouldLoadStateSnapshot, type LoadedAtlas, type StateSnapshotResult } from './data/ecologyData';
import { getSeasonalMigrationDirection } from './data/seasonalMigration';
import { migrationFlyways } from './data/migrationFlyways';
import { summarizeQuestingWeather } from './data/regionalEvidence';
import { tickSuitabilityColorStops } from './map/mapStyle';
import MapCanvas from './map/MapCanvas';
import StateFocus from './components/StateFocus';
import TimeBar from './components/TimeBar';
import StatePicker from './components/StatePicker';

export default function App() {
  const [stateBoundaries, setStateBoundaries] = useState<StateBoundaries | null>(null);
  const [geographyError, setGeographyError] = useState(false);
  const [visibleLayers, setVisibleLayers] = useState<VisibleLayers>({ bird_activity: true, tick_activity: true });
  const [selectedStateCode, setSelectedStateCode] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [atlas, setAtlas] = useState<LoadedAtlas | null>(null);
  const atlasRef = useRef<LoadedAtlas | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [stateResult, setStateResult] = useState<StateSnapshotResult | null>(null);
  const stateResultRef = useRef<StateSnapshotResult | null>(null);
  const [successfulAtlasRefreshCount, setSuccessfulAtlasRefreshCount] = useState(0);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [layerPanelOpen, setLayerPanelOpen] = useState(() => window.innerWidth > 760);
  const stateSelectorRef = useRef<HTMLButtonElement>(null);
  const layerPanelTriggerRef = useRef<HTMLButtonElement>(null);
  const days = useMemo(() => createForecastDays(atlas?.manifest.dates ?? [], currentTime), [atlas, currentTime]);
  const activeDate = selectedDate;
  const selectedDateUnavailable = activeDate !== null && atlas !== null && !atlas.manifest.dates.includes(activeDate);
  const currentStateResult = stateResult?.stateCode === selectedStateCode && stateResult?.generation === atlas?.manifest.generated_at ? stateResult : null;
  const stateSnapshot = currentStateResult?.snapshot ?? null;
  const weatherFrame = atlas?.overview.frames.find((frame) => frame.date === activeDate) ?? null;
  const localHeatmap = useMemo(() => stateSnapshot && activeDate && selectedStateCode ? buildStateHeatmap(stateSnapshot, activeDate, selectedStateCode) : null, [stateSnapshot, activeDate, selectedStateCode]);
  const questingWeather = useMemo(() => summarizeQuestingWeather(selectedStateCode
    ? stateSnapshot?.frames.find((frame) => frame.date === activeDate) : weatherFrame), [selectedStateCode, stateSnapshot, activeDate, weatherFrame]);
  const displayedModel = selectedStateCode ? localHeatmap?.model ?? 'unavailable' : questingWeather.averageSuitability === null ? 'unavailable' : 'weather_only';
  const tickModelDescription = displayedModel === 'weather_only' ? 'Questing weather index' : 'Index unavailable';
  const seasonalDirection = activeDate ? getSeasonalMigrationDirection(activeDate) : null;
  const migrationRouteSummary = seasonalDirection ? `Approximate corridors, not tracked birds.\n${migrationFlyways.map((flyway) =>
    `${flyway.species}: ${seasonalDirection === 'southbound' ? flyway.breedingRegion : flyway.winteringRegion} → ${seasonalDirection === 'southbound' ? flyway.winteringRegion : flyway.breedingRegion}`).join('\n')}` : 'No seasonal migration inferred for this date.';
  const states = useMemo(() => [...(stateBoundaries?.features ?? [])].sort((first, second) => first.properties.name.localeCompare(second.properties.name)), [stateBoundaries]);
  const selectedState = states.find((state) => state.properties.code === selectedStateCode)?.properties;

  useEffect(() => {
    const abortController = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/states.geojson`, { signal: abortController.signal })
      .then((response) => { if (!response.ok) throw new Error('Geography request failed'); return response.json() as Promise<StateBoundaries>; })
      .then(setStateBoundaries)
      .catch(() => { if (!abortController.signal.aborted) setGeographyError(true); });
    return () => abortController.abort();
  }, []);

  useEffect(() => {
    const abortController = new AbortController();
    let requestInProgress = false;
    async function refreshAtlas() {
      if (requestInProgress || document.hidden) return;
      requestInProgress = true;
      try {
        const manifestUrl = new URL(`${import.meta.env.BASE_URL}data/ecology/latest.json`, window.location.href).href;
        const latestAtlas = await loadEcologyAtlas(manifestUrl, abortController.signal, fetch, atlasRef.current ?? undefined);
        if (!abortController.signal.aborted) {
          atlasRef.current = latestAtlas; setAtlas(latestAtlas); setDataError(null);
          setSuccessfulAtlasRefreshCount((refreshCount) => refreshCount + 1);
          setSelectedDate((currentDate) => retainForecastDate(currentDate, latestAtlas.manifest.dates));
        }
      } catch (error) {
        if (!abortController.signal.aborted) setDataError(error instanceof Error ? error.message : 'Ecology data could not load.');
      } finally { requestInProgress = false; }
    }
    void refreshAtlas();
    const refreshInterval = window.setInterval(refreshAtlas, 5 * 60 * 1000);
    const clockInterval = window.setInterval(() => setCurrentTime(new Date()), 60000);
    window.addEventListener('focus', refreshAtlas);
    document.addEventListener('visibilitychange', refreshAtlas);
    return () => { abortController.abort(); window.clearInterval(refreshInterval); window.clearInterval(clockInterval);
      window.removeEventListener('focus', refreshAtlas); document.removeEventListener('visibilitychange', refreshAtlas); };
  }, []);

  useEffect(() => {
    if (!atlas || !selectedStateCode || !shouldLoadStateSnapshot(stateResultRef.current, selectedStateCode, atlas.manifest.generated_at)) return;
    const abortController = new AbortController();
    const stateCode = selectedStateCode;
    const generation = atlas.manifest.generated_at;
    loadStateSnapshot(atlas, stateCode, abortController.signal)
      .then((snapshot) => { if (!abortController.signal.aborted) {
        const result = { stateCode, generation, snapshot };
        stateResultRef.current = result; setStateResult(result);
      } })
      .catch(async (error) => {
        if (abortController.signal.aborted) return;
        if (error instanceof Error && error.message.includes('(404)')) {
          try {
            const latestAtlas = await loadEcologyAtlas(atlas.manifestUrl, abortController.signal, fetch, atlas);
            if (abortController.signal.aborted) return;
            if (latestAtlas.manifest.generated_at !== generation) { atlasRef.current = latestAtlas; setAtlas(latestAtlas); return; }
          } catch { if (abortController.signal.aborted) return; }
        }
        const result = { stateCode, generation, error: error instanceof Error ? error.message : 'State data could not load.' };
        stateResultRef.current = result; setStateResult(result);
      });
    return () => abortController.abort();
  }, [atlas, selectedStateCode, successfulAtlasRefreshCount]);

  function toggleLayer(layerId: keyof VisibleLayers) {
    setVisibleLayers((currentLayers) => ({ ...currentLayers, [layerId]: !currentLayers[layerId] }));
  }

  function leaveStateFocus() {
    setSelectedStateCode(null);
    if (!layerPanelOpen) layerPanelTriggerRef.current?.focus();
    else stateSelectorRef.current?.focus();
  }

  return <main className={`app-shell ${selectedState ? 'state-is-focused' : ''}`}>
    <h1 className="sr-only">VectorCast ecological map</h1>
    <a className="skip-link" href="#state-selector">Choose a region</a>
    {stateBoundaries && <MapCanvas stateBoundaries={stateBoundaries} selectedStateCode={selectedStateCode} selectedDate={selectedDate} weatherFrame={weatherFrame} stateSnapshot={stateSnapshot} visibleLayers={visibleLayers} onSelectState={setSelectedStateCode} />}
    {geographyError && <div className="map-loading" role="alert">The map boundaries could not load. Refresh the page to try again.</div>}
    <div className="map-vignette" />

    <header className="app-header">
      <a className="wordmark" href={import.meta.env.BASE_URL} aria-label="VectorCast home"><Bird size={30} strokeWidth={1.4} /><span>VectorCast<small>Ecological early warning</small></span></a>
      {!selectedState && <div className="header-location"><Globe2 size={15} /><span>United States</span><span className="header-divider" />National overview</div>}
    </header>

    {(!atlas || dataError || selectedDateUnavailable) && <p className="ecology-data-status" role={dataError ? 'alert' : 'status'}>
      {dataError ? `${dataError} ${atlas ? 'Showing the last loaded dataset.' : 'Publish the collected dataset to display source data.'}` : !atlas ? 'Loading published ecology data…' : ''}
      {selectedDateUnavailable && ` The selected date, ${activeDate}, is no longer in the published forecast. Choose a date below.`}
    </p>}


    <button ref={layerPanelTriggerRef} className="layer-panel-trigger" aria-hidden={layerPanelOpen} inert={layerPanelOpen} aria-expanded={layerPanelOpen} aria-controls="map-layers" onClick={() => { setLayerPanelOpen(true); requestAnimationFrame(() => stateSelectorRef.current?.focus()); }}><Layers2 size={16} />Map layers<ChevronDown size={14} /></button>
    <aside className="layer-panel" aria-hidden={!layerPanelOpen} inert={!layerPanelOpen} id="map-layers" aria-label="Map layers and region selection">
      <div className="layer-panel-heading"><h2>Explore the map</h2><button className="layer-panel-close icon-button" aria-label="Minimize Explore the map" title="Minimize Explore the map" onClick={() => { setLayerPanelOpen(false); requestAnimationFrame(() => layerPanelTriggerRef.current?.focus()); }}><PanelLeftClose size={17} /></button></div>
      <StatePicker states={states.map((state) => state.properties)} selectedStateCode={selectedStateCode} selectorButtonRef={stateSelectorRef} onSelectState={(stateCode) => { setSelectedStateCode(stateCode); if (window.innerWidth <= 760) setLayerPanelOpen(false); }} />
      <div className="layer-section-label"><span>Layers</span><span>Source data</span></div>
      <div className="layer-options">
        {layerDefinitions.map((layer) => <label className={`layer-option ${visibleLayers[layer.id] ? 'layer-is-active' : ''}`} key={layer.id}>
          <input type="checkbox" checked={visibleLayers[layer.id]} onChange={() => toggleLayer(layer.id)} aria-label={layer.label} />
          <span className="layer-checkbox" style={{ '--layer-color': layer.color } as CSSProperties}><Check size={12} strokeWidth={2.5} /></span>
          <span className="layer-copy"><strong>{layer.label}</strong><small>{layer.description}</small></span>
        </label>)}
      </div>
      <div className="panel-note"><MapPin size={14} /><p>Select a state to explore its regional evidence.</p></div>
    </aside>

    <div className="map-legend" aria-label="Map legend">
      {visibleLayers.tick_activity && <><span className="legend-title">{selectedState ? 'Local tick suitability' : 'Modeled tick suitability'}</span><div className="legend-ramp" style={{ background: `linear-gradient(90deg, ${tickSuitabilityColorStops.map(({ value, color }) => `${color} ${value * 100}%`).join(', ')})` }} /><div className="legend-labels"><span>Lower</span><span>Higher</span></div><span className="legend-state-height">{selectedState ? `${tickModelDescription} · smoothed${stateSnapshot?.scope.sampling_spacing_km ? ` ${stateSnapshot.scope.sampling_spacing_km} km grid` : ' reference grid'}` : `${tickModelDescription} · higher suitability = taller states${atlas?.overview.sources.weather.predicted_location_count ? ' · includes spatial estimates' : ''}`}</span>
      </>}
      {visibleLayers.bird_activity && <div className="legend-flyway legend-wind" style={{ pointerEvents: 'auto' }} title={migrationRouteSummary}><span aria-hidden="true">{seasonalDirection ? '↝' : '—'}</span>{seasonalDirection ? 'Approximate migration routes' : 'Seasonal direction not inferred'}</div>}
    </div>

    {days.length > 0 && <TimeBar days={days} selectedDate={selectedDate} onSelectDate={setSelectedDate} />}
    {selectedState && <StateFocus selectedState={selectedState} selectedDate={activeDate} snapshot={stateSnapshot} error={currentStateResult?.error ?? null} onBack={leaveStateFocus} />}

  </main>;
}
