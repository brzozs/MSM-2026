import { useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { StateProperties } from '../data/mapTypes';

interface StateFocusProps { selectedState: StateProperties; selectedDate: string; onBack: () => void }

export default function StateFocus({ selectedState, selectedDate, onBack }: StateFocusProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, [selectedState.code]);
  return <>
    <section className="state-focus-heading" aria-labelledby="state-focus-title">
      <button onClick={onBack}><ArrowLeft size={13} />All states</button>
      <h2 id="state-focus-title" tabIndex={-1} ref={headingRef}>{selectedState.name}</h2>
      <p>Regional detail · {new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${selectedDate}T12:00:00Z`))} · Preview data</p>
    </section>
    <div className="state-source-status" aria-label="Regional data status">
      <span><strong>Bird movement</strong>Illustrative flock + wind</span>
      <span><strong>Tick activity</strong>Illustrative heatmap</span>
      <span><strong>Questing weather</strong>Not connected</span>
      <span><strong>Health + exposure</strong>Not connected</span>
    </div>
  </>;
}
