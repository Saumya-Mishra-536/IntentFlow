type BridgeProxyRequest = {
  type: "AI_SEO_WEB_BRIDGE_REQUEST";
  requestId: string;
  message: Record<string, unknown>;
};

const on_page_message = (event: MessageEvent) => {
  if (event.source !== window) return;
  const payload = event.data as BridgeProxyRequest | undefined;
  if (!payload || payload.type !== "AI_SEO_WEB_BRIDGE_REQUEST") return;
  if (!payload.requestId || typeof payload.requestId !== "string") return;
  if (!payload.message || typeof payload.message !== "object") return;

  try {
    chrome.runtime.sendMessage(payload.message, (response) => {
      const runtime_error = chrome.runtime.lastError?.message;
      window.postMessage(
        {
          type: "AI_SEO_WEB_BRIDGE_RESPONSE",
          requestId: payload.requestId,
          ok: !runtime_error,
          error: runtime_error,
          data: response,
        },
        "*",
      );
    });
  } catch (error) {
    window.postMessage(
      {
        type: "AI_SEO_WEB_BRIDGE_RESPONSE",
        requestId: payload.requestId,
        ok: false,
        error: error instanceof Error ? error.message : "Failed to proxy message to extension runtime",
      },
      "*",
    );
  }
};

window.addEventListener("message", on_page_message);

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") return;
  const envelope = message as { type?: unknown };
  if (envelope.type !== "AI_SEO_BRIDGE_EVENT") return;
  window.postMessage(
    {
      type: "AI_SEO_WEB_BRIDGE_EVENT",
      message,
    },
    "*",
  );
});
