/**
 * derivedMetrics — the analytics layer on top of Hyperliquid's raw streams.
 *
 * The raw feeds give you levels, prints and stats. What a trader actually reads
 * is derived from them:
 *   trades       -> CVD (cumulative volume delta), buy/sell pressure, whale prints
 *   l2Book       -> bid/ask imbalance, spread %, liquidity walls, microprice
 *   activeAssetCtx -> OI change, funding change, mark-vs-oracle deviation
 *
 * Each derived value is computed from the rolling windows this module keeps,
 * so nothing needs a second network round trip — it's all in-memory over the
 * streams already subscribed in useLiveData.
 *
 * Design notes:
 *   - Sizes are BASE units; multiply by price for notional.
 *   - Hyperliquid defines trade side as the AGGRESSING side, so `buy` prints
 *     are taker demand and `sell` prints are taker supply.
 *   - Windows are time-bounded (not count-bounded) so the numbers stay
 *     comparable as the tape's pace changes.
 */

/** One derived snapshot — everything the panels need in a single object. */
export interface DerivedMetrics {
  /** Cumulative volume delta over the window: buy volume minus sell volume. */
  cvd: number;
  /** Net delta as a fraction of total volume (-1..1). */
  cvdPct: number;
  /** Buy volume vs sell volume split, in base units. */
  buyVol: number;
  sellVol: number;
  /** Buy share of volume (0..1) — 0.5 is balanced. */
  buyShare: number;
  /** Trades per minute over the window. */
  tradeRate: number;
  /** Average trade size (base units). */
  avgSize: number;
  /** Largest prints in the window, biggest first (whale watch). */
  bigTrades: BigTrade[];
  /** Book imbalance: notional bid share within the tracked depth (0..1). */
  bookImbalance: number;
  /** Spread as a fraction of mid (bp-like, 0.0001 = 1bp). */
  spreadPct: number;
  /** Microprice — the fair price weighted by top-of-book imbalance. */
  microprice: number | null;
  /** Sum of size at the top N levels each side (liquidity depth). */
  bidDepth: number;
  askDepth: number;
  /** The single largest level within tracked depth (a "wall"), if notable. */
  wall: { side: "bid" | "ask"; price: number; size: number; notional: number } | null;
  /** OI change vs the window's start, in base units. */
  oiChange: number;
  /** Funding change vs the window's start, hourly rate. */
  fundingChange: number;
  /** Mark minus oracle, as a fraction of oracle. */
  markOracleDev: number;
  /** When this snapshot was computed (ms). */
  at: number;
}

export interface BigTrade {
  side: "buy" | "sell";
  price: number;
  size: number;
  /** size * price — what the "large" threshold is measured against. */
  notional: number;
  time: number;
}

/** A rolling trades window + the last-seen book/ctx, so derivations are pure. */
interface WindowState {
  trades: BigTrade[];
  startOi: number | null;
  startFunding: number | null;
}

const WIN_MS = 60_000; // 1-minute rolling window

/**
 * Maintain the rolling window and produce a fresh derived snapshot.
 *
 * @param s   the mutable window state (kept by the caller)
 * @param trades new trades arriving (side, price, size, time in ms)
 * @param book the current book (levels with cumulative totals)
 * @param ctx  the current asset context
 */
