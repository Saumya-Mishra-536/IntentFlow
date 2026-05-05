import { useMemo } from 'react';
import { useChartSize } from '@/shared/components/d3/useChartSize';

type HeatBin = {
  day: string;
  hour: number;
  count: number;
};

export function HeatmapChart(props: {
  bins: HeatBin[];
  onSelectDay?: (day: string) => void;
  activeDay?: string | null;
}) {
  const { bins, onSelectDay, activeDay } = props;
  const { ref, width, height } = useChartSize<HTMLDivElement>();

  const { rows, max } = useMemo(() => {
    const byDay = new Map<string, Map<number, number>>();
    for (const bin of bins) {
      const row = byDay.get(bin.day) ?? new Map<number, number>();
      row.set(bin.hour, bin.count);
      byDay.set(bin.day, row);
    }
    const days = Array.from(byDay.keys()).sort();
    const maxCount = Math.max(1, ...bins.map((bin) => bin.count));
    return { rows: days.map((day) => ({ day, cells: byDay.get(day)! })), max: maxCount };
  }, [bins]);

  const left = 58;
  const top = 8;
  const chartW = Math.max(1, width - left - 8);
  const chartH = Math.max(1, height - top - 8);
  const rowH = rows.length ? chartH / rows.length : chartH;
  const colW = chartW / 24;

  return (
    <div ref={ref} className="h-full w-full">
      <svg width={Math.max(width, 10)} height={Math.max(height, 10)}>
        {rows.map((row, rowIndex) => {
          const y = top + rowIndex * rowH;
          return (
            <g key={row.day}>
              <text
                x={left - 4}
                y={y + rowH / 2 + 3}
                textAnchor="end"
                fontSize="10"
                fill="currentColor"
                className={onSelectDay ? 'cursor-pointer' : undefined}
                onClick={() => onSelectDay?.(row.day)}
              >
                {row.day.slice(5)}
              </text>
              {Array.from({ length: 24 }).map((_, hour) => {
                const count = row.cells.get(hour) ?? 0;
                const opacity = count === 0 ? 0.06 : 0.18 + (count / max) * 0.82;
                return (
                  <rect
                    key={`${row.day}-${hour}`}
                    x={left + hour * colW}
                    y={y}
                    width={Math.max(colW - 1, 1)}
                    height={Math.max(rowH - 1, 1)}
                    rx={2}
                    fill="#3b82f6"
                    fillOpacity={activeDay && activeDay !== row.day ? opacity * 0.35 : opacity}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
