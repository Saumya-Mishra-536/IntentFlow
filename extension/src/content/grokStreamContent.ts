import { STREAM_PORT_BY_PROVIDER } from "../lib/provider-stream-registry";

const RUNTIME_EVENT_TYPE = "AI_SEO_CHATGPT_EVENT";
const BRIDGE_MESSAGE_TYPE = "AI_SEO_MAIN_TO_ISOLATED_BRIDGE";
const PORT_NAME = STREAM_PORT_BY_PROVIDER.grok;
const DEBUG_PREFIX = "[AI-SEO][GROK-CONTENT]";

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
    const message = String(error);
    if (
      message.includes("Extension context invalidated")
      || message.includes("Attempting to use a disconnected port object")
    ) {
      streamPort = null;
      scheduleReconnect();
      return;
    }
    console.warn(DEBUG_PREFIX, "port.postMessage failed", error);
  }
}

console.log(DEBUG_PREFIX, "loaded — listening for main-world messages");
ensureStreamPort();
window.addEventListener("message", onPageMessage);
