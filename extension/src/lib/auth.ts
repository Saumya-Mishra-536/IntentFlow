const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "https://ai-seo-monorepo.onrender.com";
const WEB_APP_URL = import.meta.env.VITE_WEB_APP_URL ?? "http://localhost:5173";
const WEB_APP_ORIGIN = new URL(WEB_APP_URL).origin;

const AUTH_FLAG_KEY = "ai_seo_auth";
const LEGACY_AUTH_FLAG_KEY = "ai-seo-auth";
const ACCESS_TOKEN_KEY = "ai_seo_access_token";
const REFRESH_TOKEN_KEY = "ai_seo_refresh_token";
const USER_KEY = "ai_seo_user";
const MEMBERSHIPS_KEY = "ai_seo_memberships";
const ACTIVE_ACCOUNT_KEY = "ai_seo_active_account";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

const parse_api = async <T>(response: Response): Promise<T> => {
  const payload = (await response.json()) as ApiResponse<T> | { message?: string };
  if (!response.ok || !("success" in payload) || !payload.success) {
    const message = "message" in payload && payload.message ? payload.message : "Request failed";
    throw new Error(message);
  }
  return payload.data;
};

const parse_callback_query = (): URLSearchParams => {
  const search = new URLSearchParams(window.location.search);
  if (search.get("code")) {
    return search;
  }
  const hash = window.location.hash;
  const query_index = hash.indexOf("?");
  if (query_index === -1) {
    return search;
  }
  return new URLSearchParams(hash.slice(query_index + 1));
};

export const extension_auth = {
  open_web_connect_page: () => {
    const extension_redirect_uri = chrome.runtime.getURL("index.html#/auth-callback");
    const state = crypto.randomUUID();
    const url = new URL("/extension/connect", WEB_APP_URL);
    url.searchParams.set("extension_redirect_uri", extension_redirect_uri);
    url.searchParams.set("state", state);
    window.open(url.toString(), "_blank", "width=680,height=760");
    return state;
  },
  open_web_onboarding_page: () => {
    const url = new URL("/onboarding", WEB_APP_URL);
    window.open(url.toString(), "_blank", "width=1000,height=780");
  },
  web_app_origin: WEB_APP_ORIGIN,
  get_auth_status: () =>
    localStorage.getItem(AUTH_FLAG_KEY) === "true" || localStorage.getItem(LEGACY_AUTH_FLAG_KEY) === "true",
  set_auth_session: (payload: { access_token: string; refresh_token: string; user: unknown }) => {
    localStorage.setItem(AUTH_FLAG_KEY, "true");
    localStorage.removeItem(LEGACY_AUTH_FLAG_KEY);
    localStorage.setItem(ACCESS_TOKEN_KEY, payload.access_token);
    localStorage.setItem(REFRESH_TOKEN_KEY, payload.refresh_token);
    localStorage.setItem(USER_KEY, JSON.stringify(payload.user));
    const with_extras = payload as { memberships?: unknown; active_account?: unknown };
    if (with_extras.memberships !== undefined) {
      localStorage.setItem(MEMBERSHIPS_KEY, JSON.stringify(with_extras.memberships));
    }
    if (with_extras.active_account !== undefined) {
      localStorage.setItem(ACTIVE_ACCOUNT_KEY, JSON.stringify(with_extras.active_account));
    }
  },
  get_memberships: () => {
    const raw = localStorage.getItem(MEMBERSHIPS_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as Array<{ tenant_id: string; slug: string; name: string; member_role: string }>;
    } catch {
      return [];
    }
  },
  get_active_account: () => {
    const raw = localStorage.getItem(ACTIVE_ACCOUNT_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as { tenant_id: string; slug: string; name: string; member_role: string };
    } catch {
      return null;
    }
  },
  clear_auth_session: () => {
    localStorage.removeItem(AUTH_FLAG_KEY);
    localStorage.removeItem(LEGACY_AUTH_FLAG_KEY);
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(MEMBERSHIPS_KEY);
    localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
  },
  exchange_code: async (code: string) => {
    if (!code) {
      throw new Error("Missing auth code");
    }
    const response = await fetch(`${API_BASE_URL}/api/auth/code/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    return parse_api<{ access_token: string; refresh_token: string; user: unknown }>(response);
  },
  exchange_callback_code: async () => {
    const query = parse_callback_query();
    const code = query.get("code");
    if (!code) {
      throw new Error("Missing auth code in callback");
    }
    return extension_auth.exchange_code(code);
  },
};
