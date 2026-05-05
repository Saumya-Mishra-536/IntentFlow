import { ai_chat_provider, campaign_api } from "@/lib/api";

const CAMPAIGN_CHAT_PROVIDER_MAP_KEY = "ai_seo_campaign_chat_provider_map";
const CAMPAIGN_CHAT_PROVIDER_SYNC_KEY = "ai_seo_campaign_chat_provider_synced";

const provider_urls: Record<Exclude<ai_chat_provider, "unknown">, string> = {
  chatgpt: "https://chatgpt.com/",
  claude: "https://claude.ai/new",
  gemini: "https://gemini.google.com/app",
  perplexity: "https://www.perplexity.ai/",
  grok: "https://grok.com/",
};

const provider_labels: Record<Exclude<ai_chat_provider, "unknown">, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
  grok: "Grok",
};

/** Paths relative to extension public root. One logo per provider — dark-mode friendly. */
const provider_logos: Record<Exclude<ai_chat_provider, "unknown">, string> = {
  chatgpt: "/chatgpt.svg",
  claude: "/claude.svg",
  gemini: "/gemini-light.svg",
  perplexity: "/perplexity.svg",
  grok: "/grok-(xai).svg",
};

const read_provider_map = (): Record<string, ai_chat_provider> => {
  try {
    const raw = localStorage.getItem(CAMPAIGN_CHAT_PROVIDER_MAP_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, string>;
    const sanitized: Record<string, ai_chat_provider> = {};
    Object.entries(parsed).forEach(([campaign_id, provider]) => {
      if (provider in provider_urls) {
        sanitized[campaign_id] = provider as ai_chat_provider;
      }
    });
    return sanitized;
  } catch {
    return {};
  }
};

const write_provider_map = (next_map: Record<string, ai_chat_provider>) => {
  localStorage.setItem(CAMPAIGN_CHAT_PROVIDER_MAP_KEY, JSON.stringify(next_map));
};

const provider_ids = Object.keys(provider_urls) as Array<Exclude<ai_chat_provider, "unknown">>;

const read_sync_map = (): Record<string, boolean> => {
  try {
    const raw = localStorage.getItem(CAMPAIGN_CHAT_PROVIDER_SYNC_KEY);
    if (!raw) {
      return {};
    }
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return {};
  }
};

const write_sync_map = (next_map: Record<string, boolean>) => {
  localStorage.setItem(CAMPAIGN_CHAT_PROVIDER_SYNC_KEY, JSON.stringify(next_map));
};

const normalize_url_for_match = (raw: string): string | null => {
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    const normalized_path = parsed.pathname.replace(/\/+$/, "");
    parsed.pathname = normalized_path || "/";
    return parsed.toString();
  } catch {
    return null;
  }
};

const is_same_chat_target = (candidate_url: string, target_url: string): boolean => {
  const normalized_candidate = normalize_url_for_match(candidate_url);
  const normalized_target = normalize_url_for_match(target_url);
  if (!normalized_candidate || !normalized_target) {
    return false;
  }
  if (normalized_candidate === normalized_target) {
    return true;
  }
  // For provider home links, treat same-origin tabs as equivalent.
  try {
    const candidate = new URL(normalized_candidate);
    const target = new URL(normalized_target);
    const target_is_provider_home =
      target.pathname === "/" || target.pathname === "/new" || target.pathname === "/app";
    return target_is_provider_home && candidate.origin === target.origin;
  } catch {
    return false;
  }
};

export const campaign_chat = {
  get_provider: (campaign_id: string): ai_chat_provider | null => {
    const map = read_provider_map();
    return map[campaign_id] ?? null;
  },
  set_provider: (params: { campaign_id: string; provider: ai_chat_provider }) => {
    const map = read_provider_map();
    map[params.campaign_id] = params.provider;
    write_provider_map(map);
  },
  list_local_provider_mappings: (): Array<{ campaign_id: string; provider: ai_chat_provider }> => {
    const map = read_provider_map();
    return Object.entries(map).map(([campaign_id, provider]) => ({ campaign_id, provider }));
  },
  list_providers: (): Array<{ id: Exclude<ai_chat_provider, "unknown">; label: string }> =>
    provider_ids.map((id) => ({
      id,
      label: provider_labels[id],
    })),
  provider_label: (provider: ai_chat_provider): string =>
    provider === "unknown" ? "Unknown" : provider_labels[provider],
  provider_logo: (provider: ai_chat_provider): string | undefined =>
    provider === "unknown" ? undefined : provider_logos[provider],
  provider_url: (provider: ai_chat_provider): string | undefined =>
    provider === "unknown" ? undefined : provider_urls[provider],
  open_tab: async (provider: ai_chat_provider, explicit_url?: string) => {
    const url = explicit_url ?? (provider === "unknown" ? undefined : provider_urls[provider]);
    if (!url) {
      return;
    }
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find((tab) => tab.url && is_same_chat_target(tab.url, url));
    if (existing?.id != null) {
      await chrome.tabs.update(existing.id, { active: true });
      if (existing.windowId != null) {
        await chrome.windows.update(existing.windowId, { focused: true });
      }
      return;
    }
    await chrome.tabs.create({ url, active: true });
  },
  sync_legacy_provider_map_to_db: async (valid_campaign_ids?: string[]) => {
    const valid_set = valid_campaign_ids ? new Set(valid_campaign_ids) : null;
    const mappings = campaign_chat
      .list_local_provider_mappings()
      .filter((item) => (valid_set ? valid_set.has(item.campaign_id) : true));
    if (!mappings.length) {
      return;
    }
    if (valid_set) {
      const filtered_provider_map = Object.fromEntries(mappings.map((item) => [item.campaign_id, item.provider]));
      write_provider_map(filtered_provider_map);
    }
    const synced = read_sync_map();
    if (valid_set) {
      Object.keys(synced).forEach((campaign_id) => {
        if (!valid_set.has(campaign_id)) {
          delete synced[campaign_id];
        }
      });
    }
    await Promise.all(
      mappings.map(async ({ campaign_id, provider }) => {
        if (synced[campaign_id]) {
          return;
        }
        try {
          await campaign_api.link_chat_thread(campaign_id, undefined, { chat_provider: provider });
          synced[campaign_id] = true;
        } catch {
          // Best effort sync.
        }
      }),
    );
    write_sync_map(synced);
  },
};
