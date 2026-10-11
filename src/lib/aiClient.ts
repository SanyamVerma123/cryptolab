/**
 * aiClient — the AI bridge.
 *
 * The user owns the model: they enter an endpoint, API key and model in AI
 * settings. Settings stay in this browser and travel only to the app's relay,
 * which calls the provider and returns chart actions.
 *
 * Routes on the relay:
 *   GET  /config      → { endpoint, model, hasKey } (legacy local config)
 *   POST /api/models  → { config } → { models: string[] }
 *   POST /api/ai      → { config, message, context } → { reply, actions }
 *
 * Chart actions are the small protocol between the AI and the chart, and the
 * deterministic resolver below is the reliable floor: even with no endpoint
 * configured, "mark fvg" / "add macd" still land on the chart.
 */
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import { getChartBars, liveBars } from "./marketData";
import { runPineIndicator } from "./luxAlgoClient";

/** One thing the AI may ask the chart to do. */
export interface ChartAction {
  type:
    | "draw"          // arm a drawing tool for the user to place
    | "plotAt"        // draw programmatically at given time/price anchors
    | "indicator"     // add a native indicator
    | "pine"          // run a Pine script
    | "clearDrawings"
    | "goto";         // scroll the chart to a time
  tool?: string;      // for draw / plotAt: a Vela DrawingTypeKey
  anchors?: { time: number; price: number }[]; // for plotAt
  indicator?: string; // for indicator: a native type
  inputs?: Record<string, number | string | boolean>;
  source?: string;    // for pine
  time?: number;      // for goto
}

export interface AiReply {
  reply: string;
  actions?: ChartAction[];
}

/**
 * The AI relay is mounted ON the Vite dev server, so the routes are same-origin
 * — no separate process to start, no port, no CORS. In `vite preview` the
 * standalone `aiRelay.mjs` provides the same routes on :8791; set
 * VITE_AI_RELAY_URL to point at it if you use that.
 */
export const RELAY_URL = import.meta.env.VITE_AI_RELAY_URL ?? "";

/* ------------------------------------------------------------------ *
 * Endpoint + key + model configuration                               *
 * ------------------------------------------------------------------ */

export interface AiConfig {
  endpoint: string;
  model: string;
  hasKey: boolean;
}

interface StoredAiConfig extends AiConfig { apiKey: string }
const AI_CONFIG_KEY = "trade-pro:ai-config";
let legacyRelayConfig = false;

function readStoredAiConfig(): StoredAiConfig | null {
  try {
    const value = JSON.parse(localStorage.getItem(AI_CONFIG_KEY) ?? "null");
    if (!value || typeof value.endpoint !== "string") return null;
    return {
      endpoint: value.endpoint,
      model: String(value.model ?? ""),
      apiKey: String(value.apiKey ?? ""),
      hasKey: Boolean(value.apiKey),
    };
  } catch {
    return null;
  }
}

function safeRelayConfig(value: unknown): AiConfig {
  const config = value as Partial<AiConfig> | null;
  if (!config || typeof config.endpoint !== "string") {
    throw new Error("AI relay returned an invalid configuration.");
  }
  return {
    endpoint: config.endpoint,
    model: String(config.model ?? ""),
    hasKey: Boolean(config.hasKey),
  };
}

export async function getRelayConfig(): Promise<AiConfig> {
  const stored = readStoredAiConfig();
  if (stored) return { endpoint: stored.endpoint, model: stored.model, hasKey: stored.hasKey };

  // Keep compatibility with desktop installs that still have a relay config.
  // Hosted builds have no persistent server config, so start with blank fields.
  try {
    const response = await fetch(`${RELAY_URL}/config`);
    if (response.ok) {
      const config = safeRelayConfig(await response.json());
      legacyRelayConfig = true;
      return config;
    }
  } catch {
    /* hosted app config is stored per browser */
  }
  return { endpoint: "", model: "", hasKey: false };
}

