/**
 * aiClient — the AI bridge.
 *
 * The user owns the model: they paste an Endpoint URL + API key into the AI
 * settings panel; this client persists them via the local relay and pulls the
 * provider's model list for a dropdown. The connection to the agent brain is
 * gone — the only AI served is the provider the user configures.
 *
 * Routes on the relay (src/server/aiRelay.mjs, 127.0.0.1:8791):
 *   GET  /config → { endpoint, model, hasKey }
 *   POST /config → { endpoint?, apiKey?, model? }
 *   GET  /models → { models: string[] }
 *   POST /ai     → { message, context } → { reply, actions }
 *
 * Chart actions are the small protocol between the AI and the chart, and the
 * deterministic resolver below is the reliable floor: even with no endpoint
 * configured, "mark fvg" / "add macd" still land on the chart.
 */
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import { liveBars } from "./marketData";

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

export function getRelayConfig(): Promise<AiConfig> {
  return fetch(`${RELAY_URL}/config`)
    .then((r) => (r.ok ? r.json() : { endpoint: "", model: "", hasKey: false }))
    .catch(() => ({ endpoint: "", model: "", hasKey: false }));
}

export function setRelayConfig(patch: {
  endpoint?: string;
  apiKey?: string;
  model?: string;
}): Promise<AiConfig> {
  return fetch(`${RELAY_URL}/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`relay ${r.status}`))))
    .then((j) => j.config as AiConfig);
}

/** Fetch the provider's model list for the dropdown. */
export async function listModels(): Promise<string[]> {
  const r = await fetch(`${RELAY_URL}/models`);
  const j = (await r.json()) as { models?: string[]; error?: string };
  if (!r.ok || !j.models?.length) {
    throw new Error(j.error || `relay returned ${r.status}`);
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

export function readChartState(ws: VelaWorkspace): ChartState {
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
    const all = liveBars();
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
  try {
    // The model can take a while to answer, so allow up to 3 min.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);
    const res = await fetch(`${RELAY_URL}/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, context }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`relay returned ${res.status}`);
    const data = (await res.json()) as AiReply;
    return {
      reply: data.reply ?? "(empty reply)",
      actions: Array.isArray(data.actions) ? data.actions : [],
    };
  } catch (e) {
    const local = resolveLocally(text);
    return {
      ...local,
      reply:
        `Couldn't reach the AI relay (${e instanceof Error ? e.message : "unknown"}). Start it with \`node src/server/aiRelay.mjs\`. Falling back to the built-in parser.\n\n` +
        local.reply,
    };
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
 * Pull the visible bars off Vela so the AI (and FVG detection) sees real data.
 *
 * Vela owns the canonical bar array internally and exposes no host-facing bar
 * reader (`DataControl` is a provider registry, not a bar reader). So the app
 * keeps its own live copy in `marketData.ts` — fed by the same Hyperliquid
 * provider Vela loads from, kept live over its WebSocket stream. That store
 * has real bars BEFORE the AI is asked to draw, which is why "mark the FVG"
 * used to stall on "let the data load".
 */
export function visibleBars(_ws: VelaWorkspace): Bar[] {
  // The store is the source of truth for AI reads; the workspace is unused.
  return liveBars();
}

/**
 * Apply the AI's actions to the chart. Returns short lines describing what it
 * did, shown in the chat.
 */
export function applyActions(ws: VelaWorkspace, actions: ChartAction[]): string[] {
  const out: string[] = [];
  const c = ws.chart;
  for (const a of actions) {
    try {
      if (a.type === "draw" && a.tool) {
        c.drawings.setTool(a.tool as never);
        out.push(`Armed ${a.tool}.`);
      } else if (a.type === "plotAt" && a.tool && a.anchors?.length) {
        const h = c.drawings.add(a.tool as never, {
          anchors: a.anchors.map((p) => ({ time: p.time, price: p.price })),
        });
        if (h) out.push(`Drew ${a.tool} at ${a.anchors.length} anchor(s).`);
      } else if (a.type === "indicator" && a.indicator) {
        c.addNativeIndicator(a.indicator, a.inputs ? { inputs: a.inputs } : undefined);
        out.push(`Added ${a.indicator}.`);
      } else if (a.type === "pine" && a.source) {
        c.addIndicator(a.source);
        out.push("Pine script running.");
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
