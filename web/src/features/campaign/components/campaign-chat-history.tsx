import { useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Skeleton } from '@/shared/components/ui/skeleton';
import TextShimmer from '@/shared/components/ui/text-shimmer';
import { auth_storage, ChatThreadSummary, get_campaign_chat_threads, mark_campaign_chat_thread_opened } from '@/shared/lib/auth';

import chatgptLogo from '/chatgpt.svg';
import claudeLogo from '/claude.svg';
import geminiLogo from '/gemini-light.svg';
import perplexityLogo from '/perplexity.svg';
import grokLogo from '/grok-(xai).svg';

const provider_labels: Record<string, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
  grok: 'Grok',
  unknown: 'Unknown',
};

const provider_logos: Record<string, string | null> = {
  chatgpt: chatgptLogo,
  claude: claudeLogo,
  gemini: geminiLogo,
  perplexity: perplexityLogo,
  grok: grokLogo,
  unknown: null,
};

const provider_home_urls: Record<string, string | undefined> = {
  chatgpt: 'https://chatgpt.com/',
  claude: 'https://claude.ai/new',
  gemini: 'https://gemini.google.com/app',
  perplexity: 'https://www.perplexity.ai/',
  grok: 'https://grok.com/',
  unknown: undefined,
};

const format_date_time = (value?: string | null): string => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString();
};

export function CampaignChatHistory({ campaign_id, version_id }: { campaign_id: string; version_id?: string }) {
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [provider_filter, setProviderFilter] = useState<'all' | keyof typeof provider_labels>('all');

  const load_threads = async () => {
    const access_token = auth_storage.get_access_token();
    if (!access_token) {
      setError('Missing access token');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const payload = await get_campaign_chat_threads(access_token, campaign_id, { version_id, limit: 50, offset: 0 });
      setThreads(payload.threads);
    } catch (load_error) {
      setError(load_error instanceof Error ? load_error.message : 'Failed to load chat history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load_threads();
  }, [campaign_id, version_id]);

  const filtered_threads = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return threads.filter((thread) => {
      if (provider_filter !== 'all' && thread.chat_provider !== provider_filter) {
        return false;
      }
      if (!normalized) {
        return true;
      }
      const haystack = `${thread.chat_title ?? ''} ${thread.chat_url ?? ''} ${thread.conversation_id}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [threads, query, provider_filter]);

  const open_chat = async (thread: ChatThreadSummary) => {
    const target = thread.chat_url ?? provider_home_urls[thread.chat_provider];
    if (!target) {
      return;
    }
    window.open(target, '_blank', 'noopener,noreferrer');
    const access_token = auth_storage.get_access_token();
    if (access_token) {
      void mark_campaign_chat_thread_opened(access_token, campaign_id, thread.chat_thread_id);
    }
  };

  return (
    <section className="dashboard-surface flex h-full flex-col w-[320px] rounded-xl border border-border/70 p-3">
      <div className="mb-3 flex items-center justify-between gap-2 shrink-0">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Chat History</p>
          <p className="text-xs text-muted-foreground">Campaign-linked AI chats</p>
        </div>
        <Button variant="outline" size="sm" className="h-8 text-xs shrink-0" onClick={() => void load_threads()}>
          Refresh
        </Button>
      </div>
      <div className="mb-2 flex flex-wrap gap-1 shrink-0">
        {(['all', 'chatgpt', 'claude', 'gemini', 'perplexity', 'grok', 'unknown'] as const).map((provider) => (
          <button
            key={provider}
            type="button"
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] uppercase transition-colors ${provider_filter === provider
              ? 'border-primary bg-primary/15 text-foreground'
              : 'border-border text-muted-foreground hover:bg-muted/30'
              }`}
            onClick={() => setProviderFilter(provider)}
            title={provider === 'all' ? 'All' : provider_labels[provider]}
          >
            {provider !== 'all' && provider_logos[provider] && (
              <img src={provider_logos[provider]!} alt={provider_labels[provider]} className="h-3 w-3 object-contain" />
            )}
            {provider === 'all' ? 'All' : provider_labels[provider]}
          </button>
        ))}
      </div>
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="mb-2 h-8 text-xs shrink-0"
        placeholder="Search by title, URL, or id"
      />
      {error ? <p className="mb-2 text-xs text-red-400 shrink-0">{error}</p> : null}
      {loading ? (
        <div className="flex-1 flex flex-col gap-2 overflow-hidden px-1">
          <div className="flex items-center justify-center p-2">
            <TextShimmer className="text-xs font-medium" duration={1.5}>
              Loading chat history...
            </TextShimmer>
          </div>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-md border border-border bg-background/40 p-2 space-y-2">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-12" />
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
              <div className="pt-2">
                <Skeleton className="h-7 w-24 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : !filtered_threads.length ? (
        <div className="flex-1 flex items-center justify-center text-center p-4">
          <p className="text-xs text-muted-foreground">No chat threads found for this campaign.</p>
        </div>
      ) : (
        <div className="flex-1 space-y-1 overflow-y-auto pr-1">
          {filtered_threads.map((thread) => (
            <div key={thread.chat_thread_id} className="rounded-md border border-border bg-background/40 px-2 py-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <Badge variant="outline" className="text-[10px]">
                  {provider_labels[thread.chat_provider]}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {thread.turn_count} turns
                </Badge>
              </div>
              <p className="line-clamp-2 text-xs text-foreground" title={thread.chat_title || thread.chat_url || thread.conversation_id}>{thread.chat_title || thread.chat_url || thread.conversation_id}</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Last active: {format_date_time(thread.last_event_at || thread.started_at)}
              </p>
              <Button variant="ghost" size="sm" className="mt-1 h-7 px-1 text-xs" onClick={() => void open_chat(thread)}>
                <ExternalLink className="mr-1 h-3.5 w-3.5" />
                Open Chat
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
