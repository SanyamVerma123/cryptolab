/**
 * useLiveData — the right-hand panel data layer.
 *
 * Subscribes to every stream Hyperliquid exposes per coin and keeps it in
 * React state at a throttled cadence so the panels stay readable instead of
 * re-rendering thousands of times a second:
 *   l2Book          -> order book (bids/asks with cumulative depth)
 *   trades          -> trade tape (rolling 100)
 *   activeAssetCtx  -> funding, open interest, mark, oracle, 24h volume
 *   allMids         -> universal mid (fallback for the header price)
 *
 * Throttling: each channel coalesces into a ref and flushes on a rAF-style
 * interval (default 250ms for the book, 400ms for the tape). This is what
 * keeps the main thread free — the chart's live candles are pushed straight
 * into lightweight-charts via updateBar() and never touch React state at all.
 */
import { useEffect, useRef, useState } from "react";
import {
  AssetCtx,
  fetchL2Book,
  fetchMetaAndCtxs,
  HyperliquidSocket,
  L2Book,
  Trade,
  wsL2ToBook,
  wsTradeToTrade,
} from "./hyperliquid";
import {
  computeMetrics,
  newWindowState,
  type BigTrade,
  type DerivedMetrics,
} from "./derivedMetrics";

export interface DepthLevel {
  price: number;
  size: number;
  total: number;
}

export interface BookState {
  bids: DepthLevel[];
  asks: DepthLevel[];
  spread: number;
  mid: number;
  /** Notional bid vs ask total, for the imbalance bar (0..1). */
  bidShare: number;
}

export interface LiveData {
  book: BookState | null;
  trades: Trade[];
  ctx: AssetCtx | null;
  maxLeverage: number;
  /** Derived analytics: CVD, buy/sell pressure, whales, imbalance, walls. */
  metrics: DerivedMetrics | null;
}

const EMPTY_BOOK: BookState = {
  bids: [],
  asks: [],
  spread: 0,
  mid: 0,
  bidShare: 0.5,
};

/** Add running cumulative totals + derive spread/mid/imbalance. */
function withTotals(book: L2Book): BookState {
  let bt = 0;
  const bids: DepthLevel[] = book.bids.map((l) => {
    bt += l.size;
    return { ...l, total: bt };
  });
  let at = 0;
  const asks: DepthLevel[] = book.asks.map((l) => {
    at += l.size;
    return { ...l, total: at };
  });
  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
  const bidNotional = bids.reduce((s, l) => s + l.price * l.size, 0);
  const askNotional = asks.reduce((s, l) => s + l.price * l.size, 0);
  const tot = bidNotional + askNotional;
  return {
    bids,
    asks,
    spread: bestAsk && bestBid ? bestAsk - bestBid : 0,
    mid,
    bidShare: tot > 0 ? bidNotional / tot : 0.5,
  };
}

export function useLiveData(socket: HyperliquidSocket | null, coin: string): LiveData {
  const [book, setBook] = useState<BookState | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [ctx, setCtx] = useState<AssetCtx | null>(null);
  const [maxLeverage, setMaxLeverage] = useState(0);
  const [metrics, setMetrics] = useState<DerivedMetrics | null>(null);

  const bookRef = useRef<L2Book | null>(null);
  const tradesRef = useRef<Trade[]>([]);
  const bookDirty = useRef(false);
  const tradesDirty = useRef(false);
  // The rolling window the derived layer reads. Reset per coin.
  const winRef = useRef(newWindowState());
  // Fresh big trades since the last flush — appended to the window on tick.
  const pendingBig = useRef<BigTrade[]>([]);

  // Initial REST snapshot so the book isn't empty until the first WS frame.
  useEffect(() => {
    if (!coin) return;
    let cancelled = false;
    setBook(null);
    setTrades([]);
    tradesRef.current = [];

    fetchL2Book(coin)
      .then((b) => {
        if (!cancelled) {
          bookRef.current = b;
          setBook(withTotals(b));
        }
      })
      .catch(() => {});

    fetchMetaAndCtxs()
      .then(({ byCoin, maxLeverage: ml }) => {
        if (cancelled) return;
        if (byCoin[coin]) setCtx(byCoin[coin]);
        setMaxLeverage(ml[coin] ?? 0);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [coin]);

  // WS subscriptions + throttled flush.
  useEffect(() => {
    if (!socket || !coin) return;
    const subs = [
      { type: "l2Book", coin },
      { type: "trades", coin },
      { type: "activeAssetCtx", coin },
    ];
    for (const s of subs) socket.subscribe(s);

    const off = socket.on((channel, data) => {
      if (channel === "l2Book") {
        bookRef.current = wsL2ToBook(data);
        bookDirty.current = true;
      } else if (channel === "trades") {
        const arr = Array.isArray(data) ? data : [data];
        const incoming = arr.map(wsTradeToTrade);
        // newest first, cap at 100
        tradesRef.current = [...incoming.reverse(), ...tradesRef.current].slice(0, 100);
        tradesDirty.current = true;
        // Queue for the derived window too (notional computed here so the
        // window never re-prices a print).
        for (const t of incoming) {
          pendingBig.current.push({
            side: t.side === "buy" || t.side === "A" ? "buy" : "sell",
            price: t.price,
            size: t.size,
            notional: t.price * t.size,
            time: t.time * 1000,
          });
        }
      } else if (channel === "activeAssetCtx") {
        const c = data?.ctx;
        if (c) {
          setCtx({
            funding: Number(c.funding ?? 0),
            openInterest: Number(c.openInterest ?? 0),
            prevDayPx: Number(c.prevDayPx ?? 0),
            dayNtlVlm: Number(c.dayNtlVlm ?? 0),
            premium: Number(c.premium ?? 0),
            oraclePx: Number(c.oraclePx ?? 0),
            markPx: Number(c.markPx ?? 0),
            midPx: Number(c.midPx ?? 0),
            dayBaseVlm: Number(c.dayBaseVlm ?? 0),
          });
        }
      }
    });

    // ~4 Hz book, ~2.5 Hz tape: readable and cheap.
    const bookTimer = window.setInterval(() => {
      if (bookDirty.current && bookRef.current) {
        bookDirty.current = false;
        setBook(withTotals(bookRef.current));
      }
    }, 250);
    const tradeTimer = window.setInterval(() => {
      if (tradesDirty.current) {
        tradesDirty.current = false;
        setTrades(tradesRef.current.slice(0, 100));
      }
      // Derived layer: fold pending prints into the window and recompute.
      // Runs whether or not the tape is dirty, so OI/funding change and book
      // imbalance stay live even in a quiet minute.
      if (pendingBig.current.length || bookRef.current || ctx) {
        const fresh = pendingBig.current;
        pendingBig.current = [];
        setMetrics(
          computeMetrics(winRef.current, fresh, bookRef.current ? withTotals(bookRef.current) : null, ctx),
        );
      }
    }, 400);

    return () => {
      off();
      window.clearInterval(bookTimer);
      window.clearInterval(tradeTimer);
      for (const s of subs) socket.unsubscribe(s);
    };
  }, [socket, coin]);

  // Reset the derived window on coin switch so a new market starts clean.
  useEffect(() => {
    winRef.current = newWindowState();
    pendingBig.current = [];
    setMetrics(null);
  }, [coin]);

  return { book: book ?? (coin ? EMPTY_BOOK : null), trades, ctx, maxLeverage, metrics };
}
