import { useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapLibreMap, GeoJSONSource, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Focus, Minus, Plus } from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { StateBoundaries, VisibleLayers } from '../data/mapTypes';
import { buildDemoFrame, buildStateActivityFrame } from '../data/mapFrames';
import { createMapStyle, createStateColorExpression, createStateHeightExpression } from './mapStyle';
import { MigrationLayer } from './MigrationLayer';
import { buildRegionalPreview, getStateBounds } from '../data/regionFocus';
import { buildElevatedActivity } from '../data/activityGlow';
import { createActivityGlowImage } from './activityGlowImage';

setWorkerUrl(workerUrl);

interface MapCanvasProps {
  stateBoundaries: StateBoundaries;
  selectedStateCode: string | null;
  selectedDayIndex: number;
  visibleLayers: VisibleLayers;
  onSelectState: (stateCode: string | null) => void;
}

export default function MapCanvas({ stateBoundaries, selectedStateCode, selectedDayIndex, visibleLayers, onSelectState }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const selectedDayRef = useRef(selectedDayIndex);
  const selectStateRef = useRef(onSelectState);
  const migrationLayerRef = useRef<MigrationLayer | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [boundaryStatus, setBoundaryStatus] = useState<string | null>(null);
  const selectedState = useMemo(() => stateBoundaries.features.find((state) => state.properties.code === selectedStateCode), [stateBoundaries, selectedStateCode]);
  const regionalPreview = useMemo(() => selectedState ? buildRegionalPreview(selectedState, selectedDayIndex) : null, [selectedState, selectedDayIndex]);

  useEffect(() => { selectedDayRef.current = selectedDayIndex; }, [selectedDayIndex]);
  useEffect(() => { selectStateRef.current = onSelectState; }, [onSelectState]);

  useEffect(() => {
    if (!containerRef.current) return;
    setMapReady(false);
    let map: MapLibreMap;
    let disposed = false;
    try {
      map = new MapLibreMap({
        container: containerRef.current,
        style: createMapStyle(stateBoundaries),
        center: [-97, 37.7], zoom: 3.7, pitch: 52, bearing: -12,
        minZoom: 1.2, maxZoom: 10, maxPitch: 65,
        dragRotate: { around: 'center', movement: 'linear' }, dragPan: true, scrollZoom: true,
        pitchWithRotate: true, pitchSpeed: -0.35, rotateSpeed: 0.4,
        attributionControl: { compact: true },
        canvasContextAttributes: { antialias: true },
      });
      mapRef.current = map;
    } catch {
      setMapError('The interactive map needs WebGL. You can still choose a state to explore the preview.');
      return;
    }
    map.setMissingStyleImageResolver((imageId) => {
      if (imageId === 'activity-glow' && !map.hasImage('activity-glow')) map.addImage('activity-glow', createActivityGlowImage(), { pixelRatio: 2 });
    });
    map.on('load', () => {
      if (disposed) return;
      const migrationLayer = new MigrationLayer();
      migrationLayerRef.current = migrationLayer;
      map.addLayer(migrationLayer);
      setMapReady(true);
    });
    const visibleStateLayer = () => map.getLayoutProperty('states-raised', 'visibility') === 'none' ? 'states' : 'states-raised';
    map.on('click', (event) => {
      if (!map.isStyleLoaded()) return;
      const stateCode = map.queryRenderedFeatures(event.point, { layers: [visibleStateLayer()] })[0]?.properties.code;
      if (typeof stateCode === 'string') selectStateRef.current(stateCode);
    });
    map.on('mousemove', (event) => { if (map.isStyleLoaded()) map.getCanvas().style.cursor = map.queryRenderedFeatures(event.point, { layers: [visibleStateLayer()] }).length ? 'pointer' : ''; });
    map.on('mouseout', () => { map.getCanvas().style.cursor = ''; });
    map.on('webglcontextlost', () => {
      if (!disposed) setMapError('The map lost its graphics connection. Reload to restore it, or choose a state to preview.');
    });
    map.on('error', (event) => {
      if (!disposed && event.error.message.includes('countries.geojson')) setMapError('The base map could not load. Refresh the page to try again.');
    });
    return () => { disposed = true; mapRef.current = null; migrationLayerRef.current = null; map.remove(); };
  }, [stateBoundaries]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const stateActivity = buildStateActivityFrame(stateBoundaries, selectedDayIndex);
    (map.getSource('sample-activity') as GeoJSONSource).setData(regionalPreview?.hotspots ?? buildElevatedActivity(stateActivity, buildDemoFrame(selectedDayIndex).observations));
    (map.getSource('states') as GeoJSONSource).setData(stateActivity);
    migrationLayerRef.current?.setRegionRoute(regionalPreview?.migrationRoute ?? null, !!selectedState);
    migrationLayerRef.current?.setFrame(0, selectedDayIndex);
  }, [mapReady, selectedDayIndex, stateBoundaries, selectedState, regionalPreview]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource('regional-boundaries') as GeoJSONSource;
    source.setData({ type: 'FeatureCollection', features: [] });
    if (!selectedState) { setBoundaryStatus(null); return; }
    const abortController = new AbortController();
    setBoundaryStatus('Loading county and town boundaries…');
    fetch(`/data/regions/${selectedState.properties.fips}.geojson`, { signal: abortController.signal })
      .then((response) => { if (!response.ok) throw new Error('Regional geography request failed.'); return response.json(); })
      .then((data) => {
        if (abortController.signal.aborted) return;
        if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Invalid regional geography.');
        source.setData(data);
        setBoundaryStatus(null);
      })
      .catch(() => { if (!abortController.signal.aborted) setBoundaryStatus('County and town boundaries could not load. Refresh to retry.'); });
    return () => abortController.abort();
  }, [mapReady, selectedState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const layerGroups = {
      bird_activity: [],
      tick_activity: ['tick-activity-glow'], pathogen_evidence: ['pathogen-context'], community_exposure: [],
    };
    for (const [layerId, mapLayerIds] of Object.entries(layerGroups)) {
      for (const mapLayerId of mapLayerIds) {
        if (map.getLayer(mapLayerId)) map.setLayoutProperty(mapLayerId, 'visibility', visibleLayers[layerId as keyof VisibleLayers] ? 'visible' : 'none');
      }
    }
    migrationLayerRef.current?.setVisible(visibleLayers.bird_activity);
    const nationalColors = createStateColorExpression(visibleLayers.tick_activity, visibleLayers.community_exposure);
    map.setPaintProperty('states-raised', 'fill-extrusion-color', selectedState
      ? ['case', ['==', ['get', 'code'], selectedStateCode], '#344b35', '#1d3026'] : nationalColors);
    map.setPaintProperty('states', 'fill-color', selectedState ? ['case', ['==', ['get', 'code'], selectedStateCode], '#344b35', '#1d3026'] : '#465b3f');
    map.setLayoutProperty('states-raised', 'visibility', selectedState ? 'none' : 'visible');
    map.setPaintProperty('states-raised', 'fill-extrusion-height', regionalPreview?.platformHeightMeters ?? createStateHeightExpression(visibleLayers.tick_activity));
    map.setPaintProperty('land', 'fill-color', selectedState ? '#172820' : '#293e31');
    map.setPaintProperty('state-outlines', 'line-opacity', selectedState ? 0.12 : 0.35);
    map.setLayoutProperty('tick-activity-glow', 'icon-size', selectedState ? 0.85 : 0.95);
    map.setLayoutProperty('state-labels', 'visibility', selectedState ? 'none' : 'visible');
    map.setLayoutProperty('state-labels', 'symbol-height-offset', ['+', createStateHeightExpression(visibleLayers.tick_activity), 4000]);
    map.setFilter('pathogen-context', selectedState ? ['==', ['get', 'code'], selectedStateCode] : ['in', ['get', 'code'], ['literal', ['NY', 'PA', 'MA', 'CT', 'WI', 'MN']]]);
    map.setFilter('selected-state-outline', ['==', ['get', 'code'], selectedStateCode ?? '']);
  }, [mapReady, visibleLayers, selectedStateCode, selectedState, regionalPreview]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (selectedState) {
      map.fitBounds(getStateBounds(selectedState), {
        absolutePadding: true, maxZoom: 10, pitch: 42, bearing: -12,
        padding: map.getContainer().clientWidth > 760
          ? { top: 175, bottom: 195, left: 300, right: 75 } : { top: 190, bottom: 210, left: 36, right: 36 },
        duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1300,
      });
    } else fitNationalView(map);
  }, [mapReady, selectedState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !visibleLayers.bird_activity) return;
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animationFrameId = 0;
    let lastUpdate = 0;
    const startTime = performance.now();
    const animateBirds = (timestamp: number) => {
      if (document.hidden || motionPreference.matches) return;
      if (timestamp - lastUpdate > 33) {
        const elapsedSeconds = (timestamp - startTime) / 1000;
        migrationLayerRef.current?.setFrame(elapsedSeconds, selectedDayRef.current);
        lastUpdate = timestamp;
      }
      animationFrameId = requestAnimationFrame(animateBirds);
    };
    const resumeAnimation = () => {
      cancelAnimationFrame(animationFrameId);
      if (motionPreference.matches) migrationLayerRef.current?.setFrame(0, selectedDayRef.current);
      else if (!document.hidden) animationFrameId = requestAnimationFrame(animateBirds);
    };
    resumeAnimation();
    document.addEventListener('visibilitychange', resumeAnimation);
    motionPreference.addEventListener('change', resumeAnimation);
    return () => { cancelAnimationFrame(animationFrameId); document.removeEventListener('visibilitychange', resumeAnimation); motionPreference.removeEventListener('change', resumeAnimation); };
  }, [mapReady, visibleLayers.bird_activity]);

  function resetView() {
    onSelectState(null);
    if (!selectedStateCode && mapRef.current) fitNationalView(mapRef.current);
  }

  return <>
    <div className="map-canvas" ref={containerRef} aria-label="Interactive ecological map of the United States" />
    <p className="map-drag-hint">Right-drag to tilt + rotate<br /><span>Left-drag to pan · Scroll to zoom</span></p>
    {!mapReady && !mapError && <div className="map-loading" role="status">Preparing your map…</div>}
    {mapError && <div className="map-fallback"><img src="/data/us-states-preview.svg" alt="United States state boundaries" /><p role="status">{mapError}</p></div>}
    {selectedState && boundaryStatus && <p className="regional-geography-status" role="status">{boundaryStatus}</p>}
    <div className="map-navigation" aria-label="Map navigation">
      <button aria-label="Zoom in" disabled={!mapReady || !!mapError} onClick={() => mapRef.current?.zoomIn()}><Plus size={18} /></button>
      <button aria-label="Zoom out" disabled={!mapReady || !!mapError} onClick={() => mapRef.current?.zoomOut()}><Minus size={18} /></button>
      <button aria-label="Reset to United States" disabled={!mapReady || !!mapError} onClick={resetView}><Focus size={18} /></button>
    </div>
  </>;
}

function fitNationalView(map: MapLibreMap) {
  const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650;
  map.fitBounds([[-126, 24], [-66, 50]], {
    absolutePadding: true,
    padding: window.innerWidth > 760 ? { top: 120, bottom: 140, left: 280, right: 65 } : { top: 140, bottom: 155, left: 24, right: 24 },
    pitch: 52, bearing: -12, duration,
  });
}