export async function setRelayConfig(patch: {
  endpoint?: string;
  apiKey?: string;
  model?: string;
}): Promise<AiConfig> {
  const current = readStoredAiConfig();
  if (legacyRelayConfig && !current) {
    const response = await fetch(`${RELAY_URL}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.config) {
      throw new Error(result?.error || `AI relay returned HTTP ${response.status}.`);
    }
    return safeRelayConfig(result.config);
  }
  const next: StoredAiConfig = {
    endpoint: patch.endpoint ?? current?.endpoint ?? "",
    model: patch.model ?? current?.model ?? "",
    apiKey: patch.apiKey === undefined ? current?.apiKey ?? "" : patch.apiKey.trim(),
    hasKey: false,
  };
  next.hasKey = Boolean(next.apiKey);
  try {
    localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(next));
  } catch {
    throw new Error("Could not save AI settings in this browser. Check that site storage is enabled.");
  }
  return { endpoint: next.endpoint, model: next.model, hasKey: next.hasKey };
}

/** Fetch the provider's model list for the dropdown. */
export async function listModels(): Promise<string[]> {
  const config = readStoredAiConfig();
  const r = await fetch(`${RELAY_URL}/api/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config: config ? { endpoint: config.endpoint, apiKey: config.apiKey, model: config.model } : undefined }),
  });
  const j = (await r.json().catch(() => null)) as
    | { models?: string[]; error?: string }
    | null;
  if (!r.ok || !j?.models?.length) {
    throw new Error(j?.error || `AI relay returned HTTP ${r.status}.`);
  }
  return j.models;
}

/* ------------------------------------------------------------------ *
 * The local resolver — the reliable floor. Runs when no endpoint is set, *
 * and as the fallback if the relay is unreachable.                     *
 * ------------------------------------------------------------------ */

export function resolveLocally(text: string): AiReply {
  const t = text.toLowerCase();
  const actions: ChartAction[] = [];

  // Levels are chart drawings, never indicators. Their coordinates are
  // resolved by the panel against the active workspace's canonical bars.
  if (/\b(support|resistance|s\/r|key levels?)\b/.test(t)) {
    return { reply: "I’ll mark the requested support/resistance level on the chart.", actions };
  }

  if (t.includes("fvg") || t.includes("fair value gap")) {
    actions.push({ type: "draw", tool: "box" });
    return {
      reply:
        "Looking for fair value gaps on the visible bars. If I find a clean three-bar gap I'll box it; otherwise the Box tool is armed so you can mark one yourself.",
      actions,
    };
  }

  const toolMatch = TOOL_WORDS.find((w) => w.re.some((r) => r.test(t)));
  if (toolMatch) {
    actions.push({ type: "draw", tool: toolMatch.id });
    return {
      reply: `${toolMatch.label} armed — click on the chart to place it. It extends past the last candle too.`,
      actions,
    };
  }

  const ind = IND_WORDS.find((w) => w.re.some((r) => r.test(t)));
  if (ind) {
    const len = parseInt(t.match(/(\d{1,4})/)?.[1] ?? "", 10);
    actions.push({
      type: "indicator",
      indicator: ind.id,
      inputs: len ? { length: len } : undefined,
    });
    return {
      reply: `Adding ${ind.label}${len ? " " + len : ""} to the chart.`,
      actions,
    };
  }

  if (t.includes("clear") && (t.includes("draw") || t.includes("line") || t.includes("box"))) {
    actions.push({ type: "clearDrawings" });
    return { reply: "Cleared all drawings.", actions };
  }

  if (t.startsWith("pine") || t.includes("//@version") || t.includes("indicator(")) {
    const src = text.replace(/^pine\s*/i, "").trim();
    if (!src) return { reply: "Paste a Pine script after `pine` — e.g. `pine plot(ta.ema(close, 20))`." };
    actions.push({ type: "pine", source: src });
    return { reply: "Running that Pine script on the chart now.", actions };
  }

  if (!/\b(add|insert|mark|draw|plot|show|place|arm|run|clear|remove|delete|erase|create|make|put|apply|find|detect|identify)\b/.test(t)) {
    return {
      reply: "The AI relay is unavailable, so I couldn't answer that question. Reconnect the relay or ask for a direct chart action such as “mark fvg” or “add macd”.",
    };
  }

  return {
    reply:
      "I can: mark FVGs, arm any drawing tool (trend line, box, fib…), add indicators (ema 200, rsi 14, bollinger…), run Pine scripts (`pine <script>`), or clear drawings. Ask in plain English.",
  };
}

