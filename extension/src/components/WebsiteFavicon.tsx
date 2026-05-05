import { Globe } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

type WebsiteFaviconProps = {
  url: string;
  host?: string;
  className?: string;
  imageClassName?: string;
  iconClassName?: string;
};

const normalize_url = (raw_url: string): URL | null => {
  try {
    return new URL(raw_url);
  } catch {
    try {
      return new URL(`https://${raw_url}`);
    } catch {
      return null;
    }
  }
};

export default function WebsiteFavicon({
  url,
  host,
  className,
  imageClassName,
  iconClassName,
}: WebsiteFaviconProps) {
  const [source_index, set_source_index] = useState(0);
  useEffect(() => {
    set_source_index(0);
  }, [url]);

  const parsed = useMemo(() => normalize_url(url), [url]);
  const sources = useMemo(() => {
    if (!parsed) return [];
    return [
      `${parsed.origin}/favicon.ico`,
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=64`,
    ];
  }, [parsed]);

  const current_source = source_index < sources.length ? sources[source_index] : null;
  const label = host || parsed?.hostname || 'Website';

  return (
    <span
      className={cn(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-background/80',
        className,
      )}
      aria-hidden="true"
    >
      {current_source ? (
        <img
          src={current_source}
          alt={`${label} favicon`}
          className={cn('h-full w-full object-cover', imageClassName)}
          onError={() => set_source_index((index) => index + 1)}
          loading="lazy"
        />
      ) : (
        <Globe className={cn('h-3.5 w-3.5 text-muted-foreground', iconClassName)} />
      )}
    </span>
  );
}
