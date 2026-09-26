/**
 * relayHandler — the shared HTTP handler for the AI relay.
 *
 * Exposed two ways so the app always has an AI backend in dev AND in preview:
 *   1. `aiRelay.mjs`     — standalone server on :8791 (for `vite preview`)
 *   2. `vite.config.ts`  — mounts these same routes on the dev server itself,
 *                          so `npm run dev` needs NO second process, no port,
 *                          no CORS. That's why the app is served at /ai etc.
 *
 * The user owns the model: they paste an Endpoint URL + API key in the app's AI
 * settings; we persist them to `ai.config.json` next to this file and never
 * echo the key back over HTTP (only a boolean hasKey).
 *
 * Routes:
 *   GET  /config  → { endpoint, model, hasKey }   (never echoes the key)
 *   POST /config  → { endpoint?, apiKey?, model? }  (persist to ai.config.json)
 *   GET  /models  → proxy `${endpoint}/models`     (model dropdown source)
 *   POST /ai      → { message, context } → { reply, actions }
 *
 * Chart actions: the relay plans WHAT to draw from the real bars the app sends
 * (FVGs, order blocks, trend lines, S/R, indicators). That layer is
 * deterministic, so "add MACD" actually lands on the chart instead of the model
 * merely claiming it did. If the model returns a fenced ```json action block,
 * that is parsed and executed too — full autonomy, with a reliable floor.
 *
 * PLAIN JAVASCRIPT — this is imported by vite.config (a .ts file that runs in
 * Node, not bundled for the browser), so no TypeScript syntax lives here.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "ai.config.json");

const ANSWER_TIMEOUT_MS = 120_000;

/* ------------------------------------------------------------------ *
 * Config persistence                                                 *
 * ------------------------------------------------------------------ */

function loadConfig() {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, "utf8");
      const j = JSON.parse(raw);
      return {
        endpoint: String(j.endpoint ?? ""),
        apiKey: String(j.apiKey ?? ""),
        model: String(j.model ?? ""),
      };
    }
  } catch {
    /* corrupt or missing file — fall through to empty */
  }
  return { endpoint: "", apiKey: "", model: "" };
}

function saveConfig(patch) {
  const cur = loadConfig();
  const next = {
    endpoint: patch.endpoint ?? cur.endpoint,
    apiKey: patch.apiKey ?? cur.apiKey,
    model: patch.model ?? cur.model,
  };
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}

/** Never log or echo the key. */
function redacted(c) {
  return { endpoint: c.endpoint, model: c.model, hasKey: Boolean(c.apiKey) };
}

/* ------------------------------------------------------------------ *
 * OpenAI-compatible transport                                        *
 * ------------------------------------------------------------------ */

/**
 * Normalise an endpoint base and resolve a path under it. Users paste all of
 * these: `https://api.openai.com/v1`, `.../v1/`, `http://localhost:1234` (LM
 * Studio), `https://api.groq.com/openai/v1`, `https://openrouter.ai/api/v1`.
 * We append the path, collapsing duplicated slashes.
 */
function resolveUrl(endpoint, path) {
  const base = String(endpoint).trim().replace(/\/+$/, "");
  const tail = String(path).replace(/^\/+/, "");
  return `${base}/${tail}`;
}

async function fetchModels(endpoint, apiKey) {
  if (!endpoint) throw new Error("no endpoint configured");
  // OpenAI-compatible servers expose `GET /models` under the API base. Some
  // dev servers (older LM Studio / Ollama builds) serve it WITHOUT the `/v1`
  // prefix, so try the exact base first, then the `/v1` variant.
  const ep = String(endpoint).trim();
  const candidates = [resolveUrl(ep, "models")];
  if (!/\/v\d+\/?$/.test(ep)) {
    candidates.push(resolveUrl(ep + "/v1", "models"));
  }

  let lastErr = "unknown";
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        lastErr = `${res.status} ${await res.text().catch(() => "")}`.trim();
        // 404 → this candidate is the wrong path shape; try the next.
        if (res.status === 404) continue;
        throw new Error(lastErr);
      }
      const j = await res.json();
      const ids = Array.isArray(j?.data)
        ? j.data.map((m) => String(m.id)).filter(Boolean)
        : [];
      if (!ids.length) throw new Error("endpoint returned no models");
      return ids.sort((a, b) => a.localeCompare(b));
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      // Network/parse error on the first candidate → try the /v1 variant too.
      continue;
    }
  }
  throw new Error(`could not list models from ${endpoint} (${lastErr})`);
}

