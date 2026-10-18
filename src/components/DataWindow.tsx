import { useEffect, useState, useRef } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";

interface Props {
  ws?: VelaWorkspace | null;
  coin?: string;
  currentPrice?: number;
  isFloating?: boolean;
  onClose?: () => void;
}

interface ReadoutState {
  date: string;
  time: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  change: number | null;
  changePct: number | null;
  groups: Array<{
    title: string;
    rows: Array<{ label: string; value: string | number; color?: string }>;
  }>;
}

export function DataWindow({ ws, coin = "BTC", currentPrice = 0, isFloating = false, onClose }: Props) {
  const [readout, setReadout] = useState<ReadoutState | null>(null);
  const [pinned, setPinned] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ws) return;
    const chart = (ws as any).active?.chart || ws.chart;
    if (!chart?.renderer) return;

    const updateFromRenderer = () => {
      try {
        const raw = chart.renderer.dataWindowReadout?.();
        if (raw && (raw.ohlc || raw.date)) {
          const o = raw.ohlc;
          let chg = o?.change ?? null;
          let chgPct = o?.changePercent ?? null;
          if (chg == null && o?.open != null && o?.close != null) {
            chg = o.close - o.open;
            chgPct = o.open !== 0 ? (chg / o.open) * 100 : 0;
          }

          setReadout({
            date: raw.date || new Date().toISOString().split("T")[0],
            time: raw.time || new Date().toTimeString().slice(0, 5),
            open: o?.open ?? null,
            high: o?.high ?? null,
            low: o?.low ?? null,
            close: o?.close ?? null,
            volume: o?.volume ?? null,
            change: chg,
            changePct: chgPct,
            groups: raw.groups || [],
          });
          return;
        }

        // Fallback: extract latest bar if cursor is not hovering
        const market = chart.market;
        const lastBar = chart.renderer.lastBar?.() || chart.lastBar?.();
        if (lastBar) {
          const chg = lastBar.close - lastBar.open;
          const chgPct = lastBar.open !== 0 ? (chg / lastBar.open) * 100 : 0;
          const d = new Date(lastBar.time * 1000);
          setReadout({
            date: d.toISOString().split("T")[0],
            time: d.toTimeString().slice(0, 5),
            open: lastBar.open,
            high: lastBar.high,
            low: lastBar.low,
            close: lastBar.close,
            volume: lastBar.volume ?? null,
            change: chg,
            changePct: chgPct,
            groups: [],
          });
        }
      } catch (err) {
        console.warn("[trade-pro data window] readout sync error:", err);
      }
    };

    updateFromRenderer();

    // Subscribe to crosshair movement
    let unsub: (() => void) | undefined;
    try {
      if (typeof chart.renderer.onCrosshairMove === "function") {
        unsub = chart.renderer.onCrosshairMove(() => {
          updateFromRenderer();
        });
      }
    } catch {}

    const interval = window.setInterval(updateFromRenderer, 400);

    return () => {
      unsub?.();
      window.clearInterval(interval);
    };
  }, [ws]);

  const formatPrice = (val: number | null | undefined) => {
    if (val == null || isNaN(val)) return "—";
    if (val >= 1000) return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (val >= 1) return val.toFixed(4);
    return val.toFixed(6);
  };

  const isUp = (readout?.change ?? 0) >= 0;

  return (
    <div
      ref={containerRef}
      className={`data-window-panel${isFloating ? " is-floating" : ""}`}
      role="region"
      aria-label="Chart Data Window Inspector"
    >
      <div className="dw-head">
        <div className="dw-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M9 21V9" />
          </svg>
          <span>Data Window</span>
          <span className="dw-coin-badge">{coin}</span>
        </div>
        <div className="dw-actions">
          {isFloating && (
            <button
              type="button"
              className={`dw-btn-pin${pinned ? " pinned" : ""}`}
              onClick={() => setPinned(!pinned)}
              title={pinned ? "Unpin widget" : "Pin widget"}
            >
              📌
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="dw-btn-close"
              onClick={onClose}
              title="Close Data Window"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="dw-body">
        {/* Date & Time Header */}
        <div className="dw-section">
          <div className="dw-section-title">TIME & DATE</div>
          <div className="dw-row">
            <span className="dw-key">Date</span>
            <span className="dw-val">{readout?.date || "—"}</span>
          </div>
          <div className="dw-row">
            <span className="dw-key">Time</span>
            <span className="dw-val">{readout?.time || "—"}</span>
          </div>
        </div>

        {/* Price OHLCV Section */}
        <div className="dw-section">
          <div className="dw-section-title">PRICE & VOLUME ({coin})</div>
          <div className="dw-row">
            <span className="dw-key">Open</span>
            <span className="dw-val">{formatPrice(readout?.open)}</span>
          </div>
          <div className="dw-row">
            <span className="dw-key">High</span>
            <span className="dw-val dw-high">{formatPrice(readout?.high)}</span>
          </div>
          <div className="dw-row">
            <span className="dw-key">Low</span>
            <span className="dw-val dw-low">{formatPrice(readout?.low)}</span>
          </div>
          <div className="dw-row">
            <span className="dw-key">Close</span>
            <span className={`dw-val ${isUp ? "dw-up" : "dw-down"}`}>
              {formatPrice(readout?.close ?? currentPrice)}
            </span>
          </div>
          <div className="dw-row">
            <span className="dw-key">Change</span>
            <span className={`dw-val ${isUp ? "dw-up" : "dw-down"}`}>
              {readout?.change != null ? (
                <>
                  {isUp ? "+" : ""}
                  {formatPrice(readout.change)} ({isUp ? "+" : ""}
                  {readout.changePct?.toFixed(2)}%)
                </>
              ) : (
                "—"
              )}
            </span>
          </div>
          <div className="dw-row">
            <span className="dw-key">Volume</span>
            <span className="dw-val">
              {readout?.volume != null
                ? readout.volume >= 1e6
                  ? `${(readout.volume / 1e6).toFixed(2)}M`
                  : readout.volume >= 1e3
                  ? `${(readout.volume / 1e3).toFixed(2)}K`
                  : readout.volume.toFixed(2)
                : "—"}
            </span>
          </div>
        </div>

        {/* Dynamic Indicator Groups */}
        {readout?.groups && readout.groups.length > 0 ? (
          readout.groups.map((grp, idx) => (
            <div key={`${grp.title}-${idx}`} className="dw-section">
              <div className="dw-section-title">{grp.title.toUpperCase()}</div>
              {grp.rows.map((row, rIdx) => (
                <div key={`${row.label}-${rIdx}`} className="dw-row">
                  <span className="dw-key">
                    {row.color && (
                      <span className="dw-indicator-dot" style={{ backgroundColor: row.color }} />
                    )}
                    {row.label}
                  </span>
                  <span className="dw-val" style={row.color ? { color: row.color } : undefined}>
                    {typeof row.value === "number" ? formatPrice(row.value) : String(row.value)}
                  </span>
                </div>
              ))}
            </div>
          ))
        ) : (
          <div className="dw-section dw-empty-hint">
            <span className="dw-hint-text">
              Hover over chart candles to inspect individual bar values and active indicator plots.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
