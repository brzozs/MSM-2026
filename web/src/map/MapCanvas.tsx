import { useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapLibreMap, CanvasSource, GeoJSONSource, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Focus, Minus, Plus } from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection } from 'geojson';
import type { EcologySnapshot } from '../../../pipeline/contracts';
import type { StateBoundaries, VisibleLayers } from '../data/mapTypes';
import { buildEcologyMapData, buildStateHeatmap, interpolateStateActivity, type EcologyStateFrame, type StateHeatmap, type WeatherFrame } from '../data/ecologyData';
import { createMapStyle, createStateColorExpression, createStateHeightExpression, createStateLabelHeightExpression, createStateLabelText } from './mapStyle';
import { buildRegionalPreview, getStateBounds } from '../data/regionFocus';
import { MigrationLayer } from './MigrationLayer';
import { getSeasonalMigrationDirection } from '../data/seasonalMigration';
import { getElapsedAnimationSeconds } from '../data/animationTiming';
import { createSuitabilitySurfaceGrid, renderSuitabilitySurface, surfacePixelForCoordinate } from '../data/suitabilitySurface';

setWorkerUrl(workerUrl);
interface MapCanvasProps {
  stateBoundaries: StateBoundaries;
  selectedStateCode: string | null;
  weatherFrame: WeatherFrame | null;
  stateSnapshot: EcologySnapshot | null;
  visibleLayers: VisibleLayers;
  onSelectState: (stateCode: string | null) => void;
}