/**
 * Call `${endpoint}/chat/completions`. Non-streaming: the app shows a
 * "thinking…" indicator and this returns the whole answer at once, which keeps
 * the action-parsing simple and reliable.
 *
 * Cheap endpoints (free tiers especially) throw transient 500s and 429s all the
 * time; a single failure would make the whole AI look dead, so we retry a few
 * times with a short backoff before giving up.
 */
/**
 * Turn a raw provider failure into a plain-English message the user can act
 * on. The old behaviour dumped `429 {"error":{"message":"You've used this
 * period's free allowance...` into the chat, which reads like the app is
 * broken rather than the account.
 *
 * Rules, most-specific first:
 *   - quota / allowance exhausted → say so, and that a different model may
 *     still work (that is the common free-tier case, and switching models is
 *     the one action that fixes it);
 *   - invalid key / unauthorised → tell them to re-check the key in settings;
 *   - model not found → the model id is wrong or not on this account;
 *   - server / timeout → the provider is having trouble, retry later;
 *   - anything else → surface the provider's own message, trimmed, so nothing
 *     is hidden but at least it is separated from the status code.
 */
function explainProviderError(status, rawBody) {
  let body = String(rawBody || "");
  // Pull the provider's message out of the JSON envelope if there is one, so
  // the user sees words and not a JSON blob.
  let providerMsg = "";
  try {
    const j = JSON.parse(body);
    providerMsg = String(j?.error?.message || j?.message || j?.error || "").trim();
  } catch {
    providerMsg = body.trim();
  }
  const low = providerMsg.toLowerCase();
  const MAX = 220;

  if (status === 401 || status === 403 || /invalid api key|unauthor|forbidden/.test(low)) {
    return "Your API key was rejected by the provider. Open the AI settings (the gear icon) and paste the key again — check for extra spaces or a half-copied key.";
  }
  if (status === 404 || /model not found|does not exist|no such model/.test(low)) {
    return `The model could not be found on this provider. It may have been renamed, or your account may not include it. Pick a different model in the AI settings dropdown. (provider said: ${providerMsg.slice(0, MAX)})`;
  }
  if (
    status === 429 ||
    /quota|allowance|rate limit|exhaust|used this period|insufficient|credit|balance/i.test(providerMsg)
  ) {
    return "Your AI provider has run out of free allowance (or hit a rate limit) for this model. The connection itself is fine — switch to a different model in the AI settings dropdown, or top up your provider account, then send the message again.";
  }
  if (status >= 500 || /server error|internal error|timeout|timed out|unavailable/i.test(providerMsg)) {
    return `The AI provider's server is having trouble right now (it answered ${status}). Nothing is wrong with the app or your settings — wait a moment and send the message again. (provider said: ${providerMsg.slice(0, MAX)})`;
  }
  if (providerMsg) {
    return `The AI provider rejected the request (${status}): ${providerMsg.slice(0, MAX)}`;
  }
  return `The AI provider answered with an error (HTTP ${status}). Check the endpoint URL in the AI settings, then try again.`;
}

