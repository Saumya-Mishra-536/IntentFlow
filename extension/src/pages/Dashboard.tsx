import { KeyboardEvent, MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import AppHeader from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowUpRight, ChevronRight, MoreVertical, Plus } from "lucide-react";
import { extension_auth } from "@/lib/auth";
import { account_api, ai_chat_provider, campaign_api, CampaignSummary, domain_api, DomainSummary } from "@/lib/api";
import { campaign_chat } from "@/lib/campaign-chat";

const ai_labs = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    url: "https://chatgpt.com/",
    logo: "/chatgpt.svg",
  },
  {
    id: "claude",
    name: "Claude",
    url: "https://claude.ai/new",
    logo: "/claude.svg",
  },
  {
    id: "gemini",
    name: "Gemini",
    url: "https://gemini.google.com/app",
    logo: "/gemini-light.svg",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    url: "https://www.perplexity.ai/",
    logo: "/perplexity.svg",
  },
  {
    id: "grok",
    name: "Grok",
    url: "https://grok.com/",
    logo: "/grok-(xai).svg",
  },
] as const;

const capture_supported_providers: ai_chat_provider[] = ["chatgpt", "claude", "perplexity", "grok"];
const DOMAIN_SELECTION_KEY = "ai_seo_selected_domain_id";

interface DashboardToast {
  type: "success" | "error";
  message: string;
}