const TOOL_WORDS: { id: string; label: string; re: RegExp[] }[] = [
  { id: "trendline", label: "Trend line", re: [/trend ?line/, /trend\b/] },
  { id: "ray", label: "Ray", re: [/\bray\b/] },
  { id: "extendedline", label: "Extended line", re: [/extended/] },
  { id: "hline", label: "Horizontal line", re: [/horizontal/] },
  { id: "vline", label: "Vertical line", re: [/vertical/] },
  { id: "crossline", label: "Cross line", re: [/cross ?line/] },
  { id: "arrow", label: "Arrow", re: [/\barrow\b/] },
  { id: "box", label: "Box", re: [/\bbox\b/, /rectangle/] },
  { id: "circle", label: "Circle", re: [/circle/, /ellipse/] },
  { id: "triangle", label: "Triangle", re: [/triangle/] },
  { id: "parallelchannel", label: "Parallel channel", re: [/channel/] },
  { id: "fibretracement", label: "Fib retracement", re: [/fib.*retr/, /retracement/] },
  { id: "fibextension", label: "Fib extension", re: [/fib.*ext/, /extension/] },
  { id: "fibtimezones", label: "Fib time zones", re: [/fib.*time/, /time zone/] },
  { id: "fibfan", label: "Fib fan", re: [/fib.*fan/, /\bfan\b/] },
  { id: "pitchfork", label: "Andrews pitchfork", re: [/pitchfork/, /andrews/] },
  { id: "schiffpitchfork", label: "Schiff pitchfork", re: [/schiff/] },
  { id: "gannbox", label: "Gann box", re: [/gann.*box/] },
  { id: "gannfan", label: "Gann fan", re: [/gann.*fan/] },
  { id: "text", label: "Text", re: [/\btext\b/, /note\b/] },
  { id: "callout", label: "Callout", re: [/callout/] },
  { id: "freehand", label: "Brush", re: [/brush/, /freehand/, /highlight/] },
  { id: "anchoredvwap", label: "Anchored VWAP", re: [/\bvwap\b/] },
];

const IND_WORDS: { id: string; label: string; re: RegExp[] }[] = [
  { id: "moving-average", label: "EMA", re: [/\bema\b/] },
  { id: "moving-average", label: "SMA", re: [/\bsma\b/] },
  { id: "rsi", label: "RSI", re: [/\brsi\b/, /relative strength/] },
  { id: "macd", label: "MACD", re: [/\bmacd\b/] },
  { id: "bollinger-bands", label: "Bollinger Bands", re: [/bollinger/] },
  { id: "average-true-range", label: "ATR", re: [/\batr\b/] },
  { id: "stochastic", label: "Stochastic", re: [/stochastic/, /\bstoch\b/] },
  { id: "supertrend", label: "Supertrend", re: [/supertrend/] },
  { id: "vwap", label: "VWAP", re: [/\bvwap\b/] },
  { id: "ichimoku", label: "Ichimoku", re: [/ichimoku/] },
  { id: "parabolic-sar", label: "Parabolic SAR", re: [/\bsar\b/, /parabolic/] },
  { id: "average-directional-index", label: "ADX", re: [/\badx\b/] },
  { id: "on-balance-volume", label: "OBV", re: [/\bobv\b/] },
  { id: "zigzag", label: "Zig Zag", re: [/zig ?zag/] },
  { id: "pivot-points", label: "Pivots", re: [/\bpivots?\b/] },
];

/**
 * Read what's actually on the chart — drawings, indicators and price — as a
 * compact description. The AI gets this as `context.chart`, so when the user
 * asks "what do you see?" it can answer truthfully instead of guessing
 * (which is why it used to claim nothing was drawn).
 *
 * Everything is defensively wrapped: a chart that isn't fully ready must still
 * yield an object, never throw.
 */
