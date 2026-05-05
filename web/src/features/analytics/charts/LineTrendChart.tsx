import { useMemo } from 'react';
import { useChartSize } from '@/shared/components/d3/useChartSize';

type LineSeries = {
  key: string;
  color: string;
  values: Array<{ x: string; y: number }>;
};

export function LineTrendChart(props: {
  series: LineSeries[];
  activeKey?: string | null;
  onSelectSeries?: (key: string) => void;
}) {
  const { series, activeKey, onSelectSeries } = props;
  const { ref, width, height } = useChartSize<HTMLDivElement>();

  const points = useMemo(() => {
    const xKeys = Array.from(new Set(series.flatMap((item) => item.values.map((value) => value.x)))).sort();
    const yMax = Math.max(1, ...series.flatMap((item) => item.values.map((value) => value.y)));
    const left = 14;
    const top = 8;
    const chartW = Math.max(width - left - 8, 1);
    const chartH = Math.max(height - top - 12, 1);
    const xPos = (x: string) => {
      const index = xKeys.indexOf(x);
      return left + (xKeys.length <= 1 ? 0 : (index / (xKeys.length - 1)) * chartW);
    };
    const yPos = (y: number) => top + chartH - (y / yMax) * chartH;

    return {
      series: series.map((entry) => {
        const path = entry.values
          .map((value, index) => `${index === 0 ? 'M' : 'L'} ${xPos(value.x)} ${yPos(value.y)}`)
          .join(' ');
        return { ...entry, path };
      }),
    };
  }, [height, series, width]);

  return (
    <div ref={ref} className="h-full w-full">
      <svg width={Math.max(width, 10)} height={Math.max(height, 10)}>
        {points.series.map((entry) => (
          <g key={entry.key}>
            <path
              d={entry.path}
              fill="none"
              stroke={entry.color}
              strokeWidth={activeKey === entry.key ? 2.4 : 1.7}
              strokeOpacity={activeKey && activeKey !== entry.key ? 0.25 : 0.9}
              className={onSelectSeries ? 'cursor-pointer' : undefined}
              onClick={() => onSelectSeries?.(entry.key)}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}
