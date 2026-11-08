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
    const intervalId = window.setInterval(() => onSelectDay((selectedDayIndex + 1) % days.length), 1300);
    return () => window.clearInterval(intervalId);
  }, [isPlaying, selectedDayIndex, days.length, onSelectDay]);

  return <section className="time-bar" aria-label="Preview timeline">
    <button className="play-button" aria-label={isPlaying ? 'Pause timeline' : 'Play timeline'} aria-pressed={isPlaying} onClick={() => setIsPlaying(!isPlaying)}>
      {isPlaying ? <Pause size={17} /> : <Play size={17} />}
    </button>
    <div className="timeline-content">
      <div className="timeline-heading"><span>Preview timeline</span><span>7 days · UTC</span></div>
      <div className="timeline-days" role="group" aria-label="Choose preview date">
        {days.map((day, dayIndex) => <button key={day.date} aria-label={`Preview ${day.date}`} aria-pressed={selectedDayIndex === dayIndex} onClick={() => onSelectDay(dayIndex)}>
          <span>{day.isToday ? 'Today' : day.weekday}</span><strong>{day.dayOfMonth}</strong>
        </button>)}
      </div>
    </div>
  </section>;
}