async function chatComplete(cfg, messages) {
  if (!cfg.endpoint) throw new Error("no endpoint configured");
  if (!cfg.model) throw new Error("no model selected");
  const url = resolveUrl(cfg.endpoint, "chat/completions");

  const MAX_ATTEMPTS = 3;
  let lastErr = "unknown";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: cfg.model,
          messages,
          temperature: 0.7,
          stream: false,
        }),
        signal: AbortSignal.timeout(ANSWER_TIMEOUT_MS),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        lastErr = `${res.status} ${body.slice(0, 300)}`.trim();
        // Retry on transient server/rate errors; fail fast on auth/not-found.
        const transient = res.status >= 500 || res.status === 429 || res.status === 408;
        if (transient && attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 800 * attempt));
          continue;
        }
        // Turn the raw provider error into something the user can act on.
        // "502 The model endpoint didn't answer (429 {"error":{"message":...
        // was incomprehensible — the user has no way to tell a used-up free
        // tier from a wrong API key from a dead server.
        throw new Error(explainProviderError(res.status, body));
      }
      const j = await res.json();
      const text = j?.choices?.[0]?.message?.content ?? "";
      if (!text) throw new Error("empty completion");
      return text;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      // Network blip or abort → retry with backoff.
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
        continue;
      }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr);
}

/**
 * Turn the chart-state object into a short sentence for the model, so it
 * doesn't have to interpret the raw object. Mirrors the client-side version.
 */
function describeChart(s) {
  if (!s || typeof s !== "object") return "";
  const parts = [];
  const drawings = Array.isArray(s.drawings) ? s.drawings : [];
  if (drawings.length) {
    parts.push(
      drawings
        .map((d) => {
          const det = Array.isArray(d.detail) && d.detail.length
            ? ` (${d.detail.join(", ")})`
            : "";
          return `${d.count} ${d.type}${det}`;
        })
        .join(", "),
    );
  } else {
    parts.push("no drawings");
  }
  if (Array.isArray(s.indicators) && s.indicators.length) {
    parts.push(`indicators: ${s.indicators.join(", ")}`);
  }
  if (s.price) parts.push(`last price ${s.price}`);
  return parts.join(" | ");
}

/* ------------------------------------------------------------------ *
 * CHART ACTIONS — deterministic planning from real prices.           *
 * ------------------------------------------------------------------ */

/**
 * Detect order blocks — the last opposite-colour candle before an impulse
 * move (a "smart money" concept). Bullish OB: the last DOWN candle before a
 * strong up move; bearish OB: the last UP candle before a strong down move.
 */
function findOrderBlocks(bars, max = 6) {
  const obs = [];
  const body = (b) => Math.abs(b.close - b.open);
  for (let i = 2; i < bars.length - 1; i++) {
    const b = bars[i];
    const next = bars[i + 1];
    const isUp = b.close >= b.open;
    const impulse = body(next) > body(b) * 1.35;
    if (!impulse) continue;
    if (!isUp && next.close > next.open) {
      obs.push({
        up: true,
        from: b.time,
        to: bars[Math.min(i + 2, bars.length - 1)].time,
        top: b.high,
        bottom: b.low,
      });
    } else if (isUp && next.close < next.open) {
      obs.push({
        up: false,
        from: b.time,
        to: bars[Math.min(i + 2, bars.length - 1)].time,
        top: b.high,
        bottom: b.low,
      });
    }
    if (obs.length >= max) break;
  }
  return obs;
}

/** Detect fair value gaps (3-bar imbalance), newest first. */
function findFVGs(bars, max = 12) {
  const gaps = [];
  for (let i = 1; i < bars.length - 1; i++) {
    const a = bars[i - 1];
    const c = bars[i + 1];
    if (c.low > a.high) {
      gaps.push({ up: true, from: bars[i].time, to: c.time, top: c.low, bottom: a.high });
    } else if (c.high < a.low) {
      gaps.push({ up: false, from: bars[i].time, to: c.time, top: a.low, bottom: c.high });
    }
    if (gaps.length >= max) break;
  }
  return gaps;
}

/** Swing highs/lows — a bar whose high exceeds `span` neighbours on each side. */
function swings(bars, span = 3) {
  const highs = [];
  const lows = [];
  for (let i = span; i < bars.length - span; i++) {
    const b = bars[i];
    let isHigh = true;
    let isLow = true;
    for (let j = i - span; j <= i + span; j++) {
      if (j === i) continue;
      if (bars[j].high >= b.high) isHigh = false;
      if (bars[j].low <= b.low) isLow = false;
    }
    if (isHigh) highs.push({ time: b.time, price: b.high });
    if (isLow) lows.push({ time: b.time, price: b.low });
  }
  return { highs, lows };
}

