import { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

export function D3CardFrame(props: {
  title: string;
  subtitle?: string;
  rightSlot?: ReactNode;
  className?: string;
  heightClassName?: string;
  children: ReactNode;
}) {
  const { title, subtitle, rightSlot, className, heightClassName, children } = props;
  return (
    <article className={cn('rounded-lg border border-slate-200/80 bg-white/90 p-2.5 shadow-sm dark:border-border/70 dark:bg-background/80', className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold text-foreground">{title}</p>
          {subtitle ? <p className="truncate text-[10px] text-muted-foreground">{subtitle}</p> : null}
        </div>
        {rightSlot}
      </div>
      <div className={cn('h-[160px] min-h-0', heightClassName)}>{children}</div>
    </article>
  );
}