function ProviderInlineLabel({ provider }: { provider: ai_chat_provider }) {
  const logo = campaign_chat.provider_logo(provider);
  const label = campaign_chat.provider_label(provider);
  return (
    <span className="inline-flex items-center gap-1.5">
      {logo ? <img src={logo} alt={label} className="h-3.5 w-3.5 object-contain" /> : null}
      <span>{label}</span>
    </span>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeMenuCampaignId, setActiveMenuCampaignId] = useState<string | null>(null);
  const [isUpdatingCampaignId, setIsUpdatingCampaignId] = useState<string | null>(null);
  const [isDeletingCampaignId, setIsDeletingCampaignId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [profileName, setProfileName] = useState("Intent user");
  const [profileImageUrl, setProfileImageUrl] = useState("");
  const [campaignProvidersMap, setCampaignProvidersMap] = useState<Record<string, ai_chat_provider[]>>({});
  const [chat_flow_provider, setChatFlowProvider] = useState<ai_chat_provider | null>(null);
  const [chat_flow_open, setChatFlowOpen] = useState(false);
  const [chat_flow_mode, setChatFlowMode] = useState<"select" | "new" | "existing">("select");
  const [chat_flow_campaign_name, setChatFlowCampaignName] = useState("");
  const [chat_flow_campaign_description, setChatFlowCampaignDescription] = useState("");
  const [chat_flow_domain_id, setChatFlowDomainId] = useState("");
  const [chat_flow_selected_campaign_id, setChatFlowSelectedCampaignId] = useState<string | null>(null);
  const [is_chat_flow_submitting, setIsChatFlowSubmitting] = useState(false);
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [selected_domain_id, setSelectedDomainId] = useState<string>(() => localStorage.getItem(DOMAIN_SELECTION_KEY) ?? "");
  const [memberships, setMemberships] = useState<Array<{ tenant_id: string; slug: string; name: string; member_role: string }>>([]);
  const [active_tenant_id, setActiveTenantId] = useState<string | null>(extension_auth.get_active_account()?.tenant_id ?? null);
  const [toast, setToast] = useState<DashboardToast | null>(null);
  const [editingCampaign, setEditingCampaign] = useState<CampaignSummary | null>(null);
  const [editCampaignName, setEditCampaignName] = useState("");
  const [editCampaignDescription, setEditCampaignDescription] = useState("");
  const [deletingCampaign, setDeletingCampaign] = useState<CampaignSummary | null>(null);
  const lastAutoRefreshAtRef = useRef(0);

  const showToast = (next: DashboardToast) => {
    setToast(next);
    window.setTimeout(() => {
      setToast((current) => (current?.message === next.message ? null : current));
    }, 3200);
  };

  const loadCampaigns = async (options?: { silent?: boolean; domain_id?: string }) => {
    const silent = options?.silent ?? false;
    const domain_id = options?.domain_id ?? selected_domain_id;
    if (!silent) {
      setIsLoading(true);
    }
    setErrorMessage("");
    try {
      const payload = await campaign_api.get_campaigns(domain_id ? { domain_id } : undefined);
      setCampaigns(payload);
      void campaign_chat.sync_legacy_provider_map_to_db(payload.map((item) => item.id));
      const provider_entries = await Promise.all(
        payload.map(async (campaign) => {
          try {
            const thread_payload = await campaign_api.get_chat_threads(campaign.id, { limit: 20, offset: 0 });
            const providers = Array.from(
              new Set(thread_payload.threads.map((item) => item.chat_provider).filter((provider) => provider !== "unknown")),
            ) as ai_chat_provider[];
            return [campaign.id, providers] as const;
          } catch {
            return [campaign.id, []] as const;
          }
        }),
      );
      setCampaignProvidersMap(Object.fromEntries(provider_entries));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load campaigns");
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  };

  const loadAccountContext = async () => {
    try {
      const [domain_rows, membership_rows] = await Promise.all([
        domain_api.get_domains().catch(() => []),
        account_api.get_memberships().catch(() => []),
      ]);
      setDomains(domain_rows);
      const normalized_memberships = membership_rows.map((item) => ({
        tenant_id: item.account.tenant_id,
        slug: item.account.slug,
        name: item.account.name,
        member_role: item.role,
      }));
      setMemberships(normalized_memberships);
      const stored_active = extension_auth.get_active_account()?.tenant_id;
      setActiveTenantId(stored_active ?? normalized_memberships[0]?.tenant_id ?? null);
      const stored_domain_id = localStorage.getItem(DOMAIN_SELECTION_KEY) ?? "";
      const resolved_domain_id = domain_rows.some((domain) => domain.domain_id === stored_domain_id)
        ? stored_domain_id
        : (domain_rows[0]?.domain_id ?? "");
      setSelectedDomainId(resolved_domain_id);
      localStorage.setItem(DOMAIN_SELECTION_KEY, resolved_domain_id);
      if (!chat_flow_domain_id || !domain_rows.some((domain) => domain.domain_id === chat_flow_domain_id)) {
        setChatFlowDomainId(resolved_domain_id);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load account context");
    }
  };

  useEffect(() => {
    void loadCampaigns();
    void loadAccountContext();
    try {
      const user_raw = localStorage.getItem("ai_seo_user");
      if (user_raw) {
        const parsed = JSON.parse(user_raw) as { name?: string; email?: string; avatar_url?: string; picture?: string };
        setProfileName(parsed.name?.trim() || parsed.email?.trim() || "Intent user");
        setProfileImageUrl(parsed.avatar_url?.trim() || parsed.picture?.trim() || "");
      }
    } catch {
      // Ignore malformed profile payload.
    }
  }, []);

  useEffect(() => {
    if (!selected_domain_id) return;
    void loadCampaigns({ silent: true, domain_id: selected_domain_id });
  }, [selected_domain_id]);

  useEffect(() => {
    const on_focus = () => {
      const now = Date.now();
      if (now - lastAutoRefreshAtRef.current < 2500) {
        return;
      }
      lastAutoRefreshAtRef.current = now;
      void loadCampaigns({ silent: true });
    };
    const on_visibility = () => {
      if (document.visibilityState === "visible") {
        const now = Date.now();
        if (now - lastAutoRefreshAtRef.current < 2500) {
          return;
        }
        lastAutoRefreshAtRef.current = now;
        void loadCampaigns({ silent: true });
      }
    };
    window.addEventListener("focus", on_focus);
    document.addEventListener("visibilitychange", on_visibility);
    return () => {
      window.removeEventListener("focus", on_focus);
      document.removeEventListener("visibilitychange", on_visibility);
    };
  }, []);

  useEffect(() => {
    if (!activeMenuCampaignId) {
      return;
    }
    const on_pointer_down = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-campaign-menu-root='true']")) {
        return;
      }
      setActiveMenuCampaignId(null);
    };
    window.addEventListener("mousedown", on_pointer_down);
    return () => {
      window.removeEventListener("mousedown", on_pointer_down);
    };
  }, [activeMenuCampaignId]);

  const handleLogout = () => {
    extension_auth.clear_auth_session();
    navigate("/");
  };

  const handleCreateCampaign = async () => {
    if (!domains.length) {
      setErrorMessage("No domains found. Open web onboarding to add a domain.");
      return;
    }
    setErrorMessage("");
    setChatFlowProvider(null);
    setChatFlowOpen(true);
    setChatFlowMode("new");
    setChatFlowCampaignName("");
    setChatFlowCampaignDescription("");
    setChatFlowDomainId(selected_domain_id || domains[0]?.domain_id || "");
    setChatFlowSelectedCampaignId(null);
  };

  const close_chat_flow = () => {
    if (is_chat_flow_submitting) {
      return;
    }
    setChatFlowOpen(false);
    setChatFlowMode("select");
    setChatFlowCampaignName("");
    setChatFlowCampaignDescription("");
    setChatFlowDomainId(domains[0]?.domain_id ?? "");
    setChatFlowSelectedCampaignId(null);
    setChatFlowProvider(null);
  };

  const handle_start_chat = (provider: ai_chat_provider) => {
    if (!capture_supported_providers.includes(provider)) {
      setErrorMessage(`${campaign_chat.provider_label(provider)} capture is coming soon in extension. Use ChatGPT, Claude, Perplexity, or Grok for now.`);
      return;
    }
    setErrorMessage("");
    setChatFlowProvider(provider);
    setChatFlowOpen(true);
    setChatFlowMode("select");
    setChatFlowCampaignName("");
    setChatFlowCampaignDescription("");
    setChatFlowDomainId(selected_domain_id || domains[0]?.domain_id || "");
    setChatFlowSelectedCampaignId(null);
  };

  const start_listening_with_provider = async (campaign: CampaignSummary, provider: ai_chat_provider) => {
    campaign_chat.set_provider({ campaign_id: campaign.id, provider });
    setCampaignProvidersMap((prev) => {
      const current = prev[campaign.id] ?? [];
      return {
        ...prev,
        [campaign.id]: current.includes(provider) ? current : [...current, provider],
      };
    });
    try {
      await campaign_api.link_chat_thread(campaign.id, undefined, {
        chat_provider: provider,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to link chat thread");
    }
    try {
      await campaign_chat.open_tab(provider);
    } catch {
      // Best effort.
    }
    navigate("/visualization/new", {
      state: {
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        session_nonce: Date.now(),
        chat_provider: provider,
      },
    });
  };

  const submit_chat_flow_new_campaign = async () => {
    if (!chat_flow_provider) {
      setErrorMessage("Choose a chat provider first.");
      return;
    }
    if (!chat_flow_campaign_name.trim()) {
      setErrorMessage("Campaign name is required.");
      return;
    }
    if (!chat_flow_domain_id) {
      setErrorMessage("Domain is required.");
      return;
    }
    setIsChatFlowSubmitting(true);
    setErrorMessage("");
    try {
      const created = await campaign_api.create_campaign({
        domain_id: chat_flow_domain_id,
        name: chat_flow_campaign_name.trim(),
        description: chat_flow_campaign_description.trim() || undefined,
      });
      setCampaigns((prev) => [created, ...prev]);
      setCampaignProvidersMap((prev) => ({
        ...prev,
        [created.id]: chat_flow_provider ? [chat_flow_provider] : [],
      }));
      setChatFlowOpen(false);
      await start_listening_with_provider(created, chat_flow_provider);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create campaign");
    } finally {
      setIsChatFlowSubmitting(false);
    }
  };

  const submit_chat_flow_existing_campaign = async () => {
    if (!chat_flow_provider) {
      setErrorMessage("Choose a chat provider first.");
      return;
    }
    const campaign = campaigns.find((item) => item.id === chat_flow_selected_campaign_id);
    if (!campaign) {
      setErrorMessage("Select an existing campaign.");
      return;
    }
    setIsChatFlowSubmitting(true);
    setErrorMessage("");
    try {
      setChatFlowOpen(false);
      await start_listening_with_provider(campaign, chat_flow_provider);
    } finally {
      setIsChatFlowSubmitting(false);
    }
  };

  const handleUpdateCampaign = async (campaign: CampaignSummary) => {
    setEditingCampaign(campaign);
    setEditCampaignName(campaign.name);
    setEditCampaignDescription(campaign.description ?? "");
  };

  const submitCampaignUpdate = async () => {
    if (!editingCampaign) {
      return;
    }
    if (!editCampaignName.trim()) {
      showToast({ type: "error", message: "Campaign name is required." });
      return;
    }
    const campaign = editingCampaign;
    setIsUpdatingCampaignId(campaign.id);
    setErrorMessage("");
    try {
      const updated = await campaign_api.update_campaign(campaign.id, {
        name: editCampaignName.trim(),
        description: editCampaignDescription.trim(),
      });
      setCampaigns((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setActiveMenuCampaignId(null);
      setEditingCampaign(null);
      showToast({ type: "success", message: "Campaign updated." });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to update campaign");
      showToast({ type: "error", message: error instanceof Error ? error.message : "Failed to update campaign" });
    } finally {
      setIsUpdatingCampaignId(null);
    }
  };

  const handleDeleteCampaign = async (campaign: CampaignSummary) => {
    setDeletingCampaign(campaign);
  };

  const confirmDeleteCampaign = async () => {
    if (!deletingCampaign) {
      return;
    }
    const campaign = deletingCampaign;
    setIsDeletingCampaignId(campaign.id);
    setErrorMessage("");
    try {
      await campaign_api.delete_campaign(campaign.id);
      setCampaigns((prev) => prev.filter((item) => item.id !== campaign.id));
      setCampaignProvidersMap((prev) => {
        const next = { ...prev };
        delete next[campaign.id];
        return next;
      });
      setActiveMenuCampaignId(null);
      setDeletingCampaign(null);
      showToast({ type: "success", message: "Campaign deleted." });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete campaign");
      showToast({ type: "error", message: error instanceof Error ? error.message : "Failed to delete campaign" });
    } finally {
      setIsDeletingCampaignId(null);
    }
  };

  const handleOpenCampaign = (event: ReactMouseEvent | KeyboardEvent, campaignId: string) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-prevent-campaign-open='true']")) {
      return;
    }
    navigate(`/visualization/${campaignId}`);
  };

  const handleSwitchAccount = async (tenant_id: string) => {
    if (!tenant_id || tenant_id === active_tenant_id) {
      return;
    }
    try {
      const current_user_raw = localStorage.getItem("ai_seo_user");
      const current_user = current_user_raw ? JSON.parse(current_user_raw) : null;
      const switched = await account_api.switch_account(tenant_id);
      extension_auth.set_auth_session({
        access_token: switched.access_token,
        refresh_token: switched.refresh_token,
        user: switched.user ?? current_user,
        memberships: switched.memberships,
        active_account: switched.active_account,
      } as { access_token: string; refresh_token: string; user: unknown });
      setActiveTenantId(switched.active_account?.tenant_id ?? tenant_id);
      await Promise.all([loadCampaigns(), loadAccountContext()]);
      showToast({ type: "success", message: "Switched account." });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to switch account");
      showToast({ type: "error", message: error instanceof Error ? error.message : "Failed to switch account" });
    }
  };

  const handleSwitchDomain = (domain_id: string) => {
    setSelectedDomainId(domain_id);
    localStorage.setItem(DOMAIN_SELECTION_KEY, domain_id);
    if (!chat_flow_domain_id) {
      setChatFlowDomainId(domain_id);
    }
  };

  return (
    <>
      <AppHeader
        title="Intent"
        onLogout={handleLogout}
        profile_name={profileName}
        profile_image_url={profileImageUrl}
        nav_actions={
          <>
            {memberships.length > 1 ? (
              <select
                className="h-8 rounded-md border border-border bg-background px-2 text-[10px]"
                value={active_tenant_id ?? ""}
                onChange={(event) => void handleSwitchAccount(event.target.value)}
              >
                {memberships.map((membership) => (
                  <option key={membership.tenant_id} value={membership.tenant_id}>
                    {membership.name}
                  </option>
                ))}
              </select>
            ) : null}
            {domains.length ? (
              <select
                className="h-8 max-w-[180px] rounded-md border border-border bg-background px-2 text-[10px]"
                value={selected_domain_id}
                onChange={(event) => handleSwitchDomain(event.target.value)}
              >
                {domains.map((domain) => (
                  <option key={domain.domain_id} value={domain.domain_id}>
                    {domain.normalized_domain}
                  </option>
                ))}
              </select>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 px-2 text-[10px] uppercase tracking-wide"
              onClick={() => void loadCampaigns()}
              disabled={isLoading}
            >
              {isLoading ? "Refreshing..." : "Refresh"}
            </Button>
          </>
        }
      />
      <main className="h-dvh overflow-hidden bg-background pt-14">
        <ScrollArea className="h-[calc(100dvh-56px)]">
          <div className="space-y-6 px-3 py-4 sm:px-4 sm:py-6">
            <section className="space-y-3">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">Start Chat</p>
              <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
                {ai_labs.map((lab) => (
                  <button
                    key={lab.id}
                    type="button"
                    className="group flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => handle_start_chat(lab.id)}
                    disabled={!capture_supported_providers.includes(lab.id)}
                    title={!capture_supported_providers.includes(lab.id) ? "Capture support coming soon" : undefined}
                  >
                    <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-sm bg-background">
                      <img src={lab.logo} alt={`${lab.name} logo`} className="h-5 w-5 object-contain" />
                    </div>
                    <span className="text-xs font-medium">{lab.name}</span>
                    {!capture_supported_providers.includes(lab.id) ? (
                      <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">Soon</span>
                    ) : (
                      <ArrowUpRight className="ml-auto h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                    )}
                  </button>
                ))}
              </div>
            </section>

          <Button className="h-12 w-full uppercase tracking-widest" onClick={handleCreateCampaign} disabled={domains.length === 0}>
            <Plus className="h-4 w-4" />
            New Campaign
          </Button>

          <p className="text-xs uppercase tracking-widest text-muted-foreground">Campaigns</p>

          {errorMessage ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-destructive">{errorMessage}</p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 px-2 text-[10px] uppercase tracking-wide"
                onClick={() => void loadCampaigns()}
                disabled={isLoading}
              >
                {isLoading ? "Refreshing..." : "Refresh"}
              </Button>
            </div>
          ) : null}

            <div className="space-y-px">
              {isLoading ? (
                <div className="space-y-2 px-1 py-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="rounded-md border border-border bg-card p-3">
                      <div className="flex items-center justify-between">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-5 w-16 rounded-full" />
                      </div>
                      <Skeleton className="mt-2 h-3 w-56" />
                      <Skeleton className="mt-3 h-7 w-28" />
                    </div>
                  ))}
                </div>
              ) : null}
              {!isLoading && !campaigns.length ? (
                <div className="px-2 py-4 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    No campaigns in this workspace yet. Complete onboarding on web or create one here.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[10px] uppercase tracking-wider"
                    onClick={() => extension_auth.open_web_onboarding_page()}
                  >
                    Open Web Onboarding
                  </Button>
                </div>
              ) : null}
              {campaigns.map((campaign) => (
                <div
                  key={campaign.id}
                  className="group w-full cursor-pointer"
                  onClick={(event) => handleOpenCampaign(event, campaign.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      handleOpenCampaign(event, campaign.id);
                    }
                  }}
                >
                  <div className="flex items-center gap-3 bg-card px-4 py-3 text-left transition-colors hover:bg-accent">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold">{campaign.name}</span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {campaign.description || "No description"}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      {(campaignProvidersMap[campaign.id] ?? []).length > 0 ? (
                        <div className="flex items-center gap-1">
                          {(campaignProvidersMap[campaign.id] ?? []).slice(0, 4).map((provider) => {
                            const logo = campaign_chat.provider_logo(provider);
                            return logo ? (
                              <div
                                key={`${campaign.id}-${provider}`}
                                className="flex h-5 w-5 items-center justify-center rounded border border-border bg-background/70"
                              >
                                <img src={logo} alt={provider} className="h-3.5 w-3.5 object-contain opacity-90" />
                              </div>
                            ) : null;
                          })}
                        </div>
                      ) : null}
                      <div className="relative" data-campaign-menu-root="true" data-prevent-campaign-open="true">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(event) => {
                            event.stopPropagation();
                            setActiveMenuCampaignId((prev) => (prev === campaign.id ? null : campaign.id));
                          }}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                        {activeMenuCampaignId === campaign.id ? (
                          <div
                            className="absolute right-0 top-8 z-20 min-w-[150px] rounded-md border border-border bg-popover p-1 shadow-md"
                            data-prevent-campaign-open="true"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="w-full rounded px-2 py-2 text-left text-xs hover:bg-accent"
                              disabled={isUpdatingCampaignId === campaign.id}
                              onClick={() => void handleUpdateCampaign(campaign)}
                            >
                              {isUpdatingCampaignId === campaign.id ? "Updating..." : "Update campaign"}
                            </button>
                            <button
                              type="button"
                              className="w-full rounded px-2 py-2 text-left text-xs text-destructive hover:bg-accent"
                              disabled={isDeletingCampaignId === campaign.id}
                              onClick={() => void handleDeleteCampaign(campaign)}
                            >
                              {isDeletingCampaignId === campaign.id ? "Deleting..." : "Delete campaign"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <Badge variant="outline" className="hidden border-border text-[10px] uppercase tracking-wide min-[420px]:inline-flex">
                        {campaign.total_nodes} nodes
                      </Badge>
                      <ChevronRight className="hidden h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100 sm:block" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
      </main>
      <AnimatePresence>
        {toast ? (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`fixed right-3 top-16 z-[60] max-w-xs rounded-md border px-3 py-2 text-xs shadow-lg ${
              toast.type === "success"
                ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                : "border-destructive/40 bg-destructive/10 text-destructive"
            }`}
          >
            {toast.message}
          </motion.div>
        ) : null}
      </AnimatePresence>
      <Dialog open={Boolean(editingCampaign)} onOpenChange={(open) => { if (!open) { setEditingCampaign(null); } }}>
        <DialogContent className="w-[90vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Update Campaign</DialogTitle>
            <DialogDescription>Edit campaign name and description.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              value={editCampaignName}
              onChange={(event) => setEditCampaignName(event.target.value)}
              placeholder="Campaign name"
            />
            <Input
              value={editCampaignDescription}
              onChange={(event) => setEditCampaignDescription(event.target.value)}
              placeholder="Description (optional)"
            />
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" className="flex-1" onClick={() => setEditingCampaign(null)}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={() => void submitCampaignUpdate()}
                disabled={!editingCampaign || isUpdatingCampaignId === editingCampaign.id}
              >
                {editingCampaign && isUpdatingCampaignId === editingCampaign.id ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(deletingCampaign)} onOpenChange={(open) => { if (!open) { setDeletingCampaign(null); } }}>
        <DialogContent className="w-[90vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Campaign</DialogTitle>
            <DialogDescription>
              {deletingCampaign ? `Delete "${deletingCampaign.name}"? This action cannot be undone.` : "Delete this campaign?"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setDeletingCampaign(null)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              variant="destructive"
              onClick={() => void confirmDeleteCampaign()}
              disabled={!deletingCampaign || isDeletingCampaignId === deletingCampaign.id}
            >
              {deletingCampaign && isDeletingCampaignId === deletingCampaign.id ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <AnimatePresence>
        {chat_flow_open ? (
          <>
            <motion.button
              type="button"
              className="fixed inset-0 z-40 bg-black/70"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={close_chat_flow}
            />
            <motion.div
              className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-border bg-card px-4 pb-5 pt-4"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 320 }}
            >
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Start Chat</p>
                  <p className="text-sm font-semibold">
                    {chat_flow_provider ? <ProviderInlineLabel provider={chat_flow_provider} /> : "Choose AI Chat App"}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={close_chat_flow} disabled={is_chat_flow_submitting}>
                  Close
                </Button>
              </div>
              {chat_flow_mode === "select" ? (
                <div className="space-y-2">
                  <Button className="h-10 w-full" onClick={() => setChatFlowMode("new")} disabled={is_chat_flow_submitting}>
                    Start New Campaign
                  </Button>
                  <Button
                    variant="secondary"
                    className="h-10 w-full"
                    onClick={() => setChatFlowMode("existing")}
                    disabled={is_chat_flow_submitting || !campaigns.length}
                  >
                    Choose Existing Campaign
                  </Button>
                  {!campaigns.length ? (
                    <p className="text-xs text-muted-foreground">No existing campaigns available yet.</p>
                  ) : null}
                </div>
              ) : null}
              {chat_flow_mode === "new" ? (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground">AI Chat App</p>
                    <div className="grid grid-cols-3 gap-1">
                      {campaign_chat.list_providers().filter((provider) => capture_supported_providers.includes(provider.id)).map((provider) => (
                        <button
                          key={provider.id}
                          type="button"
                          className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                            chat_flow_provider === provider.id
                              ? "border-primary bg-primary/20 text-foreground"
                              : "border-border text-muted-foreground hover:bg-accent"
                          }`}
                          onClick={() => setChatFlowProvider(provider.id)}
                        >
                          <ProviderInlineLabel provider={provider.id} />
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    value={chat_flow_campaign_name}
                    onChange={(event) => setChatFlowCampaignName(event.target.value)}
                    placeholder="Campaign name"
                    className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                  />
                  <select
                    value={chat_flow_domain_id}
                    onChange={(event) => setChatFlowDomainId(event.target.value)}
                    className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                  >
                    <option value="" disabled>Select domain</option>
                    {domains.map((domain) => (
                      <option key={domain.domain_id} value={domain.domain_id}>
                        {domain.normalized_domain}
                      </option>
                    ))}
                  </select>
                  <input
                    value={chat_flow_campaign_description}
                    onChange={(event) => setChatFlowCampaignDescription(event.target.value)}
                    placeholder="Description (optional)"
                    className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                  />
                  <div className="flex gap-2">
                    <Button variant="secondary" className="h-10 flex-1" onClick={() => setChatFlowMode("select")} disabled={is_chat_flow_submitting}>
                      Back
                    </Button>
                    <Button
                      className="h-10 flex-1"
                      onClick={() => void submit_chat_flow_new_campaign()}
                      disabled={is_chat_flow_submitting || !chat_flow_provider}
                    >
                      {is_chat_flow_submitting ? "Starting..." : "Create & Listen"}
                    </Button>
                  </div>
                </div>
              ) : null}
              {chat_flow_mode === "existing" ? (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground">AI Chat App</p>
                    <div className="grid grid-cols-3 gap-1">
                      {campaign_chat.list_providers().filter((provider) => capture_supported_providers.includes(provider.id)).map((provider) => (
                        <button
                          key={provider.id}
                          type="button"
                          className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                            chat_flow_provider === provider.id
                              ? "border-primary bg-primary/20 text-foreground"
                              : "border-border text-muted-foreground hover:bg-accent"
                          }`}
                          onClick={() => setChatFlowProvider(provider.id)}
                        >
                          <ProviderInlineLabel provider={provider.id} />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-1">
                    {campaigns.map((campaign) => {
                      const is_selected = chat_flow_selected_campaign_id === campaign.id;
                      return (
                        <button
                          key={campaign.id}
                          type="button"
                          className={`w-full rounded-md px-3 py-2 text-left text-xs transition-colors ${is_selected ? "bg-primary/20 text-foreground" : "hover:bg-accent text-muted-foreground"}`}
                          onClick={() => setChatFlowSelectedCampaignId(campaign.id)}
                        >
                          <p className="truncate text-sm font-medium text-foreground">{campaign.name}</p>
                          <p className="truncate">{campaign.description || "No description"}</p>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" className="h-10 flex-1" onClick={() => setChatFlowMode("select")} disabled={is_chat_flow_submitting}>
                      Back
                    </Button>
                    <Button
                      className="h-10 flex-1"
                      onClick={() => void submit_chat_flow_existing_campaign()}
                      disabled={is_chat_flow_submitting || !chat_flow_provider}
                    >
                      {is_chat_flow_submitting ? "Starting..." : "Start Listening"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}
