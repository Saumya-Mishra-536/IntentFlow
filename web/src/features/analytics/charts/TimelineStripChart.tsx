import { useMemo } from 'react';
import { useChartSize } from '@/shared/components/d3/useChartSize';

type TimelineEvent = {
  id: string;
  timestamp: string;
  status?: string;
  provider?: string;
  label?: string;
};

export function TimelineStripChart(props: {
  events: TimelineEvent[];
  activeId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const { events, activeId, onSelect } = props;
  const { ref, width, height } = useChartSize<HTMLDivElement>();

  const sorted = useMemo(
    () => [...events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
    [events],
  );

  const left = 12;
  const right = 12;
  const y = Math.max(20, height / 2);
  const minT = sorted.length ? new Date(sorted[0].timestamp).getTime() : 0;
  const maxT = sorted.length ? new Date(sorted[sorted.length - 1].timestamp).getTime() : 1;
  const w = Math.max(width - left - right, 1);
  const scaleX = (t: number) => left + ((t - minT) / Math.max(maxT - minT, 1)) * w;

  return (
    <div ref={ref} className="h-full w-full">
      <svg width={Math.max(width, 10)} height={Math.max(height, 10)}>
        <line x1={left} x2={left + w} y1={y} y2={y} stroke="currentColor" opacity={0.25} />
        {sorted.map((event) => {
          const time = new Date(event.timestamp).getTime();
          const x = scaleX(time);
          const selected = activeId === event.id;
          const fill = event.status === 'failed' ? '#f43f5e' : '#3b82f6';
          return (
            <circle
              key={event.id}
              cx={x}
              cy={y}
              r={selected ? 5 : 3.5}
              fill={fill}
              fillOpacity={activeId && !selected ? 0.35 : 0.9}
              stroke={selected ? 'currentColor' : 'none'}
              strokeWidth={1.2}
              className={onSelect ? 'cursor-pointer transition-all' : undefined}
              onClick={() => onSelect?.(event.id)}
            >
              <title>{`${event.provider ?? 'unknown'} • ${new Date(event.timestamp).toLocaleString()}`}</title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
}