export function computeMetrics(
  s: WindowState,
  trades: BigTrade[],
  book: {
    bids: { price: number; size: number; total: number }[];
    asks: { price: number; size: number; total: number }[];
    spread: number;
    mid: number;
    bidShare: number;
  } | null,
  ctx: {
    openInterest?: number;
    funding?: number;
    markPx?: number;
    oraclePx?: number;
  } | null,
): DerivedMetrics {
  const now = Date.now();

  // Append new prints and evict anything older than the window.
  for (const t of trades) s.trades.push(t);
  s.trades = s.trades.filter((t) => now - t.time <= WIN_MS);
  if (s.trades.length > 400) s.trades = s.trades.slice(-400);

  const win = s.trades;
  let buyVol = 0;
  let sellVol = 0;
  let notionalSum = 0;
  for (const t of win) {
    if (t.side === "buy") buyVol += t.size;
    else sellVol += t.size;
    notionalSum += t.notional;
  }
  const totalVol = buyVol + sellVol;
  const cvd = buyVol - sellVol;

  // Whale prints: the largest notional prints in the window, over 2x the
  // window's average size — the threshold scales with activity, so it means
  // "unusually large for right now", not a fixed dollar amount.
  const avgNotional = win.length ? notionalSum / win.length : 0;
  const bigTrades = win
    .filter((t) => t.notional > avgNotional * 2 && t.notional > 0)
    .sort((a, b) => b.notional - a.notional)
    .slice(0, 6);

  // Book derivations.
  let bookImbalance = 0.5;
  let spreadPct = 0;
  let microprice: number | null = null;
  let bidDepth = 0;
  let askDepth = 0;
  let wall: DerivedMetrics["wall"] = null;

  if (book && book.bids.length && book.asks.length) {
    bookImbalance = book.bidShare;
    const mid = book.mid || 0;
    spreadPct = mid ? book.spread / mid : 0;

    // Microprice: weight mid toward the heavier side of the top of book.
    const bb = book.bids[0];
    const ba = book.asks[0];
    const topNotional = bb.size * bb.price + ba.size * ba.price;
    if (topNotional > 0 && mid) {
      const wBid = (bb.size * bb.price) / topNotional;
      microprice = bb.price * wBid + ba.price * (1 - wBid);
    }

    const DEPTH_LEVELS = 12;
    bidDepth = book.bids.slice(0, DEPTH_LEVELS).reduce((a, l) => a + l.size, 0);
    askDepth = book.asks.slice(0, DEPTH_LEVELS).reduce((a, l) => a + l.size, 0);

    // The largest single level in tracked depth — a liquidity wall.
    let maxBid = 0, maxAsk = 0;
    let wallBid: { price: number; size: number; notional: number } | null = null;
    let wallAsk: { price: number; size: number; notional: number } | null = null;
    for (const l of book.bids.slice(0, DEPTH_LEVELS)) {
      if (l.size * l.price > maxBid) { maxBid = l.size * l.price; wallBid = { price: l.price, size: l.size, notional: l.size * l.price }; }
    }
    for (const l of book.asks.slice(0, DEPTH_LEVELS)) {
      if (l.size * l.price > maxAsk) { maxAsk = l.size * l.price; wallAsk = { price: l.price, size: l.size, notional: l.size * l.price }; }
    }
    if (wallBid && wallAsk) {
      wall = maxBid >= maxAsk
        ? { side: "bid", ...wallBid }
        : { side: "ask", ...wallAsk };
    } else {
      wall = wallBid ? { side: "bid", ...wallBid } : wallAsk ? { side: "ask", ...wallAsk } : null;
    }
  }

  // Context derivations — track the window's start so a change is meaningful.
  if (ctx) {
    if (s.startOi === null && ctx.openInterest) s.startOi = ctx.openInterest;
    if (s.startFunding === null && ctx.funding !== undefined) s.startFunding = ctx.funding;
  }
  const oiChange = s.startOi !== null && ctx?.openInterest
    ? ctx.openInterest - s.startOi
    : 0;
  const fundingChange = s.startFunding !== null && ctx?.funding !== undefined
    ? ctx.funding - s.startFunding
    : 0;
  const markOracleDev = ctx?.oraclePx && ctx?.markPx && ctx.oraclePx
    ? (ctx.markPx - ctx.oraclePx) / ctx.oraclePx
    : 0;

  return {
    cvd,
    cvdPct: totalVol ? cvd / totalVol : 0,
    buyVol,
    sellVol,
    buyShare: totalVol ? buyVol / totalVol : 0.5,
    tradeRate: (win.length / WIN_MS) * 60_000,
    avgSize: win.length ? totalVol / win.length : 0,
    bigTrades,
    bookImbalance,
    spreadPct,
    microprice,
    bidDepth,
    askDepth,
    wall,
    oiChange,
    fundingChange,
    markOracleDev,
    at: now,
  };
}

/** Build an empty window state for a fresh coin. */
export function newWindowState(): WindowState {
  return { trades: [], startOi: null, startFunding: null };
}

/** Format helpers shared by the panels. */
export const fmt = {
  /** Signed compact number: +1.2k / -340 */
  signed(n: number, digits = 2): string {
    const abs = Math.abs(n);
    const s = abs >= 1_000_000 ? (abs / 1_000_000).toFixed(digits) + "M"
      : abs >= 1_000 ? (abs / 1_000).toFixed(digits) + "k"
      : abs.toFixed(digits);
    return (n < 0 ? "-" : "+") + s;
  },
  /** Percent with a sign: +0.42% */
  pct(n: number, digits = 2): string {
    return (n < 0 ? "" : "+") + (n * 100).toFixed(digits) + "%";
  },
  /** Basis points, signed: +2.3bp */
  bp(n: number, digits = 1): string {
    return (n < 0 ? "" : "+") + (n * 10_000).toFixed(digits) + "bp";
  },
};
