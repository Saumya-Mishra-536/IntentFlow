import { useMemo } from 'react';
import { useChartSize } from '@/shared/components/d3/useChartSize';

type FunnelStep = {
  key: string;
  label: string;
  value: number;
  color?: string;
};

export function FunnelChart(props: {
  steps: FunnelStep[];
  activeKey?: string | null;
  onSelect?: (key: string) => void;
}) {
  const { steps, activeKey, onSelect } = props;
  const { ref, width, height } = useChartSize<HTMLDivElement>();
  const max = Math.max(1, ...steps.map((step) => step.value));
  const inner = useMemo(() => {
    const padX = 8;
    const padY = 8;
    const gap = 6;
    const rowH = Math.max(16, (height - padY * 2 - gap * (steps.length - 1)) / Math.max(1, steps.length));
    return steps.map((step, index) => {
      const y = padY + index * (rowH + gap);
      const barW = ((width - padX * 2) * step.value) / max;
      return { ...step, y, rowH, barW, x: padX };
    });
  }, [height, max, steps, width]);

  return (
    <div ref={ref} className="h-full w-full">
      <svg width={Math.max(width, 10)} height={Math.max(height, 10)}>
        {inner.map((row) => (
          <g key={row.key}>
            <rect
              x={row.x}
              y={row.y}
              width={Math.max(row.barW, 2)}
              height={Math.max(row.rowH, 1)}
              rx={5}
              fill={row.color ?? '#3b82f6'}
              fillOpacity={activeKey && activeKey !== row.key ? 0.35 : 0.85}
              className={onSelect ? 'cursor-pointer transition-opacity' : undefined}
              onClick={() => onSelect?.(row.key)}
            />
            <text x={row.x + 8} y={row.y + row.rowH / 2 + 3} fontSize="10" fill="currentColor" style={{ pointerEvents: 'none' }}>
              {row.label}
            </text>
            <text
              x={row.x + Math.max(row.barW - 6, 14)}
              y={row.y + row.rowH / 2 + 3}
              textAnchor="end"
              fontSize="10"
              fill="currentColor"
              style={{ pointerEvents: 'none' }}
            >
              {row.value}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
