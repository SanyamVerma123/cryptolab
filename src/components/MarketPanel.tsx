/**
 * MarketPanel — the right-hand rail: everything Hyperliquid streams per coin.
 *
 * Sections (each independently scrollable, panel itself scrolls as a whole):
 *   - Market stats: mark, oracle, mid, funding (8h APY-normalized), open
 *     interest, 24h notional + base volume, premium, max leverage, spread.
 *   - Order book: 12 levels per side with depth bars + imbalance meter.
 *   - Trade tape: rolling 100 prints, side-coloured, size-notional.
 *
 * All values come from the shared socket (see useLiveData) so this adds no
 * extra connections and no render pressure on the chart.
 */
import { useMemo } from "react";
import type { LiveData } from "../lib/useLiveData";
import { fmt } from "../lib/derivedMetrics";

interface Props {
  coin: string;
  data: LiveData;
}

const nf = (n: number, d = 2) =>
  n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

const compact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="stat">
      <span className="stat-k">{label}</span>
      <span className={"stat-v" + (tone ? " " + tone : "")}>{value}</span>
    </div>
  );
}

export function MarketPanel({ coin, data }: Props) {
  const { book, trades, ctx, maxLeverage, metrics } = data;

  // Funding is charged hourly on HL; annualize for readability.
  const fundingHourly = ctx?.funding ?? 0;
  const fundingApr = fundingHourly * 24 * 365 * 100;
  const fundingPct = fundingHourly * 100;

  const oiNotional = useMemo(() => {
    if (!ctx) return 0;
    const px = ctx.markPx || ctx.midPx || 0;
    return ctx.openInterest * px;
  }, [ctx]);

  const maxRow = useMemo(() => {
    if (!book) return 1;
    const all = [...book.bids, ...book.asks];
    return Math.max(1, ...all.map((l) => l.size));
  }, [book]);

  const change24 = useMemo(() => {
    if (!ctx || !ctx.prevDayPx) return 0;
    const last = ctx.markPx || ctx.midPx;
    return ((last - ctx.prevDayPx) / ctx.prevDayPx) * 100;
  }, [ctx]);

  return (
    <aside className="market-panel" aria-label="Market data">
      {/* Scroll container: the header pins and the sections scroll inside it,
          so the panel is full-height and never renders "half down". */}
      <div className="mp-body">
      <section className="mp-sec">
        <h3 className="mp-h">
          {coin} <span className="mp-sub">Perpetual</span>
        </h3>
        <div className="mp-price">
          {nf(ctx?.markPx ?? ctx?.midPx ?? 0, 2)}
          <span className={"mp-chg " + (change24 >= 0 ? "up" : "down")}>
            {change24 >= 0 ? "+" : ""}
            {change24.toFixed(2)}%
          </span>
        </div>
        <div className="stats">
          <Stat label="Mark" value={nf(ctx?.markPx ?? 0, 2)} />
          <Stat label="Oracle" value={nf(ctx?.oraclePx ?? 0, 2)} />
          <Stat label="Mid" value={nf(ctx?.midPx ?? 0, 2)} />
          <Stat label="Prev day" value={nf(ctx?.prevDayPx ?? 0, 2)} />
          <Stat
            label="Funding /h"
            value={fundingPct.toFixed(5) + "%"}
            tone={fundingPct >= 0 ? "up" : "down"}
          />
          <Stat label="Funding APR" value={fundingApr.toFixed(2) + "%"} />
          <Stat label="Premium" value={((ctx?.premium ?? 0) * 100).toFixed(4) + "%"} />
          <Stat label="Open interest" value={compact(ctx?.openInterest ?? 0) + " " + coin} />
          <Stat label="OI notional" value={"$" + compact(oiNotional)} />
          <Stat label="24h volume" value={"$" + compact(ctx?.dayNtlVlm ?? 0)} />
          <Stat label="24h base vol" value={compact(ctx?.dayBaseVlm ?? 0)} />
          <Stat label="Max leverage" value={maxLeverage ? maxLeverage + "x" : "—"} />
          <Stat label="Spread" value={book ? nf(book.spread, 2) : "—"} />
        </div>
      </section>

      <section className="mp-sec">
        <h3 className="mp-h">Order book</h3>
        {book && (
          <>
            <div className="imbalance" title="Bid vs ask notional">
              <div className="imb-bid" style={{ width: `${book.bidShare * 100}%` }} />
            </div>
            <div className="imb-legend">
              <span className="up">B {(book.bidShare * 100).toFixed(1)}%</span>
              <span className="down">{((1 - book.bidShare) * 100).toFixed(1)}% A</span>
            </div>

            <div className="book">
              <div className="book-head">
                <span>Price</span>
                <span>Size</span>
                <span>Total</span>
              </div>
              {/* asks: worst at top -> best (lowest) adjacent to the spread */}
              <div className="book-side asks">
                {book.asks
                  .slice(0, 12)
                  .reverse()
                  .map((l, i) => (
                    <div className="book-row" key={"a" + i}>
                      <span className="bar ask" style={{ width: `${(l.size / maxRow) * 100}%` }} />
                      <span className="px down">{nf(l.price, 2)}</span>
                      <span className="sz">{nf(l.size, 4)}</span>
                      <span className="tt">{nf(l.total, 3)}</span>
                    </div>
                  ))}
              </div>

              <div className="book-spread">
                <span>{nf(book.mid, 2)}</span>
                <span className="sp">spread {nf(book.spread, 2)}</span>
              </div>

              <div className="book-side bids">
                {book.bids.slice(0, 12).map((l, i) => (
                  <div className="book-row" key={"b" + i}>
                    <span className="bar bid" style={{ width: `${(l.size / maxRow) * 100}%` }} />
                    <span className="px up">{nf(l.price, 2)}</span>
                    <span className="sz">{nf(l.size, 4)}</span>
                    <span className="tt">{nf(l.total, 3)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      {/* Flow & pressure — derived analytics over the trade tape and book:
          CVD, buy/sell split, whale prints, imbalance, walls, OI/funding
          change. Everything here is computed from streams already open. */}
      {metrics && (
        <section className="mp-sec">
          <h3 className="mp-h">Flow &amp; pressure</h3>

          {/* CVD — the single most-watched flow signal. */}
          <div className="mp-cvd">
            <div className="mp-cvd-label">
              <span>CVD (1m)</span>
              <span className={metrics.cvd >= 0 ? "up" : "down"}>
                {fmt.signed(metrics.cvd)} {coin}
              </span>
            </div>
            {/* Split bar: buy share vs sell share of volume. */}
            <div className="imbalance">
              <div className="imb-bid" style={{ width: `${metrics.buyShare * 100}%` }} />
            </div>
            <div className="imb-legend">
              <span className="up">Buy {compact(metrics.buyVol)}</span>
              <span className="down">Sell {compact(metrics.sellVol)}</span>
            </div>
          </div>

          <div className="stats">
            <Stat
              label="Delta share"
              value={fmt.pct(metrics.cvdPct)}
              tone={metrics.cvdPct >= 0 ? "up" : "down"}
            />
            <Stat label="Trades /min" value={metrics.tradeRate.toFixed(0)} />
            <Stat label="Avg size" value={nf(metrics.avgSize, 4)} />
            <Stat label="Microprice" value={metrics.microprice ? nf(metrics.microprice, 2) : "—"} />
            <Stat
              label="Book imbalance"
              value={(metrics.bookImbalance * 100).toFixed(1) + "% bid"}
            />
            <Stat label="Spread" value={fmt.bp(metrics.spreadPct)} />
            <Stat label="Bid depth" value={compact(metrics.bidDepth)} />
            <Stat label="Ask depth" value={compact(metrics.askDepth)} />
            <Stat
              label="OI change"
              value={fmt.signed(metrics.oiChange) + " " + coin}
              tone={metrics.oiChange >= 0 ? "up" : "down"}
            />
            <Stat
              label="Funding Δ"
              value={fmt.pct(metrics.fundingChange, 4)}
              tone={metrics.fundingChange >= 0 ? "up" : "down"}
            />
            <Stat
              label="Mark vs oracle"
              value={fmt.bp(metrics.markOracleDev)}
              tone={metrics.markOracleDev >= 0 ? "up" : "down"}
            />
          </div>

          {/* The biggest wall in tracked depth. */}
          {metrics.wall && (
            <div className={"mp-wall " + metrics.wall.side}>
              <span className="mp-wall-tag">Wall</span>
              <span>{metrics.wall.side === "bid" ? "Bid" : "Ask"} {nf(metrics.wall.price, 2)}</span>
              <span>{compact(metrics.wall.size)} {coin}</span>
              <span className="mp-wall-notional">${compact(metrics.wall.notional)}</span>
            </div>
          )}

          {/* Whale prints — largest notional trades in the window. */}
          {metrics.bigTrades.length > 0 && (
            <div className="mp-whales">
              <div className="mp-whale-head">Large prints (1m)</div>
              {metrics.bigTrades.map((t, i) => (
                <div className={"tape-row " + t.side} key={i}>
                  <span className="px">{nf(t.price, 2)}</span>
                  <span className="sz">{nf(t.size, 4)}</span>
                  <span className="notl">${compact(t.notional)}</span>
                  <span className="tm">
                    {new Date(t.time).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="mp-sec">
        <h3 className="mp-h">Trades</h3>
        <div className="tape">
          <div className="tape-head">
            <span>Price</span>
            <span>Size</span>
            <span>Time</span>
          </div>
          {trades.map((t, i) => {
            const isBuy = t.side === "buy" || t.side === "B";
            return (
              <div className={"tape-row" + (isBuy ? " buy" : " sell")} key={t.hash ?? i}>
                <span className="px">{nf(t.price, 2)}</span>
                <span className="sz">{nf(t.size, 4)}</span>
                <span className="tm">
                  {new Date(t.time * 1000).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              </div>
            );
          })}
          {!trades.length && <div className="mp-empty">waiting for prints…</div>}
        </div>
      </section>
      </div>
    </aside>
  );
}
