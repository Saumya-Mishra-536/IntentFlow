import { useMemo } from 'react';
import { useChartSize } from '@/shared/components/d3/useChartSize';

type ScatterPoint = {
  id: string;
  label: string;
  x: number;
  y: number;
  size: number;
  color?: string;
};

export function ScatterOpportunityChart(props: {
  points: ScatterPoint[];
  activeId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const { points, activeId, onSelect } = props;
  const { ref, width, height } = useChartSize<HTMLDivElement>();

  const bounds = useMemo(() => {
    const xs = points.map((item) => item.x);
    const ys = points.map((item) => item.y);
    const ss = points.map((item) => item.size);
    return {
      xMin: Math.min(...xs, 0),
      xMax: Math.max(...xs, 1),
      yMin: Math.min(...ys, 0),
      yMax: Math.max(...ys, 1),
      sMin: Math.min(...ss, 1),
      sMax: Math.max(...ss, 1),
    };
  }, [points]);

  const left = 18;
  const top = 8;
  const chartW = Math.max(width - left - 8, 1);
  const chartH = Math.max(height - top - 14, 1);

  const scaleX = (value: number) => left + ((value - bounds.xMin) / Math.max(bounds.xMax - bounds.xMin, 1e-9)) * chartW;
  const scaleY = (value: number) => top + chartH - ((value - bounds.yMin) / Math.max(bounds.yMax - bounds.yMin, 1e-9)) * chartH;
  const scaleR = (value: number) => 4 + ((value - bounds.sMin) / Math.max(bounds.sMax - bounds.sMin, 1e-9)) * 10;

  return (
    <div ref={ref} className="h-full w-full">
      <svg width={Math.max(width, 10)} height={Math.max(height, 10)}>
        <line x1={left} x2={left + chartW} y1={top + chartH} y2={top + chartH} stroke="currentColor" opacity={0.25} />
        <line x1={left} x2={left} y1={top} y2={top + chartH} stroke="currentColor" opacity={0.25} />
        {points.map((point) => {
          const selected = activeId === point.id;
          return (
            <g key={point.id}>
              <circle
                cx={scaleX(point.x)}
                cy={scaleY(point.y)}
                r={scaleR(point.size)}
                fill={point.color ?? '#f59e0b'}
                fillOpacity={activeId && !selected ? 0.3 : 0.72}
                stroke={selected ? 'currentColor' : 'none'}
                strokeWidth={1.2}
                className={onSelect ? 'cursor-pointer transition-all' : undefined}
                onClick={() => onSelect?.(point.id)}
              >
                <title>{`${point.label} • x:${point.x.toFixed(1)} y:${point.y.toFixed(1)}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
