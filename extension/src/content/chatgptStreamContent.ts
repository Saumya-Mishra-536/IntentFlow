import { STREAM_PORT_BY_PROVIDER } from "../lib/provider-stream-registry";

const RUNTIME_EVENT_TYPE = "AI_SEO_CHATGPT_EVENT";
const MESSAGE_BRIDGE_TYPE = "AI_SEO_MAIN_TO_ISOLATED_BRIDGE";
const DEBUG_PREFIX = "[AI-SEO][CONTENT]";
let bridgeEventCount = 0;
let runtimeInvalidated = false;
let streamPort: chrome.runtime.Port | null = null;
let reconnectTimer: number | null = null;
const PORT_NAME = STREAM_PORT_BY_PROVIDER.chatgpt;

function checkRuntimeContext(): boolean {
  try {
    return !!chrome?.runtime?.id;
  } catch {
    return false;
  }
}

function stopBridgeDueToInvalidContext(reason: string) {
  if (runtimeInvalidated) {
    return;
  }
  runtimeInvalidated = true;
  streamPort = null;
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  window.removeEventListener("message", onPageMessage);
  console.warn(DEBUG_PREFIX, reason);
}

function scheduleReconnect() {
  if (runtimeInvalidated || reconnectTimer !== null) {
    return;
  }
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    if (!checkRuntimeContext()) {
      stopBridgeDueToInvalidContext("runtime context invalidated; stopping bridge sends");
      return;
    }
    ensureStreamPort();
  }, 500);
}

function ensureStreamPort(): chrome.runtime.Port | null {
  if (runtimeInvalidated) {
    return null;
  }

  try {
    if (!checkRuntimeContext()) {
      stopBridgeDueToInvalidContext("runtime unavailable; stopping bridge sends");
      return null;
    }

    if (streamPort) {
      return streamPort;
    }

    streamPort = chrome.runtime.connect({ name: PORT_NAME });
    streamPort.onDisconnect.addListener(() => {
      streamPort = null;
      if (!checkRuntimeContext()) {
        stopBridgeDueToInvalidContext("runtime context invalidated after disconnect; stopping bridge sends");
        return;
      }
      scheduleReconnect();
    });
    return streamPort;
  } catch (error) {
    const text = String(error ?? "");
    if (text.includes("Extension context invalidated")) {
      stopBridgeDueToInvalidContext("runtime context invalidated (sync); stopping bridge sends");
      return null;
    }
    console.warn(DEBUG_PREFIX, "failed to create stream port", error);
    return null;
  }
}

// ─── Main-world bridge (removed inline injection due to CSP) ─────────────────
// CRXJS properly injects chatgptStreamMain.ts via manifest world:MAIN.
// This isolated world script just needs to listen for postMessages and relay
// them to the extension runtime via chrome.runtime.sendMessage().
//
// OLD APPROACH (removed):
// Tried to inject IIFE via <script>, but ChatGPT's CSP blocks inline scripts.
// No longer needed since world:MAIN manifest entry works reliably.

// ─── Bridge: forward main-world postMessages to extension runtime ─────────────
// Isolated world content script receives postMessages from main world and relays to chrome.runtime

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
  conversationPayload?: unknown;
  reason?: "status_finished_successfully" | "message_stream_complete" | "done_marker";
};

function onPageMessage(event: MessageEvent) {
  // Only process messages from the main world (same origin)
  if (event.origin !== window.location.origin) {
    return;
  }

  if (event.data?.type !== MESSAGE_BRIDGE_TYPE) {
    return;
  }

  if (!event.data?.payload) {
    console.warn(DEBUG_PREFIX, "bridge message without payload", event.data);
    return;
  }

  const payload = event.data.payload as StreamEventPayload;
  bridgeEventCount += 1;

  console.log(DEBUG_PREFIX, "forward", payload.kind, payload.reason ?? "-", {
    bridgeEventCount,
    conversationId: payload.conversationId,
    promptLength: payload.prompt?.length ?? 0,
    queryCount: payload.queries?.length ?? 0,
    resultGroupCount: payload.resultGroups?.length ?? 0,
  });

  const port = ensureStreamPort();
  if (!port) {
    return;
  }

  try {
    port.postMessage({
    type: RUNTIME_EVENT_TYPE,
    payload,
    });
  } catch (error) {
    const text = String(error ?? "");
    if (text.includes("Extension context invalidated") || text.includes("Attempting to use a disconnected port object")) {
      streamPort = null;
      scheduleReconnect();
      return;
    }
    console.warn(DEBUG_PREFIX, "port postMessage failed", error);
  }
}

console.log(DEBUG_PREFIX, "loaded – listening for main-world messages");
ensureStreamPort();
window.addEventListener("message", onPageMessage);
