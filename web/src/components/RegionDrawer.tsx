import { useEffect, useRef } from 'react';
import { ArrowUpRight, MapPin, X } from 'lucide-react';
import type { StateProperties } from '../data/mapTypes';

interface RegionDrawerProps { selectedState: StateProperties; selectedDate: string; onClose: () => void }

export default function RegionDrawer({ selectedState, selectedDate, onClose }: RegionDrawerProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, [selectedState.code]);

  return <aside className="region-drawer" aria-labelledby="region-title">
    <button className="drawer-close icon-button" aria-label="Close region details" onClick={onClose}><X size={19} /></button>
    <div className="region-location"><MapPin size={14} /><span>United States / {selectedState.code}</span></div>
    <h2 id="region-title" tabIndex={-1} ref={headingRef}>{selectedState.name}</h2>
    <p className="drawer-date">Preview for {new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${selectedDate}T12:00:00Z`))}</p>
    <div className="region-preview-note"><span className="status-dot" />Illustrative preview</div>
    <p className="region-summary">Explore how bird movement, tick activity and local conditions will come together here.</p>
    <div className="region-evidence">
      <h3>Regional evidence</h3>
      <dl>
        <div><dt>Bird observations</dt><dd>Not connected</dd></div>
        <div><dt>Questing conditions</dt><dd>Awaiting weather</dd></div>
        <div><dt>Pathogen surveillance</dt><dd>Not connected</dd></div>
        <div><dt>Community exposure</dt><dd>Not connected</dd></div>
      </dl>
    </div>
    <div className="drawer-context"><h3>A view of the possibilities</h3><p>The map uses real boundaries with sample activity. Colors, bird movement and state height do not indicate measured risk.</p></div>
    <a className="source-link" href="https://www.cdc.gov/ticks/about/where-ticks-live.html" target="_blank" rel="noreferrer">CDC tick information <ArrowUpRight size={14} /></a>
  </aside>;
}