const IND_MAP = {
  macd: "macd",
  rsi: "rsi",
  ema: "moving-average",
  sma: "moving-average",
  "moving average": "moving-average",
  bollinger: "bollinger-bands",
  "bollinger bands": "bollinger-bands",
  atr: "average-true-range",
  "average true range": "average-true-range",
  stochastic: "stochastic",
  stoch: "stochastic",
  supertrend: "supertrend",
  vwap: "vwap",
  ichimoku: "ichimoku",
  sar: "parabolic-sar",
  "parabolic sar": "parabolic-sar",
  adx: "average-directional-index",
  "average directional": "average-directional-index",
  obv: "on-balance-volume",
  "on balance volume": "on-balance-volume",
  "zig zag": "zigzag",
  zigzag: "zigzag",
  pivots: "pivot-points",
  "pivot points": "pivot-points",
  aroon: "aroon",
  "awesome oscillator": "awesome-oscillator",
  "commodity channel": "commodity-channel-index",
  cci: "commodity-channel-index",
  "chande momentum": "chande-momentum-oscillator",
  "choppiness index": "choppiness-index",
  "money flow": "chaikin-money-flow",
  "connors rsi": "connors-rsi",
  "stochastic rsi": "stochastic-rsi",
  "volume oscillator": "volume-oscillator",
  "52 week": "52-week-high-low",
};

const TOOL_MAP = {
  "trend line": "trendline",
  trendline: "trendline",
  trend: "trendline",
  ray: "ray",
  "extended line": "extendedline",
  "horizontal line": "hline",
  hline: "hline",
  "vertical line": "vline",
  vline: "vline",
  box: "box",
  rectangle: "box",
  circle: "circle",
  ellipse: "circle",
  triangle: "triangle",
  channel: "parallelchannel",
  "parallel channel": "parallelchannel",
  "fib retracement": "fibretracement",
  fib: "fibretracement",
  "fib extension": "fibextension",
  "fib fan": "fibfan",
  pitchfork: "pitchfork",
  "gann box": "gannbox",
  "gann fan": "gannfan",
  text: "text",
  note: "text",
  callout: "callout",
  brush: "freehand",
  freehand: "freehand",
};

/**
 * Plan concrete chart actions from the user's words + real bars.
 * Returns { actions, note } — `note` tells the model what already happened.
 */
