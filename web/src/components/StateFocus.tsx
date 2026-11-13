import { useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { EcologySnapshot, PointCollection, ObservationProperties, RelativeScenarioRange, SourceStatus } from '../../../pipeline/contracts';
import type { StateProperties } from '../data/mapTypes';
import { snapshotIsStale } from '../data/ecologyData';
import { summarizeBirdTickContext, summarizeObservations, summarizeQuestingWeather } from '../data/regionalEvidence';

interface StateFocusProps { selectedState: StateProperties; selectedDate: string | null; snapshot: EcologySnapshot | null; error: string | null; onBack: () => void }
const relativeValue = (value: number | null | undefined) => value == null ? 'unavailable' : value.toFixed(3);
const relativeRange = (range: RelativeScenarioRange | null) => range === null ? 'unavailable'
  : `${relativeValue(range.lower)} / ${relativeValue(range.central)} / ${relativeValue(range.upper)}`;
const provenanceValue = (value: unknown) => typeof value === 'object' ? JSON.stringify(value) : String(value);

function ObservationEvidence({ label, collection, source }: { label: string; collection: PointCollection<ObservationProperties>; source: SourceStatus }) {
  const summary = summarizeObservations(collection);
  return <section>
    <h3>{label} observations</h3>
    <p>{summary.recordCount} displayed reports · source {source.status.replaceAll('_', ' ')}.
      {' '}Observed dates: {summary.observedDateStart ? `${summary.observedDateStart} to ${summary.observedDateEnd}` : 'no dated reports displayed'}.
      {' '}Retrieved: {source.data_retrieved_at ?? source.retrieved_at ?? 'unavailable'}.</p>
    <p>Source query eligible: {source.source_query_eligible_record_count ?? 'unavailable'} · published displayed: {summary.recordCount} · unassigned: {source.unassigned_observation_count ?? 'not reported'}.
      {' '}The source query may cover a larger region than this state; these totals have different scopes.</p>
    <p>Query window: {source.window_start_date ? `${source.window_start_date} to ${source.window_end_date ?? 'unspecified'}`
      : source.lookback_days ? `${source.lookback_days} days before collection` : 'not specified'}.
      {' '}{source.window_complete === true ? 'Complete source window reported.' : 'Source window may be partial.'}
      {' '}{source.window_note ? String(source.window_note) : ''}
      {' '}Sampling effort: {source.sampling_effort_available === true ? 'see source provenance' : 'unavailable; report counts cannot measure abundance'}.</p>
    <p>Reports establish recorded presence only. Missing reports do not establish absence. Coverage depends on observers, query limits and reporting effort; reports are held fixed across forecast dates.</p>
    {label === 'Tick' && <p>Life stage unknown in {summary.unknownLifeStageCount} of {summary.recordCount} reports. Ticks with missing life stages are not assigned to the modeled larvae/nymph cohort.</p>}
    {summary.speciesGroups.length > 0 && <ul className="evidence-species">{summary.speciesGroups.map((species) => <li key={species.name}>{species.name}: {species.recordCount} reports</li>)}</ul>}
    {summary.linkedRecords.length > 0 && <>
      <h4>Latest linked records · up to 6</h4>
      <ul>{summary.linkedRecords.map((record) => <li key={`${record.properties.source}-${record.id}`}>
        <a href={record.properties.source_record_url} target="_blank" rel="noopener noreferrer">{record.properties.common_name || record.properties.scientific_name || 'Unidentified species'}</a>
        {' '}· {record.properties.observed_date} · {record.properties.source === 'ebird' ? 'eBird' : 'iNaturalist'}
        {record.properties.kind === 'tick' && ` · life stage: ${record.properties.life_stage || 'unknown'}`}
        <small>{record.properties.attribution} · {record.properties.license}</small>
      </li>)}</ul>
    </>}
  </section>;
}

export default function StateFocus({ selectedState, selectedDate, snapshot, error, onBack }: StateFocusProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const evidenceDialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { evidenceDialogRef.current?.close(); headingRef.current?.focus(); }, [selectedState.code]);
  const frame = snapshot?.frames.find((candidate) => candidate.date === selectedDate);
  const validPoints = frame?.weather_suitability.features.filter((point) => point.properties.questing_suitability !== null) ?? [];
  const questingWeather = summarizeQuestingWeather(frame);
  const connectedEvidence = summarizeBirdTickContext(frame);
  const averageSuitability = questingWeather.averageSuitability;
  const predictedCount = validPoints.filter((point) => point.properties.is_predicted).length;
  const referencePoint = validPoints.find((point) => point.properties.conditions_at_peak)?.properties;
  const referenceConditions = referencePoint?.conditions_at_peak;
  const factors = referencePoint?.factors_at_peak;
  const soilTemperature = referenceConditions?.soil_temperature_c;
  const humidity = referenceConditions?.relative_humidity_percent;
  const previousFrame = snapshot && frame ? snapshot.frames[snapshot.frames.indexOf(frame) - 1] : null;
  const previousWeather = summarizeQuestingWeather(previousFrame);
  const previousConnected = summarizeBirdTickContext(previousFrame);
  const birdReportCount = snapshot?.observations.birds.features.length ?? 0;
  const tickReportCount = snapshot?.observations.ticks.features.length ?? 0;
  const radarDate = connectedEvidence.radarObservedDates.join(', ') || snapshot?.sources.migration?.observed_date || 'unavailable';
  const outsideSupportedScope = connectedEvidence.contextLocationCount > 0 && connectedEvidence.supportedLocationCount === 0;
  const sampledReferences = frame?.weather_suitability.features.filter((point) => point.properties.bird_tick_context?.habitat.status === 'sampled').slice(0, 6) ?? [];
  return <>
    <section className="state-focus-heading" aria-labelledby="state-focus-title">
      <button onClick={onBack}><ArrowLeft size={13} />All states</button>
      <h2 id="state-focus-title" tabIndex={-1} ref={headingRef}>{selectedState.name}</h2>
      <p>Regional detail{selectedDate && ` · ${new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${selectedDate}T12:00:00Z`))}`} · {frame?.outlook === 'lower_confidence' ? 'Lower confidence outlook' : 'Source data'}</p>
    </section>
    <div className="state-source-status" aria-label="Regional data status">
      {error ? <span role="alert">{error} Refocus this window to retry.</span> : !snapshot ? <span role="status">Loading state evidence…</span> : <>
        <span><strong>Bird migration</strong>{birdReportCount} bird reports · Radar {connectedEvidence.radarCoverageCount}/{connectedEvidence.locationCount} locations
          <small className="state-status-detail">Observed night {radarDate}</small>
          <button className="evidence-disclosure" onClick={() => evidenceDialogRef.current?.showModal()} aria-haspopup="dialog">Evidence &amp; model details</button>
        </span>
        <span><strong>Tick activity</strong>{averageSuitability === null ? 'Index unavailable' : `${Math.round(averageSuitability * 100)} / 100 index`} · {tickReportCount} tick reports
          <small className="state-status-detail">{outsideSupportedScope ? 'I. scapularis model outside supported eastern scope; weather evidence available' : predictedCount ? `${predictedCount}/${validPoints.length} spatial estimates · low confidence` : 'Source weather forecasts'}</small>
        </span>
        <span title="Conditions at peak suitability for the first available weather reference sample"><strong>Questing weather</strong>Soil {soilTemperature == null ? 'unavailable' : `${soilTemperature.toFixed(1)}°C`} · RH {humidity == null ? 'unavailable' : `${Math.round(humidity)}%`} · reference sample</span>
      </>}
    </div>
    <dialog className="regional-evidence-dialog" ref={evidenceDialogRef} aria-labelledby="regional-evidence-title">
      <div className="evidence-dialog-heading"><h2 id="regional-evidence-title">{selectedState.name} evidence</h2><button onClick={() => evidenceDialogRef.current?.close()} aria-label="Close evidence details">Close</button></div>
      {snapshot && <div className="evidence-dialog-content">
        <p>Forecast date {selectedDate ?? 'unselected'} · published {snapshot.generated_at}. Source deadline {snapshot.stale_after}.
          {' '}{snapshotIsStale(snapshot) ? 'This source dataset is past its freshness deadline.' : 'This dataset is within its published freshness deadline.'} Retrieval dates below describe collection; observed dates describe the evidence itself.</p>
        <section>
          <h3>Questing weather · current map</h3>
          <p>{averageSuitability === null ? 'Index unavailable' : `${(averageSuitability * 100).toFixed(1)} / 100 index`} across {questingWeather.validWeatherLocationCount}/{connectedEvidence.locationCount} in-scope weather locations.
            {' '}The map uses source questing suitability only. The experimental index does not estimate tick abundance, bites, infection or a calibrated probability.
            {' '}{outsideSupportedScope ? 'I. scapularis model outside supported eastern scope; weather evidence available.' : connectedEvidence.contextLocationCount === 0 ? 'Legacy snapshot: species/geography context unavailable; only source weather suitability is shown.' : ''}</p>
          <p>The daily score uses peak hourly weather suitability, with at least 18 valid weather hours required. Reference sample: {referencePoint?.name ?? 'unavailable'} at {referenceConditions?.time ?? 'unavailable'}; {referencePoint?.valid_weather_hours ?? 0} valid hours.
            {' '}Soil temperature {soilTemperature == null ? 'unavailable' : `${soilTemperature.toFixed(1)}°C`}, relative humidity {humidity == null ? 'unavailable' : `${humidity.toFixed(1)}%`}, vapour pressure deficit {referenceConditions?.vapour_pressure_deficit_kpa == null ? 'unavailable' : `${referenceConditions.vapour_pressure_deficit_kpa.toFixed(2)} kPa`}, soil moisture {relativeValue(referenceConditions?.soil_moisture_fraction)}.</p>
          <p>Reference peak factors (0–1): temperature {relativeValue(factors?.temperature_factor)} · humidity {relativeValue(factors?.humidity_factor)} · vapour pressure deficit {relativeValue(factors?.vapour_pressure_deficit_factor)} · soil moisture {relativeValue(factors?.soil_moisture_factor)}.
            {' '}Weather retrieved {snapshot.sources.weather.data_retrieved_at ?? snapshot.sources.weather.retrieved_at ?? 'unavailable'} · {snapshot.sources.weather.status}.</p>
          <p>Combined ecological activity remains separate and gated: {connectedEvidence.combinedActivityLocationCount}/{connectedEvidence.locationCount} locations have all required inputs. It is not rendered as current questing.</p>
        </section>
        <ObservationEvidence label="Bird" collection={snapshot.observations.birds} source={snapshot.sources.birds} />
        <ObservationEvidence label="Tick" collection={snapshot.observations.ticks} source={snapshot.sources.ticks} />
        <section>
          <h3>Measured radar and inferred stopover</h3>
          <p>Radar observed night: {radarDate} · supported {connectedEvidence.radarCoverageCount}/{connectedEvidence.locationCount} locations · source {snapshot.sources.migration?.status ?? 'unavailable'}.
            {' '}Mean relative migration pressure: {relativeValue(connectedEvidence.averageRadarPressure)}.
            {' '}Radar age at this forecast date: {connectedEvidence.radarAgeDays.length ? `${Math.min(...connectedEvidence.radarAgeDays)}–${Math.max(...connectedEvidence.radarAgeDays)} days` : 'unavailable'}.
            {' '}Measured radar coverage is separate from the illustrative animated routes and individual bird reports.</p>
          <p>Habitat sampled: {connectedEvidence.habitatSampledCount}/{connectedEvidence.locationCount} locations · land cover vintage {connectedEvidence.habitatYears.join(', ') || 'unavailable'} · source {snapshot.sources.habitat?.status ?? 'unavailable'}.
            {' '}A sample represents one 30 m NLCD pixel at a reference point. Sparse samples do not establish statewide habitat coverage and are not extended to other locations.</p>
          <p>Inferred stopover index (0–1): {relativeValue(connectedEvidence.averageStopoverIndex)} · {connectedEvidence.stopoverCoverageCount}/{connectedEvidence.locationCount} locations.
            {' '}Weather component: {relativeValue(connectedEvidence.averageStopoverWeather)}. Missing habitat withholds stopover and deposition scores while usable radar and weather components remain visible.</p>
          {sampledReferences.length > 0 && <>
            <h4>Sampled reference contributions · up to 6</h4>
            <p>Stopover multiplies relative radar pressure × weather factor × assumed habitat class weight. Deposition multiplies stopover by each detachment scenario weight. Class weights are modeling assumptions, not measured tick habitat suitability.</p>
            <ul>{sampledReferences.map((point) => {
              const properties = point.properties;
              const context = properties.bird_tick_context!;
              const radar = properties.measured_migration;
              return <li key={point.id}>
                <strong>{properties.name}</strong> · {context.supported_cohort ? 'inside scenario envelope' : 'outside supported scenario scope'}
                <p>NLCD {context.habitat.year} class {context.habitat.land_cover_class ?? 'unavailable'} · assumed habitat weight {relativeValue(context.habitat.habitat_factor)}.
                  {' '}Radar {radar?.radar ?? 'unavailable'} · {radar ? `${radar.distance_km.toFixed(1)} km away · ${radar.airborne_birds_per_square_km.toFixed(2)} airborne birds/km² · ${radar.valid_night_profiles} valid night profiles` : 'station details unavailable'}
                  {' '}· observed {radar?.observed_date ?? context.radar_observed_date ?? 'unavailable'}.
                  {radar?.source_url.startsWith('https://') && <> <a href={radar.source_url} target="_blank" rel="noopener noreferrer">Radar source profile</a>.</>}</p>
                <p>Relative radar pressure {relativeValue(context.migration_pressure)} × weather {relativeValue(context.stopover_weather_factor)} × habitat {relativeValue(context.habitat.habitat_factor)} = stopover {relativeValue(context.stopover_index)}.
                  {' '}Detachment lower / central / upper: {relativeRange(context.detachment_timing_weight)}; deposition: {relativeRange(context.deposition_potential)}.</p>
              </li>;
            })}</ul>
          </>}
        </section>
        <section>
          <h3>Conditional bird-carried tick scenario</h3>
          <p>Scenario cohort: <i>Ixodes scapularis</i> larvae/nymphs in the eastern contiguous U.S. (approximately longitude ≥ −100°).
            {' '}{connectedEvidence.contextLocationCount === 0 ? 'Connected scenario data unavailable in this snapshot.' : outsideSupportedScope ? 'This region is outside the supported scenario geography.'
              : `${connectedEvidence.supportedLocationCount}/${connectedEvidence.locationCount} locations fall within the scenario envelope; this does not establish local tick populations.`}</p>
          <p>Relative deposition potential (0–1), lower / central / upper: {relativeRange(connectedEvidence.averageDeposition)} · {connectedEvidence.depositionCoverageCount}/{connectedEvidence.locationCount} locations.
            {' '}Conditional scenario bounds are not confidence intervals, expected tick counts, or exact release locations. Means include only locations with a usable scenario.</p>
          <p>Detachment assumes 3–6 days of attachment and a uniform attachment-age scenario at the reference radar night. Remaining timing support, lower / central / upper: {relativeRange(connectedEvidence.averageDetachmentTiming)}.
            {' '}No attached-tick burden is measured. The scenario cannot estimate how many ticks birds carry or deposit.</p>
          <p>Post-drop survival/persistence is unavailable: ambient forecast moisture cannot establish leaf-litter microclimate or a calibrated survival probability. Any moisture support component is a proxy. Deposition does not mean surviving ticks.</p>
          <p>Development and field emergence are outside this forecast model. Deposited immature ticks are never added to current questing.</p>
          <p>Biology and data sources: <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC7225381/" target="_blank" rel="noopener noreferrer">Heylen et al. (2020), feeding on house finches</a>; <a href="https://doi.org/10.1186/s13071-015-1185-7" target="_blank" rel="noopener noreferrer">Kocan et al. (2015), laboratory development</a>; <a href="https://www.usgs.gov/centers/eros/science/about-annual-nlcd" target="_blank" rel="noopener noreferrer">USGS Annual NLCD</a>.
            {' '}Laboratory findings inform the assumptions; these papers do not validate the scenario weights or predict field emergence.</p>
          {connectedEvidence.missingInputs.length > 0 && <p>Missing scenario inputs: {connectedEvidence.missingInputs.join(', ').replaceAll('_', ' ')}.</p>}
        </section>
        <section>
          <h3>Why the date changes the map</h3>
          <p>Bird/tick reports, radar observations and habitat reference evidence stay fixed across forecast dates. Forecast weather changes questing and stopover components. Elapsed days from the measured radar night change conditional remaining attachment/detachment support. The app does not forecast bird reports or add a radar boost to current questing.</p>
          {previousFrame && <p>Compared with {previousFrame.date}: questing weather mean {previousWeather.averageSuitability === null ? 'unavailable' : (previousWeather.averageSuitability * 100).toFixed(1)} → {averageSuitability === null ? 'unavailable' : (averageSuitability * 100).toFixed(1)} (0–100 index); relative deposition central {relativeValue(previousConnected.averageDeposition?.central)} → {relativeValue(connectedEvidence.averageDeposition?.central)}.</p>}
        </section>
        <details className="evidence-provenance"><summary>All public source provenance</summary>
          {Object.entries(snapshot.sources).map(([sourceName, source]) => <section key={sourceName}><h3>{sourceName}</h3><dl>
            {Object.entries(source).map(([fieldName, value]) => <div key={fieldName}><dt>{fieldName.replaceAll('_', ' ')}</dt><dd>{provenanceValue(value)}</dd></div>)}
          </dl></section>)}
          <h3>Published model semantics</h3><dl>{Object.entries(snapshot.semantics).map(([name, value]) => <div key={name}><dt>{name.replaceAll('_', ' ')}</dt><dd>{value}</dd></div>)}</dl>
        </details>
      </div>}
    </dialog>
  </>;
}
