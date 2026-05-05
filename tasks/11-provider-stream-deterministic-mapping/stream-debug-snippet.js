(() => {
  const NAMESPACE = "__AISEO_STREAM_DEBUG__";
  if (window[NAMESPACE]?.isPatched) {
    console.info("[AI-SEO DEBUG] already patched", window[NAMESPACE]);
    return;
  }

  const MAX_TEXT = 240;
  const MAX_TITLE = 180;
  const MAX_SITE = 120;
  const MAX_URL = 900;

  const nowIso = () => new Date().toISOString();
  const clamp = (v, n) => (typeof v === "string" ? (v.length > n ? v.slice(0, n) + "..." : v) : undefined);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
  const s = (v) => {
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    return t ? t : undefined;
  };
  const key = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");

  const detectProvider = (url) => {
    const u = String(url || "").toLowerCase();
    const h = location.hostname.toLowerCase();
    if (u.includes("chatgpt.com") || u.includes("openai.com") || h.includes("chatgpt") || h.includes("openai")) return "chatgpt";
    if (u.includes("claude.ai") || h.includes("claude.ai")) return "claude";
    if (u.includes("perplexity.ai") || h.includes("perplexity.ai")) return "perplexity";
    if (u.includes("gemini.google.com") || h.includes("gemini.google.com")) return "gemini";
    if (u.includes("grok.com") || u.includes("x.ai") || h.includes("grok.com") || h.includes("x.ai")) return "grok";
    return "unknown";
  };

  const state = {
    isPatched: true,
    DEBUG_VERBOSE: false,
    events: [],
    turns: {},
    _globalSeq: 0,
    _querySeen: {},
    _resultSeen: {},
    _conversationQuerySeen: {},
    _conversationLastQuery: {},
    _finishedTurns: new Set(),
    _providerState: {},
    _turnByProviderTurnId: {},
    _pendingPrompts: {},
    _pendingFinishByProvider: {},
    _origFetch: window.fetch,
    _origXHROpen: XMLHttpRequest.prototype.open,
    _origXHRSend: XMLHttpRequest.prototype.send,
  };

  const hash = (parts) => {
    const base = parts.map((x) => String(x ?? "").trim().toLowerCase()).join("||");
    let h = 2166136261;
    for (let i = 0; i < base.length; i += 1) {
      h ^= base.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  };

  const getTurn = (meta) => {
    const provider = meta.provider || "unknown";
    const now = Date.now();
    const hasConversationId = Boolean(meta.provider_conversation_id);
    const hasReqOrTurnId = Boolean(meta.provider_request_id || meta.provider_turn_id);
    const conversation = meta.provider_conversation_id || "na-conv";
    const request = meta.provider_request_id || "na-req";
    let turn = meta.provider_turn_id;

    if (!turn) {
      const active = state._providerState[provider];
      const canReuseActiveTurn =
        active &&
        !active.closed &&
        now - active.lastSeenAt < 45000 &&
        (!hasReqOrTurnId || (active.provider_request_id === undefined && active.provider_turn_id));
      const sameConversation =
        !hasConversationId || !active?.provider_conversation_id || active.provider_conversation_id === meta.provider_conversation_id;
      if (canReuseActiveTurn && sameConversation) {
        turn = active.provider_turn_id;
      } else {
        turn = hash([provider, conversation, request, location.pathname, Math.floor(now / 30000)]);
      }
    }

    const providerTurnMapKey = `${provider}::${turn}`;
    const mappedTurnKey = state._turnByProviderTurnId[providerTurnMapKey];
    const turnKey = mappedTurnKey || `${provider}::${conversation}::${request}::${turn}`;

    if (!state.turns[turnKey]) {
      state.turns[turnKey] = {
        turn_key: turnKey,
        provider,
        provider_conversation_id: meta.provider_conversation_id,
        provider_request_id: meta.provider_request_id,
        provider_turn_id: turn,
        started_at: nowIso(),
        finished_at: undefined,
        prompt_count: 0,
        query_count: 0,
        result_count: 0,
        missing_linkage_warnings: 0,
        _seq: 0,
      };
      state._querySeen[turnKey] = new Set();
      state._resultSeen[turnKey] = new Set();
    }

    const existingTurn = state.turns[turnKey];
    if (
      existingTurn &&
      existingTurn.provider_conversation_id === undefined &&
      meta.provider_conversation_id
    ) {
      existingTurn.provider_conversation_id = meta.provider_conversation_id;
    }
    if (existingTurn && existingTurn.provider_request_id === undefined && meta.provider_request_id) {
      existingTurn.provider_request_id = meta.provider_request_id;
    }
    state._turnByProviderTurnId[providerTurnMapKey] = turnKey;
    state._providerState[provider] = {
      turn_key: turnKey,
      provider_turn_id: turn,
      provider_conversation_id: existingTurn.provider_conversation_id,
      provider_request_id: existingTurn.provider_request_id,
      closed: false,
      lastSeenAt: now,
    };
    return state.turns[turnKey];
  };

  const emit = (eventType, meta, payload) => {
    try {
      const turn = getTurn(meta);
      turn._seq += 1;
      state._globalSeq += 1;

      const event = {
        capture_turn_id: turn.turn_key,
        provider: turn.provider,
        provider_conversation_id: turn.provider_conversation_id,
        provider_request_id: turn.provider_request_id,
        provider_turn_id: turn.provider_turn_id,
        seq: turn._seq,
        global_seq: state._globalSeq,
        event_type: eventType,
        source_ref: hash([eventType, turn.turn_key, turn._seq]),
        payload,
        occurred_at: nowIso(),
      };

      if (eventType === "prompt_sent") turn.prompt_count += 1;
      if (eventType === "search_queries") turn.query_count += 1;
      if (eventType === "search_results") {
        turn.result_count += 1;
        if (!payload.subquery_ref) turn.missing_linkage_warnings += 1;
      }
      if (eventType === "response_finished") turn.finished_at = event.occurred_at;
      if (eventType === "response_finished") {
        if (state._finishedTurns.has(turn.turn_key)) return;
        state._finishedTurns.add(turn.turn_key);
        const providerState = state._providerState[turn.provider];
        if (providerState && providerState.turn_key === turn.turn_key) {
          providerState.closed = true;
          providerState.lastSeenAt = Date.now();
        }
      }
      if (eventType === "prompt_sent" && payload?.prompt) {
        state._pendingPrompts[turn.provider] = {
          prompt: payload.prompt,
          prompt_ref: payload.prompt_ref,
          turn_key: turn.turn_key,
          seenAt: Date.now(),
          conversation_id: turn.provider_conversation_id,
        };
      }
      if (eventType === "response_finished") {
        state._pendingFinishByProvider[turn.provider] = {
          reason: payload?.reason || "done_marker",
          seenAt: Date.now(),
          conversation_id: turn.provider_conversation_id,
        };
      }

      state.events.push(event);
      if (state.DEBUG_VERBOSE || eventType === "response_finished") {
        console.log("[AI-SEO DEBUG]", event);
      } else {
        console.log("[AI-SEO DEBUG]", {
          event_type: event.event_type,
          provider: event.provider,
          seq: event.seq,
          payload: event.payload,
        });
      }

      if (eventType === "response_finished") {
        console.log("[AI-SEO DEBUG][TURN SUMMARY]", {
          turn_key: turn.turn_key,
          provider: turn.provider,
          prompt_count: turn.prompt_count,
          query_count: turn.query_count,
          result_count: turn.result_count,
          missing_linkage_warnings: turn.missing_linkage_warnings,
          started_at: turn.started_at,
          finished_at: turn.finished_at,
        });
      }
    } catch (err) {
      console.warn("[AI-SEO DEBUG] emit failed", err);
    }
  };

  const pickFirstString = (obj, keys) => {
    for (const k of keys) {
      const value = s(obj?.[k]);
      if (value) return value;
    }
    return undefined;
  };

  const collectQueriesAndResults = (value, out, queryCtx, depth) => {
    if (depth > 9 || value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) collectQueriesAndResults(item, out, queryCtx, depth + 1);
      return;
    }
    const obj = asObj(value);
    if (!obj) return;

    const localQuery = pickFirstString(obj, ["query", "search_query", "keyword", "q", "subquery"]);
    const activeQuery = localQuery || queryCtx;
    if (localQuery) out.queries.push(localQuery);

    const url = pickFirstString(obj, ["url", "link", "source_url", "display_url"]);
    const title = pickFirstString(obj, ["title", "headline", "heading", "name"]);
    const site =
      pickFirstString(obj, ["site_name", "domain", "source", "publisher"]) ||
      (() => {
        if (!url) return undefined;
        try {
          return new URL(url).hostname.replace(/^www\./, "");
        } catch {
          return undefined;
        }
      })();

    if (site) {
      out.results.push({
        query: activeQuery,
        site_name: clamp(site, MAX_SITE),
        url: clamp(url, MAX_URL),
        title: clamp(title, MAX_TITLE),
      });
    }

    for (const v of Object.values(obj)) {
      if (v && (Array.isArray(v) || typeof v === "object")) {
        collectQueriesAndResults(v, out, activeQuery, depth + 1);
      }
    }
  };

  const isLikelyAssetUrl = (url) => {
    if (!url) return false;
    const lowered = String(url).toLowerCase();
    return /\.(jpg|jpeg|png|gif|webp|svg|ico|avif|bmp|tiff)(\?|#|$)/.test(lowered);
  };

  const isLikelyInternalSite = (siteName) => {
    const s = String(siteName || "").toLowerCase();
    if (!s) return true;
    if (["default", "unknown", "null", "undefined", "sonic_tool", "tool"].includes(s)) return true;
    if (s === "styles") return true;
    if (s.startsWith("mapbox.") || s.includes("mapbox")) return true;
    return false;
  };

  const normalizeUrl = (raw) => {
    if (!raw) return undefined;
    try {
      const u = new URL(raw);
      if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
      u.hash = "";
      ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"].forEach((k) =>
        u.searchParams.delete(k),
      );
      const s = u.toString();
      return s.endsWith("/") ? s.slice(0, -1) : s;
    } catch {
      return raw;
    }
  };

  const parseJsonIfPossible = (line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  };

  const processChunkText = (meta, chunkText) => {
    const lines = String(chunkText || "").split(/\r?\n/).filter(Boolean);
    for (let line of lines) {
      if (line.startsWith("data:")) line = line.slice(5).trim();
      if (!line) continue;
      if (line === "[DONE]" || line === "[done]") {
        emit("response_finished", meta, { reason: "done_marker" });
        continue;
      }

      const parsed = parseJsonIfPossible(line);
      const obj = asObj(parsed);
      if (!obj) {
        if (state.DEBUG_VERBOSE) console.log("[AI-SEO DEBUG][raw]", clamp(line, MAX_TEXT));
        continue;
      }

      const mergedMeta = {
        ...meta,
        provider_conversation_id: pickFirstString(obj, ["conversation_id", "conversationId", "conversation"] ) || meta.provider_conversation_id,
        provider_request_id: pickFirstString(obj, ["request_id", "requestId", "message_id", "response_id"]) || meta.provider_request_id,
        provider_turn_id: pickFirstString(obj, ["turn_id", "turnId", "turn_exchange_id", "turnExchangeId"]) || meta.provider_turn_id,
      };

      const prompt =
        pickFirstString(obj, ["prompt", "user_prompt", "input"]) ||
        pickFirstString(asObj(obj.message) || {}, ["content", "text"]) ||
        (() => {
          const message = asObj(obj.message) || {};
          const content = asObj(message.content) || {};
          const parts = Array.isArray(content.parts) ? content.parts : [];
          for (const part of parts) {
            const maybeText = typeof part === "string" ? part : pickFirstString(asObj(part) || {}, ["text", "content"]);
            if (maybeText) return maybeText;
          }
          return undefined;
        })();
      if (prompt) {
        emit("prompt_sent", mergedMeta, {
          prompt: clamp(prompt, MAX_TEXT),
          prompt_ref: hash([mergedMeta.provider, mergedMeta.provider_turn_id || "", prompt]),
        });
      }

      const extracted = { queries: [], results: [] };
      collectQueriesAndResults(obj, extracted, undefined, 0);

      const turn = getTurn(mergedMeta);
      const hasSignal = extracted.queries.length > 0 || extracted.results.length > 0;
      const pendingPrompt = state._pendingPrompts[turn.provider];
      if (
        hasSignal &&
        pendingPrompt &&
        turn.prompt_count === 0 &&
        Date.now() - pendingPrompt.seenAt < 15000 &&
        (!pendingPrompt.conversation_id || pendingPrompt.conversation_id === turn.provider_conversation_id || !turn.provider_conversation_id)
      ) {
        emit("prompt_sent", mergedMeta, {
          prompt: pendingPrompt.prompt,
          prompt_ref: pendingPrompt.prompt_ref || hash([turn.turn_key, pendingPrompt.prompt]),
          stitched_from_orphan_prompt: true,
        });
        delete state._pendingPrompts[turn.provider];
      }
      for (const q of extracted.queries) {
        const qKey = key(q);
        if (!qKey || state._querySeen[turn.turn_key].has(qKey)) continue;
        state._querySeen[turn.turn_key].add(qKey);
        const conversationKey = `${turn.provider}::${turn.provider_conversation_id || "na-conv"}`;
        state._conversationQuerySeen[conversationKey] = state._conversationQuerySeen[conversationKey] || new Set();
        state._conversationQuerySeen[conversationKey].add(qKey);
        state._conversationLastQuery[conversationKey] = qKey;
        const subqueryRef = hash([turn.turn_key, qKey]);
        emit("search_queries", mergedMeta, {
          query: clamp(q, MAX_TEXT),
          query_key: qKey,
          subquery_ref: subqueryRef,
        });
      }

      if (hasSignal && state._querySeen[turn.turn_key].size === 0 && turn.prompt_count > 0) {
        const orphanPrompt = state.events
          .slice()
          .reverse()
          .find((e) => e.capture_turn_id === turn.turn_key && e.event_type === "prompt_sent" && e.payload?.prompt);
        const fallbackQuery = orphanPrompt?.payload?.prompt;
        if (fallbackQuery) {
          const qKey = key(fallbackQuery);
          if (qKey) {
            state._querySeen[turn.turn_key].add(qKey);
            emit("search_queries", mergedMeta, {
              query: clamp(fallbackQuery, MAX_TEXT),
              query_key: qKey,
              subquery_ref: hash([turn.turn_key, qKey]),
              inferred_from_prompt: true,
            });
          }
        }
      }

      for (const r of extracted.results) {
        const normalizedUrl = normalizeUrl(r.url);
        const siteName = String(r.site_name || "").trim().toLowerCase().replace(/^www\./, "");
        if (!siteName || isLikelyInternalSite(siteName)) continue;
        if (!normalizedUrl && !siteName.includes(".")) continue;
        if (isLikelyAssetUrl(normalizedUrl)) continue;
        const qKey = key(r.query || "__unscoped__") || "__unscoped__";
        const maybeSingleQuery = state._querySeen[turn.turn_key].size === 1 ? [...state._querySeen[turn.turn_key]][0] : null;
        const conversationKey = `${turn.provider}::${turn.provider_conversation_id || "na-conv"}`;
        const conversationQuerySet = state._conversationQuerySeen[conversationKey];
        const maybeConversationQuery =
          conversationQuerySet?.size === 1 ? [...conversationQuerySet][0] : state._conversationLastQuery[conversationKey] || null;
        const effectiveQKey =
          qKey === "__unscoped__" && (maybeSingleQuery || maybeConversationQuery)
            ? maybeSingleQuery || maybeConversationQuery
            : qKey;
        const subqueryRef = effectiveQKey === "__unscoped__" ? undefined : hash([turn.turn_key, effectiveQKey]);
        const resultRef = hash([turn.turn_key, effectiveQKey, key(siteName), key(normalizedUrl || "")]);
        if (state._resultSeen[turn.turn_key].has(resultRef)) continue;
        state._resultSeen[turn.turn_key].add(resultRef);

        emit("search_results", mergedMeta, {
          query: effectiveQKey === "__unscoped__" ? r.query : effectiveQKey,
          query_key: effectiveQKey,
          subquery_ref: subqueryRef,
          result_ref: resultRef,
          site_name: siteName,
          url: normalizedUrl,
          title: r.title,
        });
      }

      const finishReason = pickFirstString(obj, ["finish_reason", "reason", "stop_reason", "status"]);
      if (finishReason && /finish|complete|done|stop|success/i.test(finishReason)) {
        emit("response_finished", mergedMeta, { reason: clamp(finishReason, 60) });
      }
    }
  };

  const isLikelyStream = (res, requestUrl) => {
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text/event-stream") || ct.includes("ndjson") || ct.includes("jsonl")) return true;
    return /stream|conversation|chat|completion|message|sse/i.test(String(requestUrl || ""));
  };

  window.fetch = async function patchedFetch(...args) {
    const requestUrl = typeof args[0] === "string" ? args[0] : args[0]?.url;
    const provider = detectProvider(requestUrl || location.href);

    const res = await state._origFetch.apply(this, args);
    try {
      const baseMeta = {
        provider,
        provider_conversation_id: undefined,
        provider_request_id: undefined,
        provider_turn_id: undefined,
      };

      try {
        const reqInit = args[1] || {};
        const requestBody = typeof reqInit?.body === "string" ? reqInit.body : undefined;
        if (requestBody) {
          const parsedReq = parseJsonIfPossible(requestBody);
          const reqObj = asObj(parsedReq);
          if (reqObj) {
            const reqPrompt =
              pickFirstString(reqObj, ["prompt", "query", "text", "input"]) ||
              pickFirstString(asObj(reqObj.message) || {}, ["content", "text"]) ||
              (() => {
                const messages = Array.isArray(reqObj.messages) ? reqObj.messages : [];
                for (let i = messages.length - 1; i >= 0; i -= 1) {
                  const msg = asObj(messages[i]) || {};
                  const role = pickFirstString(msg, ["role", "author_role", "author"]);
                  if (role && role.toLowerCase() !== "user") continue;
                  const content = asObj(msg.content) || {};
                  const parts = Array.isArray(content.parts) ? content.parts : [];
                  for (const part of parts) {
                    const maybeText = typeof part === "string" ? part : pickFirstString(asObj(part) || {}, ["text", "content"]);
                    if (maybeText) return maybeText;
                  }
                  const msgText = pickFirstString(msg, ["text", "content"]);
                  if (msgText) return msgText;
                }
                return undefined;
              })();
            const reqConversationId = pickFirstString(reqObj, ["conversation_id", "conversationId", "conversation"]);
            const reqRequestId = pickFirstString(reqObj, ["request_id", "requestId", "message_id", "response_id"]);
            const reqTurnId = pickFirstString(reqObj, ["turn_id", "turnId", "turn_exchange_id", "turnExchangeId"]);
            if (reqPrompt) {
              emit("prompt_sent", {
                ...baseMeta,
                provider_conversation_id: reqConversationId,
                provider_request_id: reqRequestId,
                provider_turn_id: reqTurnId,
              }, {
                prompt: clamp(reqPrompt, MAX_TEXT),
                prompt_ref: hash([provider, reqConversationId || "na-conv", reqRequestId || "na-req", reqPrompt]),
              });
            }
          }
        }
      } catch {}

      const clone = res.clone();
      if (isLikelyStream(clone, requestUrl)) {
        (async () => {
          try {
            if (!clone.body) {
              const txt = await clone.text();
              processChunkText(baseMeta, txt);
              return;
            }
            const reader = clone.body.getReader();
            const decoder = new TextDecoder();
            let pending = "";
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              pending += decoder.decode(value, { stream: true });
              const parts = pending.split(/\r?\n\r?\n/);
              pending = parts.pop() || "";
              for (const p of parts) processChunkText(baseMeta, p);
            }
            if (pending) processChunkText(baseMeta, pending);
          } catch (err) {
            console.warn("[AI-SEO DEBUG] stream read failed", err);
          }
        })();
      } else {
        clone
          .text()
          .then((txt) => processChunkText(baseMeta, txt))
          .catch(() => {});
      }
    } catch (err) {
      console.warn("[AI-SEO DEBUG] fetch instrumentation error", err);
    }
    return res;
  };

  XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
    this.__aiseoDebugMeta = { method, url: String(url || "") };
    return state._origXHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function patchedSend(...args) {
    try {
      const meta = this.__aiseoDebugMeta || {};
      const provider = detectProvider(meta.url || location.href);
      this.addEventListener("load", () => {
        try {
          if (this.responseType && this.responseType !== "" && this.responseType !== "text") return;
          const txt = typeof this.responseText === "string" ? this.responseText : "";
          if (!txt) return;
          processChunkText({ provider }, txt);
        } catch (err) {
          console.warn("[AI-SEO DEBUG] xhr load parse failed", err);
        }
      });
    } catch {}
    return state._origXHRSend.apply(this, args);
  };

  state.export = () =>
    JSON.stringify(
      {
        exported_at: nowIso(),
        events: state.events,
        turns: Object.values(state.turns).map((t) => ({
          turn_key: t.turn_key,
          provider: t.provider,
          provider_conversation_id: t.provider_conversation_id,
          provider_request_id: t.provider_request_id,
          provider_turn_id: t.provider_turn_id,
          started_at: t.started_at,
          finished_at: t.finished_at,
          prompt_count: t.prompt_count,
          query_count: t.query_count,
          result_count: t.result_count,
          missing_linkage_warnings: t.missing_linkage_warnings,
        })),
      },
      null,
      2,
    );

  state.unpatch = () => {
    try {
      window.fetch = state._origFetch;
      XMLHttpRequest.prototype.open = state._origXHROpen;
      XMLHttpRequest.prototype.send = state._origXHRSend;
      state.isPatched = false;
      console.info("[AI-SEO DEBUG] unpatched");
    } catch (err) {
      console.warn("[AI-SEO DEBUG] unpatch failed", err);
    }
  };

  window[NAMESPACE] = state;
  console.info("[AI-SEO DEBUG] patched", {
    namespace: NAMESPACE,
    usage: [
      "window.__AISEO_STREAM_DEBUG__.events",
      "window.__AISEO_STREAM_DEBUG__.turns",
      "window.__AISEO_STREAM_DEBUG__.export()",
      "window.__AISEO_STREAM_DEBUG__.unpatch()",
    ],
  });
})();