function planActions(msg, bars) {
  const t = msg.toLowerCase();
  const actions = [];
  const note = [];

  // 1. Pine script passthrough.
  if (t.startsWith("pine") || msg.includes("//@version") || msg.includes("indicator(")) {
    const src = msg.replace(/^pine\s*/i, "").trim();
    if (src) {
      actions.push({ type: "pine", source: src });
      note.push("ran the Pine script on the chart");
      return { actions, note };
    }
  }

  // 2. Order blocks — box the last opposite candle before each impulse.
  if (/\border ?block|\bob\b|smart money|smc/.test(t)) {
    const obs = findOrderBlocks(bars);
    for (const o of obs.slice(0, 6)) {
      actions.push({
        type: "plotAt",
        tool: "box",
        anchors: [
          { time: o.from, price: o.top },
          { time: o.to, price: o.bottom },
        ],
      });
    }
    if (actions.length) {
      note.push(
        `boxed ${actions.length} order block(s) on the visible bars ` +
          `(most recent: ${obs[0].up ? "bullish" : "bearish"}, ` +
          `${obs[0].bottom}–${obs[0].top})`,
      );
      return { actions, note };
    }
    note.push("found no clean order blocks on the visible bars");
    return { actions, note };
  }

  // 3. Mark fair value gaps — box each real gap. Only the VISIBLE bars are
  //    passed in, so boxes land on screen, not back in history.
  if (/fvg|fair value gap/.test(t)) {
    const gaps = findFVGs(bars);
    for (const g of gaps.slice(0, 8)) {
      actions.push({
        type: "plotAt",
        tool: "box",
        anchors: [
          { time: g.from, price: g.top },
          { time: g.to, price: g.bottom },
        ],
      });
    }
    if (actions.length) {
      note.push(
        `boxed ${actions.length} fair value gap(s) on the visible bars ` +
          `(most recent: ${gaps[0].up ? "bullish" : "bearish"}, ` +
          `${gaps[0].bottom}–${gaps[0].top})`,
      );
      return { actions, note };
    }
    note.push("found no clean fair value gaps on the loaded bars");
    return { actions, note };
  }

  // 4. Support / resistance from swing points → horizontal lines.
  if (/support|resistance|s\/r|key level/.test(t)) {
    const { highs, lows } = swings(bars);
    const resistance = highs.at(-1);
    const support = lows.at(-1);
    if (resistance) {
      actions.push({
        type: "plotAt",
        tool: "hline",
        anchors: [{ time: bars[0].time, price: resistance.price }],
      });
      note.push(`drew resistance at ${resistance.price}`);
    }
    if (support) {
      actions.push({
        type: "plotAt",
        tool: "hline",
        anchors: [{ time: bars[0].time, price: support.price }],
      });
      note.push(`drew support at ${support.price}`);
    }
    if (actions.length) return { actions, note };
    note.push("no clear swing levels found");
    return { actions, note };
  }

  // 5. Trend line — connect the two most recent same-direction swings.
  if (/trend ?line|trend\b/.test(t) || TOOL_MAP[t.trim()]) {
    const { highs, lows } = swings(bars);
    const twoLows = lows.slice(-2);
    const twoHighs = highs.slice(-2);
    let a;
    let b;
    if (twoLows.length === 2 && twoLows[1].price >= twoLows[0].price) {
      [a, b] = twoLows;
      note.push("connected the two most recent higher lows (uptrend)");
    } else if (twoHighs.length === 2 && twoHighs[1].price <= twoHighs[0].price) {
      [a, b] = twoHighs;
      note.push("connected the two most recent lower highs (downtrend)");
    } else if (twoLows.length === 2) {
      [a, b] = twoLows;
      note.push("connected the two most recent swing lows");
    } else if (twoHighs.length === 2) {
      [a, b] = twoHighs;
      note.push("connected the two most recent swing highs");
    }
    if (a && b) {
      actions.push({
        type: "plotAt",
        tool: "trendline",
        anchors: [
          { time: a.time, price: a.price },
          { time: b.time, price: b.price },
        ],
      });
      return { actions, note };
    }
    actions.push({ type: "draw", tool: "trendline" });
    note.push("armed the trend line tool (not enough swing points to auto-place)");
    return { actions, note };
  }

  // 6. Any other named drawing tool → arm it.
  for (const [phrase, tool] of Object.entries(TOOL_MAP)) {
    if (t.includes(phrase)) {
      actions.push({ type: "draw", tool });
      note.push(`armed the ${phrase} tool — click the chart to place it`);
      return { actions, note };
    }
  }

  // 7. Indicators — by name, with an optional length ("ema 200", "rsi 14").
  for (const [phrase, id] of Object.entries(IND_MAP)) {
    if (t.includes(phrase)) {
      const len = parseInt(t.match(/(\d{1,4})/)?.[1] ?? "", 10);
      const inputs = len ? { length: len } : undefined;
      actions.push({ type: "indicator", indicator: id, inputs });
      note.push(`added ${phrase.toUpperCase()}${len ? " " + len : ""} to the chart`);
      return { actions, note };
    }
  }

  // 8. Clear drawings.
  if (/clear|remove|delete/.test(t) && /draw|line|box|fvg|all/.test(t)) {
    actions.push({ type: "clearDrawings" });
    note.push("cleared all drawings from the chart");
    return { actions, note };
  }

  return { actions, note };
}

