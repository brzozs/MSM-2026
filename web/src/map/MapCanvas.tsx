import { useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, GeoJSONSource, setWorkerUrl } from 'maplibre-gl';
import type { ExpressionSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Focus, Minus, Plus } from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { MapViewMode, StateBoundaries, VisibleLayers } from '../data/mapTypes';
import { buildDemoFrame, getBirdFeatures } from '../data/mapFrames';
import { createMapStyle } from './mapStyle';

setWorkerUrl(workerUrl);

interface MapCanvasProps {
  stateBoundaries: StateBoundaries;
  selectedStateCode: string | null;
  selectedDayIndex: number;
  visibleLayers: VisibleLayers;
  viewMode: MapViewMode;
  onSelectState: (stateCode: string | null) => void;
}

export default function MapCanvas({ stateBoundaries, selectedStateCode, selectedDayIndex, visibleLayers, viewMode, onSelectState }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const selectedDayRef = useRef(selectedDayIndex);
  const selectStateRef = useRef(onSelectState);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => { selectedDayRef.current = selectedDayIndex; }, [selectedDayIndex]);
  useEffect(() => { selectStateRef.current = onSelectState; }, [onSelectState]);

  useEffect(() => {
    if (!containerRef.current) return;
    let map: MapLibreMap;
    let disposed = false;
    try {
      map = new MapLibreMap({
        container: containerRef.current,
        style: createMapStyle(stateBoundaries),
        center: [-97, 37.7], zoom: 3.7, pitch: 42, bearing: -12,
        minZoom: 1.2, maxZoom: 10, maxPitch: 65,
        attributionControl: { compact: true },
        canvasContextAttributes: { antialias: true },
      });
      mapRef.current = map;
    } catch {
      setMapError('The interactive map needs WebGL. You can still choose a state to explore the preview.');
      return;
    }
    map.on('load', () => {
      if (disposed) return;
      const birdCanvas = document.createElement('canvas');
      birdCanvas.width = 40; birdCanvas.height = 40;
      const drawingContext = birdCanvas.getContext('2d');
      if (drawingContext) {
        drawingContext.fillStyle = '#e8edce';
        drawingContext.beginPath();
        drawingContext.moveTo(20, 7); drawingContext.lineTo(24, 18);
        drawingContext.lineTo(37, 25); drawingContext.lineTo(23, 23);
        drawingContext.lineTo(20, 32); drawingContext.lineTo(17, 23);
        drawingContext.lineTo(3, 25); drawingContext.lineTo(16, 18);
        drawingContext.closePath(); drawingContext.fill();
        map.addImage('preview-bird', drawingContext.getImageData(0, 0, 40, 40), { pixelRatio: 2 });
        map.addLayer({ id: 'migration-birds', type: 'symbol', source: 'sample-birds', layout: { 'icon-image': 'preview-bird', 'icon-size': 0.8, 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true } });
      }
      setMapReady(true);
    });
    map.on('click', 'states', (event) => {
      const stateCode = event.features?.[0]?.properties.code;
      if (typeof stateCode === 'string') selectStateRef.current(stateCode);
    });
    map.on('mouseenter', 'states', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'states', () => { map.getCanvas().style.cursor = ''; });
    map.on('webglcontextlost', () => {
      if (!disposed) setMapError('The map lost its graphics connection. Reload to restore it, or choose a state to preview.');
    });
    map.on('error', (event) => {
      if (!disposed && event.error.message.includes('countries.geojson')) setMapError('The base map could not load. Refresh the page to try again.');
    });
    return () => { disposed = true; mapRef.current = null; map.remove(); };
  }, [stateBoundaries]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    (map.getSource('sample-activity') as GeoJSONSource).setData(buildDemoFrame(selectedDayIndex).observations);
    (map.getSource('sample-birds') as GeoJSONSource).setData(getBirdFeatures(0, selectedDayIndex));
  }, [mapReady, selectedDayIndex]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const layerGroups = {
      bird_activity: ['migration-glow', 'migration-routes', 'migration-birds'],
      tick_activity: ['tick-heatmap'], pathogen_evidence: ['pathogen-context'], community_exposure: [],
    };
    for (const [layerId, mapLayerIds] of Object.entries(layerGroups)) {
      for (const mapLayerId of mapLayerIds) {
        if (map.getLayer(mapLayerId)) map.setLayoutProperty(mapLayerId, 'visibility', visibleLayers[layerId as keyof VisibleLayers] ? 'visible' : 'none');
      }
    }
    const stateColor: ExpressionSpecification = ['case', ['==', ['get', 'code'], selectedStateCode ?? ''], '#829263', visibleLayers.community_exposure ? '#57766c' : '#465b3f'];
    map.setPaintProperty('states', 'fill-color', stateColor);
    map.setPaintProperty('states-raised', 'fill-extrusion-color', stateColor);
  }, [mapReady, visibleLayers, selectedStateCode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.setProjection({ type: viewMode === 'globe' ? 'globe' : 'mercator' });
    map.setLayoutProperty('states-raised', 'visibility', viewMode === 'perspective' ? 'visible' : 'none');
    fitNationalView(map, viewMode);
  }, [mapReady, viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !selectedStateCode) return;
    const state = stateBoundaries.features.find((feature) => feature.properties.code === selectedStateCode);
    if (!state) return;
    map.flyTo({ center: state.properties.center, zoom: 5.2, pitch: viewMode === 'perspective' ? 38 : 0, padding: window.innerWidth > 760 ? { top: 70, bottom: 100, left: 250, right: 360 } : { top: 100, bottom: 340, left: 20, right: 20 }, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900 });
  }, [mapReady, selectedStateCode, stateBoundaries, viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !visibleLayers.bird_activity) return;
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animationFrameId = 0;
    let lastUpdate = 0;
    const startTime = performance.now();
    const animateBirds = (timestamp: number) => {
      if (document.hidden || motionPreference.matches) return;
      if (timestamp - lastUpdate > 70) {
        (map.getSource('sample-birds') as GeoJSONSource).setData(getBirdFeatures((timestamp - startTime) / 1000, selectedDayRef.current));
        lastUpdate = timestamp;
      }
      animationFrameId = requestAnimationFrame(animateBirds);
    };
    const resumeAnimation = () => { cancelAnimationFrame(animationFrameId); if (!document.hidden && !motionPreference.matches) animationFrameId = requestAnimationFrame(animateBirds); };
    resumeAnimation();
    document.addEventListener('visibilitychange', resumeAnimation);
    motionPreference.addEventListener('change', resumeAnimation);
    return () => { cancelAnimationFrame(animationFrameId); document.removeEventListener('visibilitychange', resumeAnimation); motionPreference.removeEventListener('change', resumeAnimation); };
  }, [mapReady, visibleLayers.bird_activity]);

  function resetView() {
    onSelectState(null);
    if (mapRef.current) fitNationalView(mapRef.current, viewMode);
  }

  return <>
    <div className="map-canvas" ref={containerRef} aria-label="Interactive ecological map of the United States" />
    {!mapReady && !mapError && <div className="map-loading" role="status">Preparing your map…</div>}
    {mapError && <div className="map-fallback"><img src="/data/us-states-preview.svg" alt="United States state boundaries" /><p role="status">{mapError}</p></div>}
    <div className="map-navigation" aria-label="Map navigation">
      <button aria-label="Zoom in" disabled={!mapReady || !!mapError} onClick={() => mapRef.current?.zoomIn()}><Plus size={18} /></button>
      <button aria-label="Zoom out" disabled={!mapReady || !!mapError} onClick={() => mapRef.current?.zoomOut()}><Minus size={18} /></button>
      <button aria-label="Reset to United States" disabled={!mapReady || !!mapError} onClick={resetView}><Focus size={18} /></button>
    </div>
  </>;
}

function fitNationalView(map: MapLibreMap, viewMode: MapViewMode) {
  const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650;
  if (viewMode === 'globe') {
    map.easeTo({ center: [-97, 37.7], zoom: 1.7, pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration });
    return;
  }
  map.fitBounds([[-126, 24], [-66, 50]], {
    absolutePadding: true,
    padding: window.innerWidth > 760 ? { top: 120, bottom: 160, left: 280, right: 65 } : { top: 180, bottom: 210, left: 24, right: 24 },
    pitch: viewMode === 'perspective' ? 42 : 0, bearing: viewMode === 'perspective' ? -12 : 0, duration,
  });
}
