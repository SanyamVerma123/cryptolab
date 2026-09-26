/**
 * VelaChart — mounts the @luxalgo/vela WORKSPACE (single-chart mode) into a div.
 *
 * Vela owns its own DOM (it renders the whole shell — topbar, drawing toolbar,
 * status line, bottom bar — into the container). There are no React bindings,
 * so this is deliberately a thin imperative wrapper: one ref, mount on effect,
 * destroy on unmount.
 *
 * Everything the user asked for is native to Vela:
 *   - 84 drawing tools, each with a full settings popup (colour/width/style/
 *     fill/text/lock/delete/duplicate/z-order), data-space anchored so they
 *     survive pan/zoom/symbol/timeframe switches, persisted to localStorage.
 *   - Drawings extend arbitrarily far RIGHT of the last candle: Vela's
 *     CoordinateSystem is pure linear math (xToLogical / logicalToTime
 *     extrapolate past barCount-1). There is no coordinateToTime() returning
 *     null past the last bar, so the old lightweight-charts bug cannot occur.
 *   - Hyperliquid REST history + WS live stream, first-party, no auth.
 *
 * Fix notes (see the commits that touched this file):
 *   - ADAPTIVE HISTORY DEPTH. Vela's Hyperliquid provider translates a bar
 *     `limit` into a time window: `end - ((limit + 2) * intervalMs)`, and HL's
 *     candleSnapshot caps at ~5000 candles. A flat `bars: 500` is wrong at
 *     both ends: on small timeframes it under-loads, on 1W it asks for 500
 *     weeks and the chart does not paint properly. `barsForTf()` scales the
 *     request per timeframe so every interval gets a consistent window.
 *   - ATTRIBUTION (Apache-2.0 NOTICE). The built-in mark may be disabled ONLY
 *     with an equivalent visible attribution elsewhere. We keep the built-in
 *     mark but restyle it small + unobtrusive via CSS, which the NOTICE
 *     explicitly allows ("You may restyle or reposition this mark to fit your
 *     design"). See styles/app.css `.vela-attribution`.
 */
import { useEffect, useRef } from "react";
import { VelaWorkspace } from "@luxalgo/vela/workspace";
import { HyperliquidProvider } from "@luxalgo/vela/providers/hyperliquid";
import { PineEngine } from "@luxalgo/vela-pinets";
import { syncCustomLibrary } from "./PineEditor";
import { installToolDefaults } from "../lib/toolDefaults";
import { installPerSymbolDrawings } from "../lib/perSymbolDrawings";
import { installIndicatorState } from "../lib/indicatorState";
import { trackSelection } from "../lib/drawingPresets";
import { mountMarket } from "../lib/marketData";

interface Props {
  coin: string;
  /** Vela timeframe id ('1','5','15','30','60','240','D','W'…). */
  timeframe: string;
  onReady?: (ws: VelaWorkspace) => void;
}

/**
 * History depth per timeframe. Goals:
 *   - small timeframes: enough recent bars to scroll back meaningfully
 *   - large timeframes (1W/1M): a full multi-year window without asking the
 *     provider for more bars than Hyperliquid's ~5000-candle cap can serve
 *
 * The counts stay under HL's candle cap for every interval, and each maps to
 * roughly the same wall-clock window (a few months to a few years), which is
 * what keeps "switch from 1h to 1W" from breaking the paint.
 */
const TF_BARS: Record<string, number> = {
  "1": 1200, "3": 1200, "5": 1200, "15": 1200, "30": 1200,
  "45": 1000, "60": 1000, "120": 800, "180": 800, "240": 700,
  "360": 600, "480": 500, "720": 400,
  D: 365, W: 260, M: 120,
};

function barsForTf(tf: string): number {
  return TF_BARS[tf] ?? 500;
}

