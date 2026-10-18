import { useEffect, useState } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";

interface Props {
  ws: VelaWorkspace | null;
}

interface RangeItem {
  id: string;
  label: string;
  days?: number;
  months?: number;
  years?: number;
  isYtd?: boolean;
  isAll?: boolean;
  tf?: string;
}

const RANGES: RangeItem[] = [
  { id: "1D", label: "1D", days: 1, tf: "5" },
  { id: "5D", label: "5D", days: 5, tf: "15" },
  { id: "1M", label: "1M", months: 1, tf: "60" },
  { id: "3M", label: "3M", months: 3, tf: "120" },
  { id: "6M", label: "6M", months: 6, tf: "240" },
  { id: "YTD", label: "YTD", isYtd: true, tf: "D" },
  { id: "1Y", label: "1Y", years: 1, tf: "D" },
  { id: "All", label: "All", isAll: true, tf: "W" },
];

export function ChartBottomRangeBar({ ws }: Props) {
  const [activeRange, setActiveRange] = useState<string | null>(null);
  const [isLog, setIsLog] = useState(false);
  const [isAuto, setIsAuto] = useState(true);
  const [tz, setTz] = useState("UTC");

  useEffect(() => {
    if (!ws) return;
    try {
      const chart = (ws as any).active?.chart || ws.chart;
      if (chart?.renderer?.getConfig) {
        const cfg: any = chart.renderer.getConfig();
        if (cfg?.logScale != null) setIsLog(!!cfg.logScale);
      }
    } catch {}
  }, [ws]);

  const selectRange = (item: RangeItem) => {
    if (!ws) return;
    const chart = (ws as any).active?.chart || ws.chart;
    if (!chart) return;

    setActiveRange(item.id);
    const now = Date.now();
    let from = now;

    if (item.isAll) {
      try {
        chart.renderer?.fitContent?.();
      } catch {}
      return;
    }

    if (item.days) {
      from = now - item.days * 86_400_000;
    } else if (item.months) {
      from = now - item.months * 30 * 86_400_000;
    } else if (item.years) {
      from = now - item.years * 365 * 86_400_000;
    } else if (item.isYtd) {
      from = new Date(new Date().getFullYear(), 0, 1).getTime();
    }

    // Give right padding (future buffer) of ~5% of visible span
    const span = now - from;
    const to = now + Math.round(span * 0.05);

    try {
      // If range recommends a specific timeframe for optimal resolution
      if (item.tf && chart.market?.timeframe !== item.tf) {
        if (ws.active) {
          ws.active.setTimeframe(item.tf);
        } else {
          chart.setMarket({ timeframe: item.tf });
        }
      }

      setTimeout(() => {
        try {
          chart.setVisibleRange({ from, to });
          chart.renderer?.setVisibleRange?.({ from, to });
        } catch {}
      }, 60);
    } catch {
      try {
        chart.setVisibleRange({ from, to });
      } catch {}
    }
  };

  const toggleLog = () => {
    if (!ws) return;
    const chart = (ws as any).active?.chart || ws.chart;
    if (!chart?.renderer?.set) return;
    const next = !isLog;
    try {
      chart.renderer.set({ logScale: next });
      setIsLog(next);
    } catch {}
  };

  const resetScale = () => {
    if (!ws) return;
    const chart = (ws as any).active?.chart || ws.chart;
    if (!chart?.renderer) return;
    try {
      chart.renderer.resetScale?.();
      chart.renderer.fitContent?.();
      setIsAuto(true);
    } catch {}
  };

  return (
    <div className="chart-bottom-range-bar" role="toolbar" aria-label="Quick date range selector">
      <div className="cbr-ranges">
        {RANGES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={"cbr-chip" + (activeRange === item.id ? " on" : "")}
            onClick={() => selectRange(item)}
            title={`View ${item.label} interval range`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="cbr-controls">
        <button
          type="button"
          className={"cbr-chip cbr-scale-btn" + (isLog ? " on" : "")}
          onClick={toggleLog}
          title={isLog ? "Logarithmic scale: ON" : "Logarithmic scale: OFF"}
        >
          log
        </button>
        <button
          type="button"
          className={"cbr-chip cbr-scale-btn" + (isAuto ? " on" : "")}
          onClick={resetScale}
          title="Auto fit & reset price scale (Alt+R)"
        >
          auto
        </button>
        <span className="cbr-tz" title="Current time zone">
          {tz}
        </span>

        <span className="cbr-divider" />

        {/* TradingView & Vela Quick Tool Buttons */}
        <button
          type="button"
          className="cbr-chip cbr-tool-btn"
          onClick={() => window.dispatchEvent(new CustomEvent("tradepro:open-strategy-tester"))}
          title="Open Strategy Tester & Indicator Performance Report"
        >
          📊 Strategy Tester
        </button>
        <button
          type="button"
          className="cbr-chip cbr-tool-btn"
          onClick={() => window.dispatchEvent(new CustomEvent("tradepro:open-pine-editor"))}
          title="Open Pine Script Editor"
        >
          {"{ }"} Pine Editor
        </button>
        <button
          type="button"
          className="cbr-chip cbr-tool-btn"
          onClick={() => window.dispatchEvent(new CustomEvent("tradepro:open-data-window"))}
          title="Toggle Data Window Inspector"
        >
          ⊞ Data Window
        </button>
        <button
          type="button"
          className="cbr-chip cbr-tool-btn"
          onClick={() => window.dispatchEvent(new CustomEvent("tradepro:snapshot"))}
          title="Take Chart Snapshot (Save Image / Copy to Clipboard)"
        >
          📸 Snapshot
        </button>
      </div>
    </div>
  );
}

