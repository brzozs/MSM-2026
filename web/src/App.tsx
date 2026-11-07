import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Bird, Check, ChevronDown, Globe2, Info, Layers2, MapPin, PanelLeftClose, Search, X } from 'lucide-react';
import type { EcologicalLayerId } from './data/contracts';
import { layerDefinitions } from './data/mapTypes';
import type { StateBoundaries, VisibleLayers } from './data/mapTypes';
import { createTimelineDays } from './data/mapFrames';
import MapCanvas from './map/MapCanvas';
import StateFocus from './components/StateFocus';
import TimeBar from './components/TimeBar';

export default function App() {
  const [stateBoundaries, setStateBoundaries] = useState<StateBoundaries | null>(null);
  const [geographyError, setGeographyError] = useState(false);
  const [visibleLayers, setVisibleLayers] = useState<VisibleLayers>({ bird_activity: true, tick_activity: true, pathogen_evidence: false, community_exposure: false });
  const [selectedStateCode, setSelectedStateCode] = useState<string | null>(null);
  const [selectedDayIndex, setSelectedDayIndex] = useState(3);
  const [mobileLayersOpen, setMobileLayersOpen] = useState(false);
  const [aboutPreviewOpen, setAboutPreviewOpen] = useState(false);
  const stateSelectorRef = useRef<HTMLSelectElement>(null);
  const mobileLayerTriggerRef = useRef<HTMLButtonElement>(null);
  const days = useMemo(() => createTimelineDays(new Date()), []);
  const states = useMemo(() => [...(stateBoundaries?.features ?? [])].sort((first, second) => first.properties.name.localeCompare(second.properties.name)), [stateBoundaries]);
  const selectedState = states.find((state) => state.properties.code === selectedStateCode)?.properties;

  useEffect(() => {
    const abortController = new AbortController();
    fetch('/data/states.geojson', { signal: abortController.signal })
      .then((response) => { if (!response.ok) throw new Error('Geography request failed'); return response.json() as Promise<StateBoundaries>; })
      .then(setStateBoundaries)
      .catch(() => { if (!abortController.signal.aborted) setGeographyError(true); });
    return () => abortController.abort();
  }, []);

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
    {stateBoundaries && <MapCanvas stateBoundaries={stateBoundaries} selectedStateCode={selectedStateCode} selectedDayIndex={selectedDayIndex} visibleLayers={visibleLayers} onSelectState={setSelectedStateCode} />}
    {geographyError && <div className="map-loading" role="alert">The map boundaries could not load. Refresh the page to try again.</div>}
    <div className="map-vignette" />

    <header className="app-header">
      <a className="wordmark" href="/" aria-label="VectorCast home"><Bird size={30} strokeWidth={1.4} /><span>VectorCast<small>Ecological early warning</small></span></a>
      {!selectedState && <div className="header-location"><Globe2 size={15} /><span>United States</span><span className="header-divider" />National overview</div>}
      <button className="sample-badge" aria-expanded={aboutPreviewOpen} onClick={() => setAboutPreviewOpen(!aboutPreviewOpen)}><span className="status-dot" />Sample visualization<Info size={14} /></button>
    </header>

    {aboutPreviewOpen && <aside className="preview-popover" aria-label="About this preview"><button className="icon-button" aria-label="Close preview information" onClick={() => setAboutPreviewOpen(false)}><X size={16} /></button><h2>Real geography. Sample activity.</h2><p>Taller, brighter states show higher sample tick activity for the selected day. The raised birds and wind trails illustrate northbound migration, with exaggerated height. These are not observed tracks or measured wind. Live observations, contributing weather factors and health risk are not connected yet.</p></aside>}

    <button ref={mobileLayerTriggerRef} className="mobile-layer-trigger" aria-expanded={mobileLayersOpen} aria-controls="map-layers" onClick={() => setMobileLayersOpen(!mobileLayersOpen)}><Layers2 size={16} />Map layers<ChevronDown size={14} /></button>
    <aside className={`layer-panel ${mobileLayersOpen ? 'layer-panel-is-open' : ''}`} id="map-layers" aria-label="Map layers and region selection">
      <div className="layer-panel-heading"><h2>Explore the map</h2><button className="mobile-panel-close icon-button" aria-label="Close map layers" onClick={() => setMobileLayersOpen(false)}><PanelLeftClose size={17} /></button></div>
      <label className="state-selector" htmlFor="state-selector"><Search size={15} /><select id="state-selector" ref={stateSelectorRef} aria-label="Choose a state" value={selectedStateCode ?? ''} onChange={(event) => { setSelectedStateCode(event.target.value || null); setMobileLayersOpen(false); }}><option value="">Choose a state</option>{states.map((state) => <option key={state.properties.code} value={state.properties.code}>{state.properties.name}</option>)}</select><ChevronDown size={13} /></label>
      <div className="layer-section-label"><span>Layers</span><span>Preview</span></div>
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
      {visibleLayers.tick_activity && <><span className="legend-title">{selectedState ? 'Sample regional activity' : 'Sample tick activity'}</span><div className="legend-ramp" /><div className="legend-labels"><span>Lower</span><span>Higher</span></div><span className="legend-state-height">{selectedState ? 'County borders · Zoom for towns' : 'Glow follows state height'}</span></>}
      {visibleLayers.bird_activity && <div className="legend-flyway legend-wind"><span aria-hidden="true">↑</span>Northbound sample wind</div>}
      {visibleLayers.pathogen_evidence && <div className="legend-flyway legend-coverage"><span />Coverage preview</div>}
      {visibleLayers.community_exposure && <div className="legend-flyway legend-community"><span />Community layer preview</div>}
    </div>

    <TimeBar days={days} selectedDayIndex={selectedDayIndex} onSelectDay={setSelectedDayIndex} />
    {selectedState && <StateFocus selectedState={selectedState} selectedDate={days[selectedDayIndex].date} onBack={leaveStateFocus} />}
  </main>;
}
