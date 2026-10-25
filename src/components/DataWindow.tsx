import { useEffect, useState, useRef, useCallback } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import { getSafeActiveChart } from "../lib/workspaceSafe";

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
  up: boolean;
  groups: Array<{
    title: string;
    rows: Array<{ label: string; value: string | number; color?: string }>;
  }>;
}

const REFRESH_EVENTS = [
  "bar",
  "context:changed",
  "indicator:added",
  "indicator:removed",
  "indicator:visibility",
  "indicator:moved",
  "pane:changed",
  "market:changed",
  "history:complete",
] as const;

function parseNumber(v: unknown): number | null {
  if (typeof v === "number" && !isNaN(v)) return v;
  if (typeof v === "string") {
    const clean = v.replace(/[^0-9.-]/g, "");
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

export function DataWindow({ ws, coin = "BTC", currentPrice = 0, isFloating = false, onClose }: Props) {
  const [readout, setReadout] = useState<ReadoutState | null>(null);
  const [pinned, setPinned] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const updateFromRenderer = useCallback(() => {
    if (!ws) return;
    try {
      const chart = getSafeActiveChart(ws);
      if (!chart?.renderer) return;

      const raw =
        (typeof (chart.renderer as any).dataWindowReadout === "function"
          ? (chart.renderer as any).dataWindowReadout()
          : null) ||
        (typeof (chart as any).dataWindowReadout === "function"
          ? (chart as any).dataWindowReadout()
          : null);

      if (raw && (raw.ohlc || raw.date || raw.time || raw.groups?.length)) {
        const ohlc = raw.ohlc;
        const open = parseNumber(ohlc?.o ?? ohlc?.open);
        const high = parseNumber(ohlc?.h ?? ohlc?.high);
        const low = parseNumber(ohlc?.l ?? ohlc?.low);
        const close = parseNumber(ohlc?.c ?? ohlc?.close);
        const volume = parseNumber(ohlc?.vol ?? ohlc?.volume);

        let chg: number | null = null;
        let chgPct: number | null = null;
        if (close != null && open != null) {
          chg = close - open;
          chgPct = open !== 0 ? (chg / open) * 100 : 0;
        }

        const isUp = ohlc?.up !== undefined ? Boolean(ohlc.up) : (chg != null ? chg >= 0 : true);

        const groups = (raw.groups || []).map((grp: any) => ({
          title: grp.name || grp.title || "Indicator",
          rows: (grp.rows || []).map((r: any) => ({
            label: r.label,
            value: r.value,
            color: r.color,
          })),
        }));

        setReadout({
          date: raw.date || new Date().toISOString().split("T")[0],
          time: raw.time || new Date().toTimeString().slice(0, 5),
          open,
          high,
          low,
          close,
          volume,
          change: chg,
          changePct: chgPct,
          up: isUp,
          groups,
        });
        return;
      }

      // Fallback: extract latest bar if cursor is not hovering
      const lastBar = (chart.renderer as any)?.lastBar?.() || (chart as any)?.lastBar?.();
      if (lastBar) {
        const open = parseNumber(lastBar.open);
        const high = parseNumber(lastBar.high);
        const low = parseNumber(lastBar.low);
        const close = parseNumber(lastBar.close);
        const volume = parseNumber(lastBar.volume);
        const chg = close != null && open != null ? close - open : 0;
        const chgPct = open != null && open !== 0 ? (chg / open) * 100 : 0;
        const d = lastBar.time ? new Date(lastBar.time * 1000) : new Date();

        setReadout({
          date: d.toISOString().split("T")[0],
          time: d.toTimeString().slice(0, 5),
          open,
          high,
          low,
          close,
          volume,
          change: chg,
          changePct: chgPct,
          up: chg >= 0,
          groups: [],
        });
      }
    } catch (err) {
      console.warn("[trade-pro data window] readout sync error:", err);
    }
  }, [ws]);

  useEffect(() => {
    if (!ws) return;
    const unsubs: Array<() => void> = [];

    const bindChart = () => {
      unsubs.forEach((u) => u());
      unsubs.length = 0;

      const chart = getSafeActiveChart(ws);
      if (!chart) return;

      // Subscribe to all Vela 0.9.0 refresh events
      for (const ev of REFRESH_EVENTS) {
        try {
          const off = chart.on?.(ev, updateFromRenderer);
          if (typeof off === "function") unsubs.push(off);
        } catch {}
      }

      // Subscribe to active crosshair cursor movement
      try {
        if (typeof chart.renderer?.onCrosshairMove === "function") {
          const offCross = chart.renderer.onCrosshairMove(updateFromRenderer);
          if (typeof offCross === "function") unsubs.push(offCross);
        }
      } catch {}

      updateFromRenderer();
    };

    bindChart();

    // Rebind when active cell changes
    try {
      const offCell = ws.on?.("cell:active", bindChart);
      if (typeof offCell === "function") unsubs.push(offCell);
    } catch {}

    const interval = window.setInterval(updateFromRenderer, 300);

    return () => {
      unsubs.forEach((u) => u());
      window.clearInterval(interval);
    };
  }, [ws, updateFromRenderer]);

  const formatPrice = (val: number | null | undefined) => {
    if (val == null || isNaN(val)) return "—";
    if (val >= 1000) return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (val >= 1) return val.toFixed(4);
    return val.toFixed(6);
  };

  const isUp = readout?.up ?? ((readout?.change ?? 0) >= 0);

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
