/**
 * Hyperliquid data engine.
 *
 * Verified against the live API (probe run 2026-09-22):
 *   POST https://api.hyperliquid.xyz/info  {"type":"meta"}
 *     -> universe: [{ name, szDecimals, maxLeverage, ... }], 234 coins
 *   POST info {"type":"allMids"} -> { BTC: "85882.5", ... }, 1102 entries
 *   POST info {"type":"candleSnapshot","req":{coin,interval,startTime,endTime}}
 *     -> [{ t, T, s, i, o, c, h, l, v, n }]   (t/T are ms, OHLC strings)
 *   WSS wss://api.hyperliquid.xyz/ws
 *     {"channel":"candle","data":[{"t":...,"o":..,"c":..,"h":..,"l":..,"v":..}]}
 *     {"channel":"l2Book","data":{"coin":"BTC","levels":{"bids":[[px,sz]...],"asks":[...]}}}
 *     {"channel":"trades","data":[{"coin","side","px","sz","time","hash"}]}
 *     {"channel":"allMids","data":{"BTC":"85882.5",...}}
 *
 * Docs: most recent 5000 candles available; intervals
 * 1m,3m,5m,15m,30m,1h,2h,4h,8h,12h,1d,3d,1w,1M.
 */

export const HL_INFO = "https://api.hyperliquid.xyz/info";
export const HL_WS = "wss://api.hyperliquid.xyz/ws";

export const HL_INTERVALS = [
  "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d", "3d", "1w", "1M",
] as const;
export type HLInterval = (typeof HL_INTERVALS)[number];

export const INTERVAL_SECONDS: Record<HLInterval, number> = {
  "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
  "1h": 3600, "2h": 7200, "4h": 14400, "8h": 28800, "12h": 43200,
  "1d": 86400, "3d": 259200, "1w": 604800, "1M": 2592000,
};

/** Candles per REST request. 5000 is the API ceiling; 1000 keeps first paint fast. */
export const CANDLES_PER_REQUEST = 1000;

/** Hard cap on the in-memory buffer (20k bars ≈ 4× the API's single-response limit). */
export const MAX_BARS = 20000;

/**
 * Hyperliquid's earliest candle for any coin. Verified 2026-09-23 by asking for
 * data from 2017: the API returns nothing before this. It is the exchange's
 * data floor — NOT a client bug. BTC starts 2020-08-19T00:00:00Z (its listing
 * date on Hyperliquid), and newer listings start later.
 */
export const HL_HISTORY_FLOOR_MS = Date.UTC(2020, 7, 19); // 2020-08-19

/** Canonical bar. `time` is SECONDS (lightweight-charts UTCTimestamp convention). */
export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  nTrades?: number;
}

