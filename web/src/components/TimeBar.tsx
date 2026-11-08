import type { TimelineDay } from '../data/mapFrames';

interface TimeBarProps {
  days: TimelineDay[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}

export default function TimeBar({ days, selectedDate, onSelectDate }: TimeBarProps) {
  return <section className="time-bar" aria-label="Forecast timeline">
    <div className="timeline-content">
      <div className="timeline-heading"><span>Weather forecast</span><span>{days.length} days · UTC · Days 4+ lower confidence</span></div>
      <div className="timeline-days" role="group" aria-label="Choose forecast date">
        {days.map((day) => <button key={day.date} aria-label={`Forecast ${day.date}`} aria-pressed={selectedDate === day.date} onClick={() => onSelectDate(day.date)}>
          <span>{day.isToday ? 'Today' : day.weekday}</span><strong>{day.dayOfMonth}</strong>
        </button>)}
      </div>
    </div>
  </section>;
}
