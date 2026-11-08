import { useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { EcologySnapshot } from '../../../pipeline/contracts';
import type { StateProperties } from '../data/mapTypes';

interface StateFocusProps { selectedState: StateProperties; selectedDate: string | null; snapshot: EcologySnapshot | null; error: string | null; onBack: () => void }

export default function StateFocus({ selectedState, selectedDate, snapshot, error, onBack }: StateFocusProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, [selectedState.code]);
  const frame = snapshot?.frames.find((candidate) => candidate.date === selectedDate);
  const validPoints = frame?.weather_suitability.features.filter((point) => point.properties.questing_suitability !== null) ?? [];
  const averageSuitability = validPoints.length ? validPoints.reduce((total, point) => total + point.properties.questing_suitability!, 0) / validPoints.length : null;
  const referenceConditions = validPoints[0]?.properties.conditions_at_peak;
  const soilTemperature = referenceConditions?.soil_temperature_c;
  const humidity = referenceConditions?.relative_humidity_percent;
  return <>
    <section className="state-focus-heading" aria-labelledby="state-focus-title">
      <button onClick={onBack}><ArrowLeft size={13} />All states</button>
      <h2 id="state-focus-title" tabIndex={-1} ref={headingRef}>{selectedState.name}</h2>
      <p>Regional detail{selectedDate && ` · ${new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${selectedDate}T12:00:00Z`))}`} · {frame?.outlook === 'lower_confidence' ? 'Lower confidence outlook' : 'Source data'}</p>
    </section>
    <div className="state-source-status" aria-label="Regional data status">
      {error ? <span role="alert">{error}</span> : !snapshot ? <span role="status">Loading state evidence…</span> : <>
        <span><strong>Bird activity</strong>{snapshot.observations.birds.features.length} reports · {snapshot.sources.birds.status}</span>
        <span><strong>Tick activity</strong>{snapshot.observations.ticks.features.length} report{snapshot.observations.ticks.features.length === 1 ? '' : 's'} · {averageSuitability === null ? 'weather unavailable' : `${Math.round(averageSuitability * 100)}/100 weather suitability`}</span>
        <span title="Conditions at peak suitability for the first available weather reference sample"><strong>Questing weather</strong>Soil {soilTemperature == null ? 'unavailable' : `${soilTemperature.toFixed(1)}°C`} · RH {humidity == null ? 'unavailable' : `${Math.round(humidity)}%`} · reference sample</span>
        <span><strong>Health + exposure</strong>Not connected</span>
      </>}
    </div>
  </>;
}