export interface ChartState {
  drawings: { type: string; count: number; detail: string[] }[];
  indicators: string[];
  price?: number;
  visibleRange?: { from: number; to: number };
}

export function readChartState(ws: VelaWorkspace, activeBars?: readonly Bar[]): ChartState {
  const out: ChartState = { drawings: [], indicators: [] };
  try {
    const docs = ws.chart.drawings.all();
    const byType = new Map<string, string[]>();
    for (const d of docs) {
      const t = String(d.type ?? "drawing");
      let bucket = byType.get(t);
      if (!bucket) {
        bucket = [];
        byType.set(t, bucket);
      }
      // Summarise where a drawing sits (time is ms; anchors are [time, price]).
      try {
        const a = d.anchors as { time?: number; price?: number }[] | undefined;
        const first = a?.[0];
        const last = a?.[a.length - 1];
        const at = first
          ? `@ ${first.price?.toFixed(2) ?? "?"}` +
            (a.length > 1 && last && last.price !== first.price
              ? `–${last.price?.toFixed(2)}`
              : "")
          : "";
        if (at) bucket.push(at);
      } catch {
        /* anchors unreadable — type only */
      }
    }
    for (const [type, items] of byType) {
      out.drawings.push({ type, count: items.length, detail: items.slice(0, 4) });
    }
  } catch {
    /* drawings not ready */
  }

  try {
    // `chart.indicators()` returns live handles. A NATIVE indicator carries
    // `nativeType` ("macd", "rsi"…); a Pine script carries `title` instead.
    const handles = ws.chart.indicators();
    if (Array.isArray(handles)) {
      out.indicators = handles
        .map((h) => {
          const t = (h as { nativeType?: string }).nativeType;
          const title = (h as { title?: string }).title;
          return String(t || title || "");
        })
        .filter(Boolean);
    }
  } catch {
    /* indicators API unavailable */
  }

  try {
    // `inspect()` summarises the whole scene if the handle route is bare.
    const scene = ws.chart.inspect() as {
      indicators?: { nativeType?: string; title?: string }[];
    } | null;
    if (scene?.indicators?.length && !out.indicators.length) {
      out.indicators = scene.indicators.map((i) =>
        String(i.nativeType || i.title || ""),
      ).filter(Boolean);
    }
  } catch {
    /* inspect unavailable */
  }

  try {
    // Vela has no `price()` accessor — the last bar's close IS the latest price.
    const all = activeBars?.length ? activeBars : liveBars();
    const l = all[all.length - 1];
    if (l) out.price = l.close;
  } catch {
    /* price unavailable */
  }

  try {
    const vr = ws.chart.getVisibleRange();
    if (vr) out.visibleRange = vr;
  } catch {
    /* viewport unreadable */
  }

  return out;
}

/**
 * Turn `readChartState` output into a short sentence for the model, so it
 * doesn't have to interpret the raw object.
 */
export function describeChart(s: ChartState): string {
  const parts: string[] = [];
  if (s.drawings.length) {
    parts.push(
      s.drawings
        .map((d) => `${d.count} ${d.type}${d.detail.length ? ` (${d.detail.join(", ")})` : ""}`)
        .join(", "),
    );
  } else {
    parts.push("no drawings");
  }
  if (s.indicators.length) parts.push(`indicators: ${s.indicators.join(", ")}`);
  if (s.price) parts.push(`last price ${s.price}`);
  return parts.join(" | ");
}

/* ------------------------------------------------------------------ *
 * Send + apply                                                       *
 * ------------------------------------------------------------------ */

/**
 * Send a message to the AI. Tries the relay first; on any failure falls back
 * to the local resolver so the panel always answers.
 */
