import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Bird, Check, ChevronDown, Globe2, Info, Layers2, MapPin, PanelLeftClose, X } from 'lucide-react';
import type { EcologicalLayerId } from './data/contracts';
import { layerDefinitions } from './data/mapTypes';
import type { StateBoundaries, VisibleLayers } from './data/mapTypes';
import { buildStateHeatmap, createForecastDays, loadEcologyAtlas, loadStateSnapshot, snapshotIsStale, type LoadedAtlas } from './data/ecologyData';
import type { EcologySnapshot } from '../../pipeline/contracts';
import { getSeasonalMigrationDirection, seasonalMigrationSources } from './data/seasonalMigration';
import { tickSuitabilityColorStops } from './map/mapStyle';
import MapCanvas from './map/MapCanvas';
import StateFocus from './components/StateFocus';
import TimeBar from './components/TimeBar';
import StatePicker from './components/StatePicker';

export default function App() {
  const [stateBoundaries, setStateBoundaries] = useState<StateBoundaries | null>(null);
  const [geographyError, setGeographyError] = useState(false);
  const [visibleLayers, setVisibleLayers] = useState<VisibleLayers>({ bird_activity: true, tick_activity: true, pathogen_evidence: false, community_exposure: false });
  const [selectedStateCode, setSelectedStateCode] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [atlas, setAtlas] = useState<LoadedAtlas | null>(null);
  const atlasRef = useRef<LoadedAtlas | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [stateResult, setStateResult] = useState<{ stateCode: string; generation: string; snapshot?: EcologySnapshot; error?: string } | null>(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [mobileLayersOpen, setMobileLayersOpen] = useState(false);
  const [aboutPreviewOpen, setAboutPreviewOpen] = useState(false);
  const stateSelectorRef = useRef<HTMLButtonElement>(null);
  const mobileLayerTriggerRef = useRef<HTMLButtonElement>(null);
  const days = useMemo(() => createForecastDays(atlas?.manifest.dates ?? [], currentTime), [atlas, currentTime]);
  const selectedDayIndex = Math.max(0, days.findIndex((day) => day.date === selectedDate));
  const activeDate = days[selectedDayIndex]?.date ?? null;
  const currentStateResult = stateResult?.stateCode === selectedStateCode && stateResult?.generation === atlas?.manifest.generated_at ? stateResult : null;
  const stateSnapshot = currentStateResult?.snapshot ?? null;
  const weatherFrame = atlas?.overview.frames.find((frame) => frame.date === activeDate) ?? null;
  const localHeatmap = useMemo(() => stateSnapshot && activeDate && selectedStateCode ? buildStateHeatmap(stateSnapshot, activeDate, selectedStateCode) : null, [stateSnapshot, activeDate, selectedStateCode]);
  const seasonalDirection = activeDate ? getSeasonalMigrationDirection(activeDate) : null;
  const isStale = atlas ? snapshotIsStale(atlas.manifest, currentTime) : false;
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
        if (!abortController.signal.aborted) { atlasRef.current = latestAtlas; setAtlas(latestAtlas); setDataError(null); }
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
    if (!atlas || !selectedStateCode) return;
    const abortController = new AbortController();
    const stateCode = selectedStateCode;
    const generation = atlas.manifest.generated_at;
    loadStateSnapshot(atlas, stateCode, abortController.signal)
      .then((snapshot) => { if (!abortController.signal.aborted) setStateResult({ stateCode, generation, snapshot }); })
      .catch(async (error) => {
        if (abortController.signal.aborted) return;
        if (error instanceof Error && error.message.includes('(404)')) {
          try {
            const latestAtlas = await loadEcologyAtlas(atlas.manifestUrl, abortController.signal, fetch, atlas);
            if (abortController.signal.aborted) return;
            if (latestAtlas.manifest.generated_at !== generation) { atlasRef.current = latestAtlas; setAtlas(latestAtlas); return; }
          } catch { if (abortController.signal.aborted) return; }
        }
        setStateResult({ stateCode, generation, error: error instanceof Error ? error.message : 'State data could not load.' });
      });
    return () => abortController.abort();
  }, [atlas, selectedStateCode]);

  function toggleLayer(layerId: EcologicalLayerId) {
    setVisibleLayers((currentLayers) => ({ ...currentLayers, [layerId]: !currentLayers[layerId] }));
  }

  function leaveStateFocus() {
    setSelectedStateCode(null);
    if (window.innerWidth <= 760) mobileLayerTriggerRef.current?.focus();
    else stateSelectorRef.current?.focus();
  }

  return <main className={`app-shell ${selectedState ? 'state-is-focused' : ''}`}>
    <h1 className="sr-only">VectorCast ecological map</h1>
    <a className="skip-link" href="#state-selector">Choose a region</a>
    {stateBoundaries && <MapCanvas stateBoundaries={stateBoundaries} selectedStateCode={selectedStateCode} weatherFrame={weatherFrame} stateSnapshot={stateSnapshot} visibleLayers={visibleLayers} onSelectState={setSelectedStateCode} />}
    {geographyError && <div className="map-loading" role="alert">The map boundaries could not load. Refresh the page to try again.</div>}
    <div className="map-vignette" />

    <header className="app-header">
      <a className="wordmark" href={import.meta.env.BASE_URL} aria-label="VectorCast home"><Bird size={30} strokeWidth={1.4} /><span>VectorCast<small>Ecological early warning</small></span></a>
      {!selectedState && <div className="header-location"><Globe2 size={15} /><span>United States</span><span className="header-divider" />National overview</div>}
      <button className="sample-badge" aria-expanded={aboutPreviewOpen} onClick={() => setAboutPreviewOpen(!aboutPreviewOpen)}><span className="status-dot" />{!atlas ? (dataError ? 'Data unavailable' : 'Loading data…') : <>{isStale ? 'Stale' : 'Updated'} <time dateTime={atlas.manifest.generated_at}>{new Date(atlas.manifest.generated_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time></>}<Info size={14} /></button>
    </header>

    {aboutPreviewOpen && <aside className="preview-popover" aria-label="About the data"><button className="icon-button" aria-label="Close data information" onClick={() => setAboutPreviewOpen(false)}><X size={16} /></button><h2>Live sources. Seasonal flight guide.</h2><p>State height, color and local heatmap show experimental tick suitability from soil temperature, humidity, moisture and vapor pressure deficit. A bird/weather composite is withheld until complete bird/tick reporting windows and habitat data are available. The flocks follow broad seasonal guidance: northbound in spring, southbound in fall. They are not measured tracks or species-specific flyways. Measured bird directions are not connected; the trails are illustrative, not forecast wind. Select a state for sighting counts and weather details.</p>
      {atlas && <p>Collected {new Date(atlas.manifest.generated_at).toLocaleString()}. {atlas.overview.observations.birds.features.length.toLocaleString()} bird reports ({atlas.overview.sources.birds.status}) · {atlas.overview.observations.ticks.features.length} tick reports ({atlas.overview.sources.ticks.status}). Forecast days change weather; report locations stay fixed. The local heatmap blends coarse reference estimates within 1.5 grid spacings; missing reference areas stay blank. Suitability is not tick density or infection risk.</p>}
      <p>Seasonal guidance: {seasonalMigrationSources.map((source, index) => <span key={source.url}>{index > 0 && ' · '}<a href={source.url} target="_blank" rel="noreferrer">{source.label}</a></span>)}</p>
      <p><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo · CC BY 4.0</a> · <a href="https://www.birds.cornell.edu/home/ebird-api-terms-of-use/" target="_blank" rel="noreferrer">eBird / Cornell terms</a> · <a href="https://www.inaturalist.org/" target="_blank" rel="noreferrer">iNaturalist contributors</a>.</p></aside>}
    {(!atlas || dataError || isStale) && <p className="ecology-data-status" role={dataError ? 'alert' : 'status'}>{dataError ? `${dataError} ${atlas ? 'Showing the last loaded dataset.' : 'Publish the collected dataset to display source data.'}` : !atlas ? 'Loading published ecology data…' : 'Weather inputs are stale. Showing the last successful collection.'}</p>}


    <button ref={mobileLayerTriggerRef} className="mobile-layer-trigger" aria-expanded={mobileLayersOpen} aria-controls="map-layers" onClick={() => setMobileLayersOpen(!mobileLayersOpen)}><Layers2 size={16} />Map layers<ChevronDown size={14} /></button>
    <aside className={`layer-panel ${mobileLayersOpen ? 'layer-panel-is-open' : ''}`} id="map-layers" aria-label="Map layers and region selection">
      <div className="layer-panel-heading"><h2>Explore the map</h2><button className="mobile-panel-close icon-button" aria-label="Close map layers" onClick={() => setMobileLayersOpen(false)}><PanelLeftClose size={17} /></button></div>
      <StatePicker states={states.map((state) => state.properties)} selectedStateCode={selectedStateCode} selectorButtonRef={stateSelectorRef} onSelectState={(stateCode) => { setSelectedStateCode(stateCode); setMobileLayersOpen(false); }} />
      <div className="layer-section-label"><span>Layers</span><span>Source data</span></div>
      <div className="layer-options">
        {layerDefinitions.map((layer) => <label className={`layer-option ${visibleLayers[layer.id] ? 'layer-is-active' : ''}`} key={layer.id}>
          <input type="checkbox" disabled={layer.id === 'pathogen_evidence' || layer.id === 'community_exposure'} checked={visibleLayers[layer.id]} onChange={() => toggleLayer(layer.id)} aria-label={layer.label} />
          <span className="layer-checkbox" style={{ '--layer-color': layer.color } as CSSProperties}><Check size={12} strokeWidth={2.5} /></span>
          <span className="layer-copy"><strong>{layer.label}</strong><small>{layer.description}</small></span>
        </label>)}
      </div>
      <div className="panel-note"><MapPin size={14} /><p>Select a state to explore its regional evidence.</p></div>
    </aside>

    <div className="map-legend" aria-label="Map legend">
      {visibleLayers.tick_activity && <><span className="legend-title">{selectedState ? 'Local tick suitability' : 'Modeled tick suitability'}</span><div className="legend-ramp" style={{ background: `linear-gradient(90deg, ${tickSuitabilityColorStops.map(({ value, color }) => `${color} ${value * 100}%`).join(', ')})` }} /><div className="legend-labels"><span>Lower</span><span>Higher</span></div><span className="legend-state-height">{selectedState ? `${localHeatmap?.model === 'combined' ? 'Bird + weather model' : localHeatmap?.model === 'weather_only' ? 'Weather-only estimate' : 'Local estimate unavailable'} · smoothed${stateSnapshot?.scope.sampling_spacing_km ? ` ${stateSnapshot.scope.sampling_spacing_km} km grid` : ' reference grid'}` : 'Higher suitability = taller states'}</span></>}
      {visibleLayers.bird_activity && <div className="legend-flyway legend-wind"><span aria-hidden="true">{seasonalDirection === 'southbound' ? '↓' : seasonalDirection === 'northbound' ? '↑' : '—'}</span>{seasonalDirection ? `Seasonal ${seasonalDirection} guide` : 'Seasonal direction not inferred'}</div>}
    </div>

    {days.length > 0 && <TimeBar days={days} selectedDayIndex={selectedDayIndex} onSelectDay={(dayIndex) => setSelectedDate(days[dayIndex].date)} />}
    {selectedState && <StateFocus selectedState={selectedState} selectedDate={activeDate} snapshot={stateSnapshot} error={currentStateResult?.error ?? null} onBack={leaveStateFocus} />}

  </main>;
}