export function VelaChart({ coin, timeframe, onReady }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<VelaWorkspace | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // Mount once. React 19 Strict Mode double-invokes effects in dev, so guard.
  useEffect(() => {
    const el = ref.current;
    if (!el || wsRef.current) return;

    const ws = new VelaWorkspace(el, {
      layout: false, // single chart — no grid picker / sync switches
      symbol: coin,
      timeframe,
      bars: barsForTf(timeframe),
      live: true,
      theme: "dark",
      autofocus: true,
      // Persist market, style, timezone, drawings and indicators to localStorage.
      persist: true,
      // Hyperliquid perp/spot universe. No key, no server, no auth.
      providers: { hyperliquid: () => new HyperliquidProvider() },
      drawings: true, // the full 84-tool surface with the shared toolbar
    });
    wsRef.current = ws;

    // PineTS — the Pine Script engine Vela's docs point at. Vela ships NO
    // engine by default (candles + native indicators only); without this the
    // user cannot run any Pine script. Registering 'pine' makes
    // chart.addIndicator(source) compile and render real Pine.
    // Guarded: React 19 Strict Mode mounts, destroys, then re-mounts, so the
    // first instance is dead by the time this line runs — a dead cell throws.
    try {
      ws.chart.registerEngine("pine", new PineEngine());
    } catch (e) {
      console.warn("[trade-pro] pine engine registration skipped:", e);
    }

    ws.chart
      .ready()
      .then(() => {
        // Don't hand a destroyed workspace up to App — it would throw on the
        // next read. The real (second) mount calls onReady with a live one.
        if (!wsRef.current) return;
        // Re-register the user's saved Pine scripts into the indicator library
        // so the "custom" group comes back after a reload.
        try {
          syncCustomLibrary(ws);
        } catch (e) {
          console.warn("[trade-pro] custom library sync failed:", e);
        }
        // Remember the user's per-tool style choices (colour, width, fill…)
        // so a tool keeps its settings until changed again, even after reload.
        try {
          installToolDefaults(ws);
        } catch (e) {
          console.warn("[trade-pro] tool defaults install failed:", e);
        }
        onReadyRef.current?.(ws);
      })
      .catch((e) => console.error("[trade-pro] vela ready failed", e));

    return () => {
      try {
        ws.destroy();
      } catch {
        /* already gone */
      }
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Symbol / timeframe switches route through the workspace's own API so the
  // cell identity, indicators, drawings and subscriptions all survive — and
  // the history depth follows the new timeframe.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;

    let stopMarket: (() => void) | undefined;
    let stopDefaults: (() => void) | undefined;
    let stopSymbols: (() => void) | undefined;
    let stopIndicators: (() => void) | undefined;

    const setupMarket = () => {
      try {
        ws.chart.setMarket({ symbol: coin, timeframe, bars: barsForTf(timeframe) });
      } catch (e) {
        console.error("[trade-pro] setMarket failed", e);
      }
      // Keep the app's own bar store in lockstep — the AI draws from this.
      // (Vela owns the chart's array internally; this is the AI's read copy.)
      // CRITICAL: Only subscribe AFTER the chart is ready to prevent the
      // "cannot read property of undefined reading open time" toast from the
      // countdown chip trying to read a non-existent bar on mount.
      stopMarket = mountMarket(ws, { symbol: coin, timeframe });

      // A coin switch wipes the chart's drawings; re-install the tool-style
      // persistence listeners on the new market so the user's per-tool settings
      // (colour, width…) carry across coins instead of resetting.
      try {
        stopDefaults = installToolDefaults(ws);
      } catch (e) {
        console.warn("[trade-pro] tool defaults re-install failed:", e);
      }

      // Per-symbol drawings: boxes drawn on BTC must not appear on ETH. Styles
      // (colour, width) still carry across coins via toolDefaults above.
      try {
        stopSymbols = installPerSymbolDrawings(ws);
      } catch (e) {
        console.warn("[trade-pro] per-symbol drawings failed:", e);
      }

      // Indicator visibility + inputs: the "I" button hide and per-input edits
      // (e.g. turning specific FVG levels off) are NOT round-tripped by Vela's
      // own persistence, so they revert on reload and on a second add. We own
      // that layer, scoped per coin.
      try {
        stopIndicators = installIndicatorState(ws);
      } catch (e) {
        console.warn("[trade-pro] indicator state failed:", e);
      }

      // Track which drawing the user has selected, so the presets dropdown's
      // "Custom" button snapshots the one they just finished configuring.
      try {
        trackSelection(ws);
      } catch {
        /* chart not ready */
      }
    };

    // If the chart is already ready (e.g., initial mount finished), run immediately.
    // Otherwise, wait for the next ready signal (which happens on every setMarket).
    setupMarket();

    return () => {
      stopMarket?.();
      stopDefaults?.();
      stopSymbols?.();
      stopIndicators?.();
    };
  }, [coin, timeframe]);

  return <div ref={ref} className="vela-host" />;
}
