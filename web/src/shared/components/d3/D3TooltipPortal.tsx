import { ReactNode } from 'react';

export function D3TooltipPortal(props: {
  open: boolean;
  x: number;
  y: number;
  children: ReactNode;
}) {
  const { open, x, y, children } = props;
  if (!open) return null;

  return (
    <div
      className="pointer-events-none absolute z-20 rounded-md border border-slate-200 bg-white/95 px-2 py-1 text-[10px] shadow-md dark:border-border/70 dark:bg-background/95"
      style={{ left: x, top: y, transform: 'translate(10px, -110%)' }}
    >
      {children}
    </div>
  );
}