export async function sendToAI(
  text: string,
  context: { symbol: string; timeframe: string; bars: Bar[] },
): Promise<AiReply> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    const config = readStoredAiConfig();
    const res = await fetch(`${RELAY_URL}/api/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, context, config: config ? { endpoint: config.endpoint, apiKey: config.apiKey, model: config.model } : undefined }),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as
      | (AiReply & { error?: string })
      | null;
    if (!res.ok) {
      // The relay includes useful provider diagnostics (bad key, missing
      // model, quota, etc.) in its JSON body. Preserve those instead of
      // hiding them behind the local command parser.
      return {
        reply:
          data?.reply ||
          data?.error ||
          `The AI request failed (HTTP ${res.status}). Check the endpoint and model in AI settings.`,
        actions: Array.isArray(data?.actions) ? data.actions : [],
      };
    }
    if (!data || typeof data.reply !== "string") {
      throw new Error("The AI relay returned an invalid response.");
    }
    return {
      reply: data.reply || "The model returned an empty reply.",
      actions: Array.isArray(data.actions) ? data.actions : [],
    };
  } catch (e) {
    const reason = e instanceof Error
      ? e.name === "AbortError"
        ? "The AI request timed out after 3 minutes. Try a shorter prompt or check the provider."
        : e.message
      : "unknown error";
    const local = resolveLocally(text);
    return {
      ...local,
      reply:
        `Couldn't reach the AI relay (${reason}). In development, start the app with \`npm run dev\`; for preview, start \`node src/server/aiRelay.mjs\`. Falling back to the built-in chart-command parser.\n\n` +
        local.reply,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** One OHLCV bar, for the AI's context. */
export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/**
 * Fair Value Gap detection — a genuine three-bar imbalance:
 * bar[i-1].high < bar[i+1].low (bullish) or bar[i-1].low > bar[i+1].high
 * (bearish). Returns gaps on the visible range, newest first.
 */
export function findFVGs(bars: Bar[], max = 12): { up: boolean; from: number; to: number; top: number; bottom: number }[] {
  const gaps: { up: boolean; from: number; to: number; top: number; bottom: number }[] = [];
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

/**
 * Pull the active market's visible history from the resolved market-data
 * provider. The public workspace API intentionally doesn't expose Vela's
 * internal bar array, so this mirrors the current chart identity and viewport.
 */
export async function visibleBars(ws: VelaWorkspace): Promise<Bar[]> {
  try {
    const market = ws.chart.market;
    const symbol = String(market?.symbol ?? "");
    const timeframe = String(market?.timeframe ?? "");
    const range = ws.chart.getVisibleRange();
    const all = (await getChartBars(
      symbol,
      timeframe,
      market?.provider,
      range ? { from: range.from, to: range.to } : undefined,
    )).map((b) => ({
      time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
    }));
    if (!all.length) return [];
    if (range && Number.isFinite(range.from) && Number.isFinite(range.to)) {
      const visible = all.filter((b) => b.time >= range.from && b.time <= range.to);
      if (visible.length >= 5) return visible;
    }
    return all.slice(-240);
  } catch {
    return [];
  }
}

/** Resolve support/resistance to concrete active-chart swing levels. */
export function supportResistanceActions(text: string, bars: Bar[]): { actions: ChartAction[]; labels: string[] } {
  const t = text.toLowerCase();
  const wantsBoth = /support\s*(?:and|&|\/|,|\+)\s*resistance|resistance\s*(?:and|&|\/|,|\+)\s*support|\bs\/r\b|\bkey levels?\b/.test(t);
  const wantsSupport = wantsBoth || /\bsupport\b/.test(t);
  const wantsResistance = wantsBoth || /\bresistance\b/.test(t);
  const actions: ChartAction[] = [];
  const labels: string[] = [];
  if (bars.length < 5) return { actions, labels };

  const recent = bars.slice(-240);
  const latest = recent[recent.length - 1];
  const ranges = recent.slice(-20).map((b) => Math.max(0, b.high - b.low));
  const avgRange = ranges.reduce((sum, value) => sum + value, 0) / Math.max(1, ranges.length);
  const tolerance = Math.max(avgRange * 0.35, Math.abs(latest.close) * 0.0001);
  const highs: { time: number; price: number; index: number }[] = [];
  const lows: { time: number; price: number; index: number }[] = [];
  for (let i = 2; i < recent.length - 2; i++) {
    const bar = recent[i];
    if (recent.slice(i - 2, i + 3).every((other, j) => j === 2 || bar.high >= other.high)) highs.push({ time: bar.time, price: bar.high, index: i });
    if (recent.slice(i - 2, i + 3).every((other, j) => j === 2 || bar.low <= other.low)) lows.push({ time: bar.time, price: bar.low, index: i });
  }
  const pick = (points: typeof highs, side: "above" | "below") => {
    const eligible = points.filter((p) => side === "above" ? p.price >= latest.close : p.price <= latest.close);
    const pool = eligible.length ? eligible : points;
    if (!pool.length) {
      const price = side === "above" ? Math.max(...recent.map((b) => b.high)) : Math.min(...recent.map((b) => b.low));
      const bar = recent.find((b) => (side === "above" ? b.high : b.low) === price) ?? latest;
      return { time: bar.time, price };
    }
    return pool.map((point) => ({
      ...point,
      touches: points.filter((other) => Math.abs(other.price - point.price) <= tolerance).length,
      distance: Math.abs(point.price - latest.close),
    })).sort((a, b) => a.distance - b.distance || b.touches - a.touches || b.index - a.index)[0];
  };
  const add = (kind: "support" | "resistance", point: { time: number; price: number }) => {
    actions.push({ type: "plotAt", tool: "hline", anchors: [{ time: point.time, price: point.price }] });
    labels.push(`${kind} at ${Number(point.price.toPrecision(8))}`);
  };
  if (wantsResistance) add("resistance", pick(highs, "above"));
  if (wantsSupport) add("support", pick(lows, "below"));
  return { actions, labels };
}

/**
 * Apply the AI's actions to the chart. Returns short lines describing what it
 * did, shown in the chat.
 */
export async function applyActions(ws: VelaWorkspace, actions: ChartAction[]): Promise<string[]> {
  const out: string[] = [];
  const c = ws.chart;
  for (const a of actions) {
    try {
      if (a.type === "draw" && a.tool) {
        c.drawings.setTool(a.tool as never);
        out.push(`Armed ${a.tool}.`);
      } else if (a.type === "plotAt" && a.tool && a.anchors?.length) {
        const valid = a.anchors.every((p) =>
          Number.isFinite(p.time) && p.time >= 946684800000 &&
          Number.isFinite(p.price) && p.price > 0,
        );
        if (!valid) {
          out.push(`Skipped ${a.tool}: its coordinates were invalid or missing.`);
          continue;
        }
        const h = c.drawings.add(a.tool as never, {
          anchors: a.anchors.map((p) => ({ time: p.time, price: p.price })),
        });
        if (h) out.push(`Drew ${a.tool} at ${a.anchors.length} anchor(s).`);
      } else if (a.type === "indicator" && a.indicator) {
        const available = await c.availableNativeIndicators();
        const native = available.find((entry) => entry.type === a.indicator);
        if (!native) throw new Error(`Native indicator “${a.indicator}” is not registered.`);
        if (!native.supported) throw new Error(`Native indicator “${a.indicator}” is unavailable for this symbol or provider.`);
        c.addNativeIndicator(a.indicator, a.inputs ? { inputs: a.inputs } : undefined);
        out.push(`Added ${a.indicator}.`);
      } else if (a.type === "pine" && a.source) {
        const handle = await runPineIndicator(c, a.source, "AI indicator");
        out.push(`Added ${handle.title}.`);
      } else if (a.type === "clearDrawings") {
        const ids = c.drawings.all().map((d) => d.id);
        if (ids.length) c.drawings.removeMany(ids);
        out.push("Cleared all drawings.");
      } else if (a.type === "goto" && a.time) {
        c.setVisibleRange?.({ from: a.time, to: a.time });
        out.push("Scrolled the chart.");
      }
    } catch (e) {
      out.push(`(failed: ${e instanceof Error ? e.message : "unknown"})`);
    }
  }
  return out;
}