/**
 * Parse a fenced ```json block the model emitted to request chart actions.
 * The model is free to describe arbitrary drawings this way — full autonomy
 * beyond the deterministic phrases above. Malformed JSON is ignored (the prose
 * answer is still shown), never thrown.
 */
function parseModelActions(text) {
  const blocks = text.match(/```(?:json)?\s*([\s\S]*?)```/g) ?? [];
  const out = [];
  for (const blk of blocks) {
    const inner = blk.replace(/```(?:json)?\s*/m, "").replace(/```$/m, "").trim();
    try {
      const j = JSON.parse(inner);
      const arr = Array.isArray(j) ? j : j?.actions;
      if (!Array.isArray(arr)) continue;
      for (const a of arr) {
        if (a && typeof a === "object" && typeof a.type === "string") {
          out.push(a);
        }
      }
    } catch {
      /* not a JSON action block — it's just a code snippet in the answer */
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Request helpers                                                    *
 * ------------------------------------------------------------------ */

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Handle one request. `req.url` may already be a full path ("/models") — Vite
 * passes the path; the standalone server passes it too.
 *
 * Returns true when the request was one of ours (handled), false when it
 * wasn't (so the caller can fall through to Vite's static/SPA middleware
 * instead of 404ing the app itself).
 */
export async function handleRelay(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }

  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const ours = ["/config", "/models", "/ai"];
  if (!ours.includes(url.pathname)) return false;

  // GET /config — the app reads this on open to pre-fill the settings form.
  // The API key is never returned; only whether one is stored.
  if (req.method === "GET" && url.pathname === "/config") {
    send(res, 200, redacted(loadConfig()));
    return true;
  }

  // POST /config — save the endpoint and/or key and/or model.
  if (req.method === "POST" && url.pathname === "/config") {
    try {
      const j = JSON.parse(await readBody(req));
      const patch = {};
      if (typeof j.endpoint === "string") patch.endpoint = j.endpoint.trim();
      // An explicit empty string clears the key; `undefined` leaves it alone.
      if (j.apiKey !== undefined && typeof j.apiKey === "string") {
        patch.apiKey = j.apiKey.trim();
      }
      if (typeof j.model === "string") patch.model = j.model.trim();
      const next = saveConfig(patch);
      send(res, 200, { ok: true, config: redacted(next) });
    } catch (e) {
      send(res, 400, { ok: false, error: String(e instanceof Error ? e.message : e) });
    }
    return true;
  }

  // GET /models — the model dropdown. Proxied server-side so the browser never
  // holds the key and CORS is never a problem.
  if (req.method === "GET" && url.pathname === "/models") {
    try {
      const cfg = loadConfig();
      const models = await fetchModels(cfg.endpoint, cfg.apiKey);
      send(res, 200, { ok: true, models });
    } catch (e) {
      send(res, 502, {
        ok: false,
        models: [],
        error: String(e instanceof Error ? e.message : e),
      });
    }
    return true;
  }

  // POST /ai — the chat itself.
  if (req.method === "POST" && url.pathname === "/ai") {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      send(res, 400, { ok: false, error: "bad payload" });
      return true;
    }

    const msg = String(payload?.message ?? "").slice(0, 4000);
    if (!msg) {
      send(res, 400, { ok: false, error: "empty message" });
      return true;
    }

    const cfg = loadConfig();
    const ctx = payload?.context ?? {};
    const bars = Array.isArray(ctx.bars) ? ctx.bars : [];
    const last = bars.at(-1);
    const summary = last
      ? `Last bar: O ${last.open} H ${last.high} L ${last.low} C ${last.close} (${bars.length} bars loaded).`
      : "(no bars loaded yet)";

    // WHAT'S ON THE CHART — drawings, indicators, price. The app sends this
    // (context.chart) so "what do you see?" gets a truthful answer instead of
    // a guess. `describeChart` renders it as one short sentence.
    const chart = ctx.chart ?? {};
    const chartLine = describeChart(chart) || "chart state unavailable";

    // THE ACTION LAYER: decide what to draw from the real bars, here, so the
    // chart actually changes. The model then narrates what happened.
    const planned = planActions(msg, bars);

    // Not configured yet — answer with the local resolver so the panel is
    // never dead, and say plainly why there's no LLM reply.
    if (!cfg.endpoint || !cfg.model) {
      const localReply = planned.actions.length
        ? `Done — ${planned.note.join("; ")}. (No LLM endpoint configured — set one in ⚙ AI settings.)`
        : "No AI endpoint is configured yet. Open ⚙ AI settings, paste your Endpoint URL and API key, pick a model, and I'll answer here. Until then I can still run chart commands: \"mark fvg\", \"order block\", \"add macd\", \"trend line\".";
      send(res, 200, { ok: true, reply: localReply, actions: planned.actions });
      return true;
    }

    // Fast path: greetings don't need a round trip.
    const trivial = /^(hi|hello|hey|yo|sup|gm|good (morning|evening|afternoon)|namaste)\b/i;
    if (trivial.test(msg.trim()) && !planned.actions.length) {
      send(res, 200, {
        ok: true,
        reply: `Hey! 👋 I'm here on ${ctx.symbol ?? "the chart"} (${ctx.timeframe ?? "?"}). Ask me to "mark the fvg", "draw a trend line", "add macd", "support and resistance" — I'll do it on the chart.`,
        actions: [],
      });
      return true;
    }

    // If we already know exactly what to do, do it now and skip the round
    // trip — no point waiting to describe an action we just performed.
    if (planned.actions.length) {
      send(res, 200, {
        ok: true,
        reply: `Done — ${planned.note.join("; ")}. Want anything else? (I can also add indicators, run Pine scripts, or clear the chart.)`,
        actions: planned.actions,
      });
      return true;
    }

    // General question → the user's configured model.
    const system =
      "You are the AI assistant inside a crypto trading chart app. You can see " +
      `symbol ${ctx.symbol ?? "?"} on timeframe ${ctx.timeframe ?? "?"}. ${summary}\n` +
      `Currently on the chart: ${chartLine}\n` +
      "Answer the user's message briefly and helpfully. When they ask what you " +
      "see, report exactly the drawings and indicators above — you really are " +
      "reading the live chart.\n\n" +
      "Chart commands you can execute (the app draws them on the chart): " +
      "mark FVGs, order blocks, trend lines, support/resistance, add indicators " +
      "(ema 200, rsi 14, bollinger, macd…), arm any drawing tool, run Pine " +
      "scripts, or clear drawings. Just say plainly what you would do.\n" +
      "If you want a drawing the built-in commands don't cover, emit a fenced " +
      "```json block with an array of actions, e.g.\n" +
      '```json\n[{ "type": "plotAt", "tool": "box", "anchors": [{ "time": 1790000000, "price": 83000 }, { "time": 1790001000, "price": 82000 }] }]\n```' +
      "\nValid action types: draw (needs tool), plotAt (needs tool + anchors " +
      "of {time, price}), indicator (needs indicator id, optional inputs), " +
      "pine (needs source), clearDrawings.";

    try {
      const text = await chatComplete(cfg, [
        { role: "system", content: system },
        { role: "user", content: msg },
      ]);
      // The model may have requested drawings itself — honour them.
      const extra = parseModelActions(text);
      send(res, 200, { ok: true, reply: text, actions: extra });
    } catch (e) {
      const err = String(e instanceof Error ? e.message : e);
      // The message from chatComplete is already the plain-English explanation
      // (see explainProviderError) — surface it directly. Do NOT re-wrap it in
      // "The model endpoint didn't answer (...)" with the raw JSON inside: that
      // is what confused users into thinking the app itself was broken.
      send(res, 502, {
        ok: false,
        reply: err,
        actions: [],
      });
    }
    return true;
  }

  // A method/path combo we don't handle (e.g. GET /ai) — still one of our
  // routes, so 404 here instead of leaking into Vite's static middleware.
  send(res, 404, { error: "not found" });
  return true;
}