export default function MapCanvas({ stateBoundaries, selectedStateCode, weatherFrame, stateSnapshot, visibleLayers, onSelectState }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const selectStateRef = useRef(onSelectState);
  const displayedStatesRef = useRef<EcologyStateFrame | null>(null);
  const previousForecastDateRef = useRef<string | null>(null);
  const displayedHeatmapRef = useRef<StateHeatmap['points']>({ type: 'FeatureCollection', features: [] });
  const heatmapGenerationRef = useRef('');
  const heatmapDateRef = useRef('');
  const heatmapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const migrationLayerRef = useRef<MigrationLayer | null>(null);
  const focusedStateZoomRef = useRef<number | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [boundaryStatus, setBoundaryStatus] = useState<string | null>(null);
  const [showCityNames, setShowCityNames] = useState(false);
  const [countyLabels, setCountyLabels] = useState<FeatureCollection | null>(null);
  const [regionalGeography, setRegionalGeography] = useState<{ stateCode: string; boundaries: FeatureCollection } | null>(null);
  const regionalBoundaries = regionalGeography?.stateCode === selectedStateCode ? regionalGeography.boundaries : null;
  const selectedState = useMemo(() => stateBoundaries.features.find((state) => state.properties.code === selectedStateCode), [stateBoundaries, selectedStateCode]);
  const regionalFlightRoute = useMemo(() => selectedState ? buildRegionalPreview(selectedState, 0).migrationRoute : null, [selectedState]);
  useEffect(() => {
    const abortController = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/county-labels.geojson`, { signal: abortController.signal })
      .then((response) => { if (!response.ok) throw new Error('County labels could not load.'); return response.json(); })
      .then((data) => {
        if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Invalid county label geography.');
        if (!abortController.signal.aborted) setCountyLabels(data);
      })
      .catch(() => { if (!abortController.signal.aborted) setBoundaryStatus('County labels could not load.'); });
    return () => abortController.abort();
  }, []);

  useEffect(() => { selectStateRef.current = onSelectState; }, [onSelectState]);

  useEffect(() => {
    if (!containerRef.current) return;
    setMapReady(false);
    let map: MapLibreMap;
    let disposed = false;
    try {
      map = new MapLibreMap({ container: containerRef.current, style: createMapStyle(stateBoundaries),
        center: [-97, 37.7], zoom: 3.7, pitch: 52, bearing: -12, minZoom: 1.2, maxZoom: 10, maxPitch: 65,
        dragRotate: { around: 'center', movement: 'linear' }, dragPan: true, scrollZoom: true,
        pitchWithRotate: true, pitchSpeed: -0.35, rotateSpeed: 0.4, attributionControl: { compact: true },
        crossSourceCollisions: false, fadeDuration: 350, canvasContextAttributes: { antialias: true } });
      mapRef.current = map;
    } catch {
      setMapError('The interactive map needs WebGL. Choose a state to read its data.'); return;
    }
    map.on('load', () => {
      if (disposed) return;
      const heatmapCanvas = document.createElement('canvas');
      heatmapCanvas.width = heatmapCanvas.height = 1;
      heatmapCanvasRef.current = heatmapCanvas;
      map.addSource('state-weather-heatmap', { type: 'canvas', canvas: heatmapCanvas, animate: false,
        coordinates: [[-126, 50], [-66, 50], [-66, 24], [-126, 24]] });
      map.addLayer({ id: 'local-suitability-heatmap', type: 'raster', source: 'state-weather-heatmap',
        layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.9, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, 'surrounding-state-outlines');
      const migrationLayer = new MigrationLayer();
      migrationLayerRef.current = migrationLayer;
      map.addLayer(migrationLayer);
      setMapReady(true);
    });
    const visibleStateLayer = () => map.getLayoutProperty('states-raised', 'visibility') === 'none' ? 'states' : 'states-raised';
    map.on('click', (event) => {
      if (!map.getLayer(visibleStateLayer())) return;
      const stateCode = map.queryRenderedFeatures(event.point, { layers: [visibleStateLayer()] })[0]?.properties.code;
      if (typeof stateCode === 'string') selectStateRef.current(stateCode);
    });
    map.on('mousemove', (event) => { if (map.isStyleLoaded()) map.getCanvas().style.cursor = map.queryRenderedFeatures(event.point, { layers: [visibleStateLayer()] }).length ? 'pointer' : ''; });
    map.on('mouseout', () => { map.getCanvas().style.cursor = ''; });
    map.on('zoom', () => setShowCityNames(focusedStateZoomRef.current !== null && map.getZoom() > focusedStateZoomRef.current + 0.1));
    map.on('webglcontextlost', () => { if (!disposed) setMapError('The map lost its graphics connection. Reload or choose a state to read its data.'); });
    map.on('error', (event) => { if (!disposed && event.error.message.includes('countries.geojson')) setMapError('The base map could not load. Refresh to retry.'); });
    return () => { disposed = true; mapRef.current = null; migrationLayerRef.current = null; heatmapCanvasRef.current = null; map.remove(); };
  }, [stateBoundaries]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const previousStates = displayedStatesRef.current;
    const dayHasChanged = previousForecastDateRef.current !== weatherFrame?.date;
    previousForecastDateRef.current = weatherFrame?.date ?? null;
    const regionalFrame = weatherFrame && selectedStateCode ? { ...weatherFrame, weather_suitability: { ...weatherFrame.weather_suitability,
      features: weatherFrame.weather_suitability.features.filter((point) => point.properties.state_code === selectedStateCode) } } : weatherFrame;
    const targetStates = buildEcologyMapData(stateBoundaries, regionalFrame).states;
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animationFrameId = 0;
    const startedAt = performance.now();
    let lastUpdate = 0;
    const applyStates = (states: EcologyStateFrame) => {
      displayedStatesRef.current = states;
      for (const state of states.features) map.setFeatureState({ source: 'states', id: state.properties.code }, {
        questing_suitability: state.properties.questing_suitability, display_height: state.properties.display_height });
      (map.getSource('state-label-points') as GeoJSONSource).setData({ type: 'FeatureCollection', features: states.features.map((state) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: state.properties.center }, properties: { ...state.properties,
          suitability_percent: state.properties.questing_suitability === null ? null : Math.round(state.properties.questing_suitability * 100) } })) });

    };
    const animate = (timestamp: number) => {
      const progress = Math.min(1, getElapsedAnimationSeconds(timestamp, startedAt) / 1.6);
      if (timestamp - lastUpdate > 30 || progress === 1) {
        applyStates(previousStates ? interpolateStateActivity(previousStates, targetStates, progress) : targetStates);
        lastUpdate = timestamp;
      }
      if (progress < 1) animationFrameId = requestAnimationFrame(animate);
    };
    const finishTransition = () => { cancelAnimationFrame(animationFrameId); applyStates(targetStates); };
    if (!previousStates || !weatherFrame || !dayHasChanged || motionPreference.matches || document.hidden) finishTransition();
    else animationFrameId = requestAnimationFrame(animate);
    motionPreference.addEventListener('change', finishTransition);
    document.addEventListener('visibilitychange', finishTransition);
    return () => { cancelAnimationFrame(animationFrameId); motionPreference.removeEventListener('change', finishTransition); document.removeEventListener('visibilitychange', finishTransition); };
  }, [mapReady, weatherFrame, stateBoundaries, selectedStateCode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource('regional-boundaries') as GeoJSONSource;
    source.setData({ type: 'FeatureCollection', features: [] });
    if (!selectedState) { setBoundaryStatus(null); return; }
    const abortController = new AbortController();
    setBoundaryStatus('Loading county and town boundaries…');
    fetch(`${import.meta.env.BASE_URL}data/regions/${selectedState.properties.fips}.geojson`, { signal: abortController.signal })
      .then((response) => { if (!response.ok) throw new Error('Regional geography request failed.'); return response.json(); })
      .then((data) => { if (abortController.signal.aborted) return;
        if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Invalid regional geography.');
        source.setData(data); setRegionalGeography({ stateCode: selectedState.properties.code, boundaries: data }); setBoundaryStatus(null); })
      .catch(() => { if (!abortController.signal.aborted) setBoundaryStatus('County and town boundaries could not load. Refresh to retry.'); });
    return () => abortController.abort();
  }, [mapReady, selectedState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const countyPoints = selectedState ? (countyLabels?.features ?? []).filter((county) => county.properties?.state_fips === selectedState.properties.fips)
      .map((county) => ({ ...county, properties: { ...county.properties, kind: 'county' } })) : [];
    (map.getSource('county-label-points') as GeoJSONSource).setData({ type: 'FeatureCollection', features: [
      ...countyPoints, ...(regionalBoundaries?.features.filter((feature) => feature.properties?.kind !== 'county') ?? []),
    ] });
  }, [mapReady, countyLabels, regionalBoundaries, selectedState]);

  useEffect(() => {
    const map = mapRef.current;
    const canvas = heatmapCanvasRef.current;
    if (!map || !mapReady || !canvas) return;
    const heatmap = selectedState && weatherFrame ? buildStateHeatmap(stateSnapshot, weatherFrame.date, selectedState.properties.code) : null;
    // Provider grid cells can lie outside the boundary while still supporting in-state estimates.
    const features = heatmap?.points.features ?? [];
    const source = map.getSource('state-weather-heatmap') as CanvasSource;
    const context = canvas.getContext('2d');
    if (!context) { setMapError('The local suitability surface could not initialize.'); return; }
    if (!selectedState || !features.length) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      source.play(); source.pause(); map.triggerRepaint();
      displayedHeatmapRef.current = { type: 'FeatureCollection', features: [] };
      return;
    }
    // Retain missing reference locations so smoothing cannot fill their nearest-sample areas.
    const referenceSamples = stateSnapshot?.frames.find((frame) => frame.date === weatherFrame?.date)?.weather_suitability.features ?? [];
    const surfaceGrid = createSuitabilitySurfaceGrid(referenceSamples.map((point) => point.geometry.coordinates), getStateBounds(selectedState),
      stateSnapshot?.scope.maximum_interpolation_distance_meters ?? 25000, 640, stateSnapshot?.scope.sampling_spacing_km ?? null);
    canvas.width = surfaceGrid.width; canvas.height = surfaceGrid.height;
    source.setCoordinates(surfaceGrid.coordinates);
    const pixelCanvas = document.createElement('canvas');
    pixelCanvas.width = surfaceGrid.width; pixelCanvas.height = surfaceGrid.height;
    const pixelContext = pixelCanvas.getContext('2d');
    if (!pixelContext) { setMapError('The local suitability pixels could not initialize.'); return; }
    const image = pixelContext.createImageData(surfaceGrid.width, surfaceGrid.height);
    const stateClip = new Path2D();
    const polygons = selectedState.geometry.type === 'Polygon' ? [selectedState.geometry.coordinates] : selectedState.geometry.coordinates;
    for (const polygon of polygons) for (const ring of polygon) {
      ring.forEach((coordinate, index) => {
        const [x, y] = surfacePixelForCoordinate(surfaceGrid, coordinate);
        if (index === 0) stateClip.moveTo(x, y); else stateClip.lineTo(x, y);
      });
      stateClip.closePath();
    }
    const generationKey = `${selectedStateCode}/${stateSnapshot?.generated_at ?? ''}`;
    const shouldAnimate = heatmapGenerationRef.current === generationKey && heatmapDateRef.current !== weatherFrame?.date
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && !document.hidden;
    heatmapGenerationRef.current = generationKey;
    heatmapDateRef.current = weatherFrame?.date ?? '';
    const previousValues = new Map(displayedHeatmapRef.current.features.map((point) => [point.id, point.properties]));
    let animationFrameId = 0;
    let lastUpdate = 0;
    const startedAt = performance.now();
    const applyHeatmap = (progress: number) => {
      const easedProgress = progress * progress * (3 - 2 * progress);
      const displayedFeatures = progress >= 1 ? features : features.map((point) => {
        const previous = previousValues.get(point.id);
        return !previous ? point : { ...point, properties: {
          model_value: previous.model_value + (point.properties.model_value - previous.model_value) * easedProgress,
        } };
      });
      displayedHeatmapRef.current = { type: 'FeatureCollection', features: displayedFeatures };
      const displayedValues = new Map(displayedFeatures.map((point) => [point.id, point.properties.model_value]));
      renderSuitabilitySurface(surfaceGrid, referenceSamples.map((point) => displayedValues.get(point.id) ?? null), image.data);
      pixelContext.putImageData(image, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.save(); context.clip(stateClip, 'evenodd'); context.drawImage(pixelCanvas, 0, 0); context.restore();
      source.play(); source.pause(); map.triggerRepaint();
    };
    const animate = (timestamp: number) => {
      const progress = Math.min(1, getElapsedAnimationSeconds(timestamp, startedAt) / 1.6);
      if (timestamp - lastUpdate > 30 || progress === 1) { applyHeatmap(progress); lastUpdate = timestamp; }
      if (progress < 1) animationFrameId = requestAnimationFrame(animate);
    };
    if (shouldAnimate && previousValues.size && features.length) animationFrameId = requestAnimationFrame(animate);
    else applyHeatmap(1);
    return () => cancelAnimationFrame(animationFrameId);
  }, [mapReady, stateSnapshot, weatherFrame, selectedState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const layerId of ['selected-state-outline', 'regional-county-borders']) {
      map.setLayoutProperty(layerId, 'visibility', selectedState ? 'visible' : 'none');
    }
    map.setLayoutProperty('regional-town-names', 'visibility', selectedState && showCityNames ? 'visible' : 'none');
    map.setLayoutProperty('regional-town-borders', 'visibility', selectedState && showCityNames ? 'visible' : 'none');
    map.setLayoutProperty('county-labels', 'visibility', selectedState && !showCityNames ? 'visible' : 'none');
    map.setLayoutProperty('local-suitability-heatmap', 'visibility', selectedState && visibleLayers.tick_activity ? 'visible' : 'none');
    for (const layerId of ['surrounding-state-outlines', 'surrounding-state-names']) {
      map.setLayoutProperty(layerId, 'visibility', selectedState ? 'visible' : 'none');
      map.setFilter(layerId, ['!=', ['get', 'code'], selectedStateCode ?? '']);
    }
    map.setLayoutProperty('pathogen-context', 'visibility', 'none');
    migrationLayerRef.current?.setVisible(visibleLayers.bird_activity);
    const colors = createStateColorExpression(visibleLayers.tick_activity);
    map.setPaintProperty('states-raised', 'fill-extrusion-color', colors);
    map.setPaintProperty('states', 'fill-color', selectedState ? ['case', ['==', ['get', 'code'], selectedStateCode], '#344b35', '#1d3026'] : colors);
    map.setLayoutProperty('states-raised', 'visibility', selectedState ? 'none' : 'visible');
    map.setPaintProperty('states-raised', 'fill-extrusion-height', createStateHeightExpression(visibleLayers.tick_activity));
    map.setPaintProperty('land', 'fill-color', selectedState ? '#172820' : '#293e31');
    map.setLayoutProperty('state-labels', 'visibility', selectedState ? 'none' : 'visible');
    map.setLayoutProperty('state-labels', 'text-field', createStateLabelText(visibleLayers.tick_activity));
    map.setLayoutProperty('state-labels', 'symbol-height-offset', createStateLabelHeightExpression(visibleLayers.tick_activity));
    map.setFilter('selected-state-outline', ['==', ['get', 'code'], selectedStateCode ?? '']);
  }, [mapReady, visibleLayers, selectedStateCode, selectedState, showCityNames]);

  const seasonalDirection = weatherFrame ? getSeasonalMigrationDirection(weatherFrame.date) : null;
  useEffect(() => {
    migrationLayerRef.current?.setRegionRoute(regionalFlightRoute, !!selectedState);
    migrationLayerRef.current?.setSeasonalDirection(seasonalDirection);
  }, [mapReady, regionalFlightRoute, selectedState, seasonalDirection]);

  useEffect(() => {
    if (!mapReady || !visibleLayers.bird_activity) return;
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animationFrameId = 0;
    let lastUpdate = 0;
    const startTime = performance.now();
    const animateBirds = (timestamp: number) => {
      if (document.hidden || motionPreference.matches) return;
      if (timestamp - lastUpdate > 33) {
        migrationLayerRef.current?.setFrame(getElapsedAnimationSeconds(timestamp, startTime));
        lastUpdate = timestamp;
      }
      animationFrameId = requestAnimationFrame(animateBirds);
    };
    const resumeAnimation = () => {
      cancelAnimationFrame(animationFrameId);
      if (motionPreference.matches) migrationLayerRef.current?.setFrame(0);
      else if (!document.hidden) animationFrameId = requestAnimationFrame(animateBirds);
    };
    resumeAnimation();
    document.addEventListener('visibilitychange', resumeAnimation);
    motionPreference.addEventListener('change', resumeAnimation);
    return () => { cancelAnimationFrame(animationFrameId); document.removeEventListener('visibilitychange', resumeAnimation); motionPreference.removeEventListener('change', resumeAnimation); };
  }, [mapReady, visibleLayers.bird_activity]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    focusedStateZoomRef.current = null;
    setShowCityNames(false);
    if (selectedState) {
      const camera = map.cameraForBounds(getStateBounds(selectedState), { absolutePadding: true, maxZoom: 10, pitch: 42, bearing: -12,
        padding: map.getContainer().clientWidth > 760 ? { top: 175, bottom: 195, left: 300, right: 75 } : { top: 190, bottom: 210, left: 36, right: 36 } });
      if (camera) {
        focusedStateZoomRef.current = camera.zoom ?? null;
        map.stop();
        map.easeTo({ ...camera, pitch: 42, bearing: -12, essential: true,
          duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1600,
          easing: (progress) => progress * progress * (3 - 2 * progress) });
      }
    } else fitNationalView(map);
  }, [mapReady, selectedState]);

  function resetView() { onSelectState(null); if (!selectedStateCode && mapRef.current) fitNationalView(mapRef.current); }
  return <>
    <div className="map-canvas" ref={containerRef} aria-label="Interactive ecological map of the United States" />
    <p className="map-drag-hint">Right-drag to tilt + rotate<br /><span>Left-drag to pan · Scroll to zoom</span></p>
    {!mapReady && !mapError && <div className="map-loading" role="status">Preparing your map…</div>}
    {mapError && <div className="map-fallback"><img src={`${import.meta.env.BASE_URL}data/us-states-preview.svg`} alt="United States state boundaries" /><p role="status">{mapError}</p></div>}
    {selectedState && boundaryStatus && <p className="regional-geography-status" role="status">{boundaryStatus}</p>}
    <div className="map-navigation" aria-label="Map navigation">
      <button aria-label="Zoom in" disabled={!mapReady || !!mapError} onClick={() => mapRef.current?.zoomIn()}><Plus size={17} /></button>
      <button aria-label="Zoom out" disabled={!mapReady || !!mapError} onClick={() => mapRef.current?.zoomOut()}><Minus size={17} /></button>
      <button aria-label="Reset national view" disabled={!mapReady || !!mapError} onClick={resetView}><Focus size={17} /></button>
    </div>
  </>;
}

function fitNationalView(map: MapLibreMap) {
  map.fitBounds([[-126, 24], [-66, 50]], { absolutePadding: true,
    padding: window.innerWidth > 760 ? { top: 120, bottom: 140, left: 280, right: 65 } : { top: 140, bottom: 155, left: 24, right: 24 },
    pitch: 52, bearing: -12, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650 });
}
