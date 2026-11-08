import { useEffect, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { TimelineDay } from '../data/mapFrames';

interface TimeBarProps {
  days: TimelineDay[];
  selectedDayIndex: number;
  onSelectDay: (dayIndex: number) => void;
}

export default function TimeBar({ days, selectedDayIndex, onSelectDay }: TimeBarProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  useEffect(() => {
    if (!isPlaying) return;
    const intervalId = window.setInterval(() => onSelectDay((selectedDayIndex + 1) % days.length), 2600);
    return () => window.clearInterval(intervalId);
  }, [isPlaying, selectedDayIndex, days.length, onSelectDay]);

  return <section className="time-bar" aria-label="Forecast timeline">
    <button className="play-button" aria-label={isPlaying ? 'Pause timeline' : 'Play timeline'} aria-pressed={isPlaying} onClick={() => setIsPlaying(!isPlaying)}>
      {isPlaying ? <Pause size={17} /> : <Play size={17} />}
    </button>
    <div className="timeline-content">
      <div className="timeline-heading"><span>Weather forecast</span><span>{days.length} days · UTC · Days 4+ lower confidence</span></div>
      <div className="timeline-days" role="group" aria-label="Choose forecast date">
        {days.map((day, dayIndex) => <button key={day.date} aria-label={`Forecast ${day.date}`} aria-pressed={selectedDayIndex === dayIndex} onClick={() => onSelectDay(dayIndex)}>
          <span>{day.isToday ? 'Today' : day.weekday}</span><strong>{day.dayOfMonth}</strong>
        </button>)}
      </div>
    </div>
  </section>;
}
