import { useMemo } from 'react';
import { useChartSize } from '@/shared/components/d3/useChartSize';

type RankRow = {
  id: string;
  label: string;
  value: number;
  secondaryValue?: number;
};

export function RankBarChart(props: {
  rows: RankRow[];
  activeId?: string | null;
  onSelect?: (id: string) => void;
  color?: string;
}) {
  const { rows, activeId, onSelect, color = '#10b981' } = props;
  const { ref, width, height } = useChartSize<HTMLDivElement>();

  const sorted = useMemo(() => [...rows].sort((a, b) => b.value - a.value).slice(0, 10), [rows]);
  const max = Math.max(1, ...sorted.map((item) => item.value));

  const left = 92;
  const top = 8;
  const rowGap = 6;
  const chartW = Math.max(width - left - 8, 1);
  const rowH = sorted.length ? Math.max(12, (height - top - 8 - rowGap * (sorted.length - 1)) / sorted.length) : 12;

  return (
    <div ref={ref} className="h-full w-full">
      <svg width={Math.max(width, 10)} height={Math.max(height, 10)}>
        {sorted.map((row, index) => {
          const y = top + index * (rowH + rowGap);
          const barW = (row.value / max) * chartW;
          const selected = activeId === row.id;
          return (
            <g key={row.id}>
              <text x={left - 6} y={y + rowH / 2 + 3} textAnchor="end" fontSize="10" fill="currentColor">
                {row.label}
              </text>
              <rect
                x={left}
                y={y}
                width={Math.max(barW, 2)}
                height={rowH}
                rx={4}
                fill={color}
                fillOpacity={activeId && !selected ? 0.3 : 0.85}
                className={onSelect ? 'cursor-pointer transition-opacity' : undefined}
                onClick={() => onSelect?.(row.id)}
              >
                <title>{`${row.value}${row.secondaryValue !== undefined ? ` / ${row.secondaryValue}` : ''}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