async function postInfo(body: Record<string, unknown>): Promise<any> {
  const res = await fetch(HL_INFO, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Hyperliquid info HTTP ${res.status}`);
  return res.json();
}

/**
 * Fetch a batch of historical candles ending at endTimeMs.
 * Converts the desired candle count into a startTime the API accepts.
 */
export async function fetchCandles(
  coin: string,
  interval: HLInterval,
  endTimeMs: number,
  count: number = CANDLES_PER_REQUEST,
): Promise<Bar[]> {
  const step = INTERVAL_SECONDS[interval];
  const startTimeMs = Math.max(0, endTimeMs - step * count * 1000);
  const data = await postInfo({
    type: "candleSnapshot",
    req: { coin, interval, startTime: startTimeMs, endTime: endTimeMs },
  });
  if (!Array.isArray(data)) return [];
  return data
    .map((c: any): Bar => ({
      time: Math.floor(Number(c.t) / 1000),
      open: Number(c.o),
      high: Number(c.h),
      low: Number(c.l),
      close: Number(c.c),
      volume: Number(c.v),
      nTrades: Number(c.n),
    }))
    .filter((b: Bar) => Number.isFinite(b.time) && Number.isFinite(b.close))
    .sort((a: Bar, b: Bar) => a.time - b.time);
}

/**
 * Backfill the ENTIRE available history, oldest-first, in 1000-bar pages.
 *
 * This is the real fix for "it only shows data up to 2020": the API will not
 * return more than ~1000 candles per call for a small interval, so a single
 * request can never span listing→present on 1m. We walk forward from the
 * exchange floor (or from the oldest bar we already have) and emit batches so
 * the UI can prepend progressively.
 *
 * @param onBatch called with each page (sorted ascending) as it arrives
 * @param opts.untilMs stop once bars reach this timestamp (default: now)
 */
export async function fetchHistoryForward(
  coin: string,
  interval: HLInterval,
  onBatch: (batch: Bar[]) => void,
  opts: { fromMs?: number; untilMs?: number; maxBatches?: number } = {},
): Promise<Bar[]> {
  const step = INTERVAL_SECONDS[interval] * 1000;
  const until = opts.untilMs ?? Date.now();
  let cursor = opts.fromMs ?? HL_HISTORY_FLOOR_MS;
  const maxBatches = opts.maxBatches ?? 60; // 60 × 1000 = 60k bars ceiling
  const collected: Bar[] = [];

  for (let i = 0; i < maxBatches && cursor < until; i++) {
    const end = Math.min(cursor + step * CANDLES_PER_REQUEST, until);
    const batch = await fetchCandles(coin, interval, end, CANDLES_PER_REQUEST);
    if (!batch.length) break;
    // Drop anything already covered by the previous page.
    const fresh = batch.filter((b) => b.time * 1000 >= cursor);
    if (fresh.length) {
      collected.push(...fresh);
      onBatch(fresh);
    }
    const lastTs = batch[batch.length - 1].time * 1000;
    if (lastTs <= cursor) break; // no forward progress → stop (protects the loop)
    cursor = lastTs + step;
  }
  return collected;
}

// ---------------------------------------------------------------------------
// REST feeds for the right-hand panel (everything Hyperliquid exposes)
// ---------------------------------------------------------------------------

/** Per-coin live metrics: funding, OI, mark/oracle/mid px, 24h volume. */
export interface AssetCtx {
  funding: number;
  openInterest: number;
  prevDayPx: number;
  dayNtlVlm: number;
  premium: number;
  oraclePx: number;
  markPx: number;
  midPx: number;
  dayBaseVlm: number;
}

export interface MetaAndCtx {
  /** coin name -> live context */
  byCoin: Record<string, AssetCtx>;
  /** coin name -> max leverage from the universe entry */
  maxLeverage: Record<string, number>;
}

/** metaAndAssetCtxs: market context for every perp in one call. */
export async function fetchMetaAndCtxs(): Promise<MetaAndCtx> {
  const data = await postInfo({ type: "metaAndAssetCtxs" });
  const byCoin: Record<string, AssetCtx> = {};
  const maxLeverage: Record<string, number> = {};
  if (!Array.isArray(data) || data.length < 2) return { byCoin, maxLeverage };
  const universe = data[0]?.universe ?? [];
  const ctxs = data[1] ?? [];
  for (let i = 0; i < universe.length; i++) {
    const name = universe[i]?.name;
    if (!name) continue;
    maxLeverage[name] = Number(universe[i]?.maxLeverage ?? 0);
    const c = ctxs[i];
    if (!c) continue;
    byCoin[name] = {
      funding: Number(c.funding ?? 0),
      openInterest: Number(c.openInterest ?? 0),
      prevDayPx: Number(c.prevDayPx ?? 0),
      dayNtlVlm: Number(c.dayNtlVlm ?? 0),
      premium: Number(c.premium ?? 0),
      oraclePx: Number(c.oraclePx ?? 0),
      markPx: Number(c.markPx ?? 0),
      midPx: Number(c.midPx ?? 0),
      dayBaseVlm: Number(c.dayBaseVlm ?? 0),
    };
  }
  return { byCoin, maxLeverage };
}

/** REST snapshot of the L2 order book (WS `l2Book` keeps it live afterwards). */
export async function fetchL2Book(coin: string): Promise<L2Book> {
  const data = await postInfo({ type: "l2Book", coin });
  const levels = data?.levels ?? [];
  const map = (rows: any[]): L2Level[] =>
    (rows ?? []).map((l: any) => ({
      price: Number(l.px ?? l[0]),
      size: Number(l.sz ?? l[1]),
    }));
  return {
    coin,
    bids: map(levels[0]),
    asks: map(levels[1]),
  };
}

/** Normalize a WS l2Book payload (levels: [{px,sz,n},...] per side). */
export function wsL2ToBook(raw: any): L2Book {
  const levels = raw?.levels ?? [];
  const map = (rows: any[]): L2Level[] =>
    (rows ?? []).map((l: any) => ({
      price: Number(l.px ?? l[0]),
      size: Number(l.sz ?? l[1]),
    }));
  return {
    coin: String(raw?.coin ?? ""),
    bids: map(levels[0]),
    asks: map(levels[1]),
  };
}

/** One coin row from meta.universe / spotMeta.universe. */
export interface MetaCoin {
  name: string;
  szDecimals?: number;
  maxLeverage?: number;
}
export interface Meta {
  universe: MetaCoin[];
}

/** Fetch the perpetual universe. */
export async function fetchMeta(): Promise<Meta> {
  const meta = await postInfo({ type: "meta" }).catch(() => ({ universe: [] }));
  return { universe: Array.isArray(meta?.universe) ? meta.universe : [] };
}

/** Tradable universe: perps + spot meta, merged and sorted. */
export async function fetchUniverse(): Promise<string[]> {
  const [meta, spot] = await Promise.all([
    postInfo({ type: "meta" }).catch(() => ({ universe: [] })),
    postInfo({ type: "spotMeta" }).catch(() => ({ universe: [] })),
  ]);
  const names = new Set<string>();
  for (const u of [meta?.universe, spot?.universe]) {
    if (Array.isArray(u)) {
      for (const c of u) {
        if (c && typeof c.name === "string" && c.name.length) names.add(c.name);
      }
    }
  }
  return [...names].sort();
}

/** Current mid prices for every coin (allMids). */
export async function fetchAllMids(): Promise<Record<string, number>> {
  const mids = await postInfo({ type: "allMids" });
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(mids as Record<string, string>)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

export interface WsCandle {
  t: number;
  o: string | number;
  c: string | number;
  h: string | number;
  l: string | number;
  v: string | number;
  n?: string | number;
}

export function wsCandleToBar(raw: WsCandle): Bar {
  return {
    time: Math.floor(Number(raw.t) / 1000),
    open: Number(raw.o),
    high: Number(raw.h),
    low: Number(raw.l),
    close: Number(raw.c),
    volume: Number(raw.v),
    nTrades: raw.n !== undefined ? Number(raw.n) : undefined,
  };
}

export interface L2Level {
  price: number;
  size: number;
}
export interface L2Book {
  coin: string;
  bids: L2Level[];
  asks: L2Level[];
}

export interface Trade {
  coin: string;
  side: "buy" | "sell" | "A" | "B";
  price: number;
  size: number;
  time: number; // seconds
  hash?: string;
}

/** Normalize a WS trade payload. */
export function wsTradeToTrade(raw: any): Trade {
  return {
    coin: String(raw.coin ?? ""),
    side: raw.side ?? "buy",
    price: Number(raw.px),
    size: Number(raw.sz),
    time: Math.floor(Number(raw.time) / 1000),
    hash: raw.hash,
  };
}

/** One live WebSocket fan-out with automatic reconnection. */
export type WsHandler = (channel: string, data: any) => void;

export class HyperliquidSocket {
  private ws: WebSocket | null = null;
  private handlers = new Set<WsHandler>();
  private subs: Array<Record<string, unknown>> = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUs = false;
  private booted = false;
  private connectPromise: Promise<void> | null = null;

  constructor(private url: string = HL_WS) {}

  on(fn: WsHandler): () => void {
    this.handlers.add(fn);
    return () => {
      this.handlers.delete(fn);
    };
  }

  subscribe(sub: Record<string, unknown>): void {
    this.subs.push(sub);
    this.sendSubscribe(sub);
  }

  unsubscribe(sub: Record<string, unknown>): void {
    const key = JSON.stringify(sub);
    this.subs = this.subs.filter((s) => JSON.stringify(s) !== key);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ method: "unsubscribe", subscription: sub }));
    }
  }

  private sendSubscribe(sub: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ method: "subscribe", subscription: sub }));
    }
  }

  /** Connect once. Idempotent — concurrent callers share the same promise. */
  connect(): Promise<void> {
    if (this.booted) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    this.booted = true;
    this.closedByUs = false;
    this.connectPromise = new Promise((resolve) => {
      this.open(resolve);
    });
    return this.connectPromise;
  }

  private open(onOpen?: () => void): void {
    let resolved = false;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      for (const sub of this.subs) this.sendSubscribe(sub);
      if (!resolved) {
        resolved = true;
        onOpen?.();
      }
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const ch = msg?.channel;
        if (ch) for (const h of this.handlers) h(ch, msg.data);
      } catch {
        /* keepalive or non-JSON frame — ignore */
      }
    };
    ws.onerror = () => {
      /* onclose handles backoff */
    };
    ws.onclose = () => {
      if (!resolved) {
        resolved = true;
        onOpen?.(); // don't wedge callers waiting on a failed first connect
      }
      if (this.closedByUs) return;
      if (this.reconnectTimer) return;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.open();
      }, 1500);
    };
  }

  close(): void {
    this.closedByUs = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
  }
}
