import { STREAM_PORT_BY_PROVIDER } from "../lib/provider-stream-registry";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Event type forwarded to the background service worker via the port.
 * Reuses the provider-agnostic runtime event so the background can route
 * all providers through the same handleStreamEvent() pipeline.
 */
const RUNTIME_EVENT_TYPE = "AI_SEO_CHATGPT_EVENT";
const BRIDGE_MESSAGE_TYPE = "AI_SEO_MAIN_TO_ISOLATED_BRIDGE";
const PORT_NAME = STREAM_PORT_BY_PROVIDER.claude;
const DEBUG_PREFIX = "[AI-SEO][CLAUDE-CONTENT]";

// ─── Types ────────────────────────────────────────────────────────────────────

type StreamEventPayload = {
  kind: "prompt_sent" | "search_queries" | "search_results" | "response_finished";
  chat_provider?: "chatgpt" | "claude" | "gemini" | "perplexity" | "grok" | "unknown";
  provider_chat_id?: string;
  chat_url?: string;
  chat_title?: string;
  conversationId?: string;
  requestId?: string;
  turnExchangeId?: string;
  prompt?: string;
  queries?: string[];
  resultGroups?: unknown[];
  reason?: "status_finished_successfully" | "message_stream_complete" | "done_marker";
};

// ─── Port management ──────────────────────────────────────────────────────────

let streamPort: chrome.runtime.Port | null = null;
let reconnectTimer: number | null = null;
let runtimeInvalidated = false;
let bridgeEventCount = 0;

function isRuntimeAlive(): boolean {
  try {
    return !!chrome?.runtime?.id;
  } catch {
    return false;
  }
}

function stopBridge(reason: string): void {
  if (runtimeInvalidated) return;
  runtimeInvalidated = true;
  streamPort = null;

  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  window.removeEventListener("message", onPageMessage);
  console.warn(DEBUG_PREFIX, "bridge stopped —", reason);
}

function scheduleReconnect(): void {
  if (runtimeInvalidated || reconnectTimer !== null) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    if (!isRuntimeAlive()) {
      stopBridge("runtime gone during reconnect delay");
      return;
    }
    ensureStreamPort();
  }, 500);
}

function ensureStreamPort(): chrome.runtime.Port | null {
  if (runtimeInvalidated) return null;

  try {
    if (!isRuntimeAlive()) {
      stopBridge("runtime unavailable on port check");
      return null;
    }

    if (streamPort) return streamPort;

    streamPort = chrome.runtime.connect({ name: PORT_NAME });

    streamPort.onDisconnect.addListener(() => {
      streamPort = null;
      if (!isRuntimeAlive()) {
        stopBridge("runtime gone after port disconnect");
        return;
      }
      scheduleReconnect();
    });

    return streamPort;
  } catch (error) {
    if (String(error).includes("Extension context invalidated")) {
      stopBridge("extension context invalidated (sync)");
      return null;
    }
    console.warn(DEBUG_PREFIX, "failed to open stream port", error);
    return null;
  }
}

// ─── Main-world bridge ────────────────────────────────────────────────────────
//
// claudeStreamMain.ts runs in the MAIN world (page context) and patches
// window.fetch() to intercept SSE streams.  Since CustomEvents don't cross
// the MV3 world boundary, it communicates via window.postMessage().
//
// This isolated-world script relays those messages to the background service
// worker via a persistent chrome.runtime port.

function onPageMessage(event: MessageEvent): void {
  if (event.origin !== window.location.origin) return;
  if (event.data?.type !== BRIDGE_MESSAGE_TYPE) return;
  if (!event.data?.payload) {
    console.warn(DEBUG_PREFIX, "bridge message missing payload", event.data);
    return;
  }

  const payload = event.data.payload as StreamEventPayload;
  bridgeEventCount += 1;

  console.log(DEBUG_PREFIX, "relay", payload.kind, payload.reason ?? "-", {
    bridgeEventCount,
    conversationId: payload.conversationId,
    promptLength: payload.prompt?.length ?? 0,
    queryCount: payload.queries?.length ?? 0,
    resultCount: payload.resultGroups?.length ?? 0,
  });

  const port = ensureStreamPort();
  if (!port) return;

  try {
    port.postMessage({ type: RUNTIME_EVENT_TYPE, payload });
  } catch (error) {
    const msg = String(error);
    if (
      msg.includes("Extension context invalidated") ||
      msg.includes("Attempting to use a disconnected port object")
    ) {
      streamPort = null;
      scheduleReconnect();
      return;
    }
    console.warn(DEBUG_PREFIX, "port.postMessage failed", error);
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

console.log(DEBUG_PREFIX, "loaded — listening for main-world messages");
ensureStreamPort();
window.addEventListener("message", onPageMessage);
