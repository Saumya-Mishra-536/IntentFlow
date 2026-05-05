import { useMemo } from 'react';
import { useChartSize } from '@/shared/components/d3/useChartSize';

type Segment = {
  key: string;
  label: string;
  value: number;
  color: string;
};

type Row = {
  id: string;
  label: string;
  segments: Segment[];
};

export function StackedBarChart(props: {
  rows: Row[];
  normalized?: boolean;
  activeKey?: string | null;
  onSelectSegment?: (segmentKey: string) => void;
}) {
  const { rows, normalized, activeKey, onSelectSegment } = props;
  const { ref, width, height } = useChartSize<HTMLDivElement>();

  const max = useMemo(() => {
    if (normalized) return 1;
    return Math.max(1, ...rows.map((row) => row.segments.reduce((sum, segment) => sum + segment.value, 0)));
  }, [normalized, rows]);

  const left = 70;
  const top = 8;
  const rowGap = 8;
  const chartW = Math.max(width - left - 8, 1);
  const rowH = rows.length ? Math.max(14, (height - top - 8 - rowGap * (rows.length - 1)) / rows.length) : 14;

  return (
    <div ref={ref} className="h-full w-full">
      <svg width={Math.max(width, 10)} height={Math.max(height, 10)}>
        {rows.map((row, rowIndex) => {
          const y = top + rowIndex * (rowH + rowGap);
          const total = row.segments.reduce((sum, segment) => sum + segment.value, 0);
          let cursor = left;
          return (
            <g key={row.id}>
              <text x={left - 6} y={y + rowH / 2 + 3} textAnchor="end" fontSize="10" fill="currentColor">
                {row.label}
              </text>
              {row.segments.map((segment) => {
                const ratio = normalized ? (total ? segment.value / total : 0) : segment.value / max;
                const w = ratio * chartW;
                const node = (
                  <rect
                    key={`${row.id}-${segment.key}`}
                    x={cursor}
                    y={y}
                    width={Math.max(w, 0)}
                    height={rowH}
                    rx={2}
                    fill={segment.color}
                    fillOpacity={activeKey && activeKey !== segment.key ? 0.3 : 0.85}
                    className={onSelectSegment ? 'cursor-pointer transition-opacity' : undefined}
                    onClick={() => onSelectSegment?.(segment.key)}
                  >
                    <title>{`${segment.label}: ${segment.value}`}</title>
                  </rect>
                );
                cursor += w;
                return node;
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
