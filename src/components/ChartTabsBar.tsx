import { useState, useEffect } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import { getSafeActiveChart, getSafeActiveCell } from "../lib/workspaceSafe";
import { PaperAccountWidget } from "./PaperAccountWidget";

export interface ChartTabItem {
  id: string;
  coin: string;
  symbol: string;
  timeframe: string;
}

interface Props {
  ws: VelaWorkspace | null;
  activeCoin: string;
  activeTimeframe: string;
  onSelect: (coin: string, timeframe: string) => void;
}

const TABS_STORAGE_KEY = "tradepro_chart_tabs_v2";
const ACTIVE_TAB_KEY = "tradepro_active_tab_id_v2";

/**
 * Format any raw timeframe interval string into standard TradingView label.
 * E.g.: "240" -> "4h", "60" -> "1h", "1" -> "1m", "D" -> "1D"
 */
export function formatTf(tf: string | number | undefined): string {
  if (!tf) return "1m";
  const s = String(tf).trim();
  if (s === "1") return "1m";
  if (s === "3") return "3m";
  if (s === "5") return "5m";
  if (s === "15") return "15m";
  if (s === "30") return "30m";
  if (s === "45") return "45m";
  if (s === "60") return "1h";
  if (s === "120") return "2h";
  if (s === "180") return "3h";
  if (s === "240") return "4h";
  if (s === "360") return "6h";
  if (s === "480") return "8h";
  if (s === "720") return "12h";
  if (s === "D" || s === "1D" || s === "1d" || s === "d") return "1D";
  if (s === "W" || s === "1W" || s === "1w" || s === "w") return "1W";
  if (s === "M" || s === "1M") return "1M";
  return s;
}

function barsForTf(tf: string): number {
  const norm = tf.toLowerCase();
  if (norm === "1" || norm === "1m") return 5000;
  if (norm === "3" || norm === "3m" || norm === "5" || norm === "5m") return 4000;
  if (norm === "15" || norm === "15m" || norm === "30" || norm === "30m") return 3000;
  return 2500;
}

const DEFAULT_TABS: ChartTabItem[] = [
  { id: "tab_btc", coin: "BTC", symbol: "BTCUSDT", timeframe: "1m" },
  { id: "tab_eth", coin: "ETH", symbol: "ETHUSDT", timeframe: "15m" },
];

function getCoinGlyph(coin: string): string {
  const c = coin.toUpperCase().replace(/USDT$/i, "");
  if (c === "BTC") return "₿";
  if (c === "ETH") return "⟠";
  if (c === "SOL") return "◎";
  if (c === "DOGE") return "Ð";
  if (c === "BNB") return "⬡";
  if (c === "XRP") return "✕";
  if (c === "AVAX") return "▲";
  if (c === "SUI") return "💧";
  if (c === "NEAR") return "Ⓝ";
  if (c === "LINK") return "⬡";
  if (c === "PEPE") return "🐸";
  if (c === "ARB") return "🔵";
  if (c === "APT") return "▲";
  if (c === "OP") return "🔴";
  if (c === "INJ") return "⚡";
  if (c === "TIA") return "✨";
  return "●";
}

export function ChartTabsBar({ ws, activeCoin, activeTimeframe, onSelect }: Props) {
  const [tabs, setTabs] = useState<ChartTabItem[]>(() => {
    try {
      const saved = localStorage.getItem(TABS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_TABS;
  });

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    try {
      const savedId = localStorage.getItem(ACTIVE_TAB_KEY);
      if (savedId && tabs.some((t) => t.id === savedId)) return savedId;
    } catch {}
    return tabs[0]?.id || "tab_btc";
  });

  // Save tabs on change
  useEffect(() => {
    try {
      localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabs));
    } catch {}
  }, [tabs]);

  // Save activeTabId on change
  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_TAB_KEY, activeTabId);
    } catch {}
  }, [activeTabId]);

  const cleanCoin = (activeCoin || "BTC").toUpperCase().replace(/USDT$/i, "");
  const cleanActiveTf = formatTf(activeTimeframe);

  // When user changes the coin or timeframe on the chart, update the CURRENT active tab!
  useEffect(() => {
    if (!cleanCoin) return;
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === activeTabId);
      if (idx === -1) return prev;
      const cur = prev[idx];
      if (cur.coin === cleanCoin && cur.timeframe === cleanActiveTf) return prev;
      const updated = [...prev];
      updated[idx] = {
        ...cur,
        coin: cleanCoin,
        symbol: `${cleanCoin}USDT`,
        timeframe: cleanActiveTf,
      };
      return updated;
    });
  }, [cleanCoin, cleanActiveTf, activeTabId]);

  const handleSelectTab = (tab: ChartTabItem) => {
    setActiveTabId(tab.id);
    const targetTf = formatTf(tab.timeframe);
    onSelect(tab.coin, targetTf);
    try {
      const cell = getSafeActiveCell(ws) as any;
      if (cell) {
        cell.setSymbol?.(tab.symbol || `${tab.coin.toUpperCase()}USDT`);
        cell.setTimeframe?.(targetTf);
      }
      const chart = getSafeActiveChart(ws) as any;
      if (chart?.setMarket) {
        chart.setMarket({
          symbol: tab.symbol || `${tab.coin.toUpperCase()}USDT`,
          timeframe: targetTf,
          bars: barsForTf(targetTf),
        });
      }
    } catch (e) {
      console.warn("[ChartTabsBar] handleSelectTab failed:", e);
    }
  };

  /**
   * "When i click the new tab it will open the btc then i can change the coin by myself"
   * Immediately opens a new tab with BTC and switches chart to BTC.
   */
  const handleAddNewTab = () => {
    const newId = `tab_${Date.now()}`;
    const targetTf = cleanActiveTf || "1m";
    const newTab: ChartTabItem = {
      id: newId,
      coin: "BTC",
      symbol: "BTCUSDT",
      timeframe: targetTf,
    };

    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);

    // Switch chart to BTC
    onSelect("BTC", targetTf);
    try {
      const cell = getSafeActiveCell(ws) as any;
      if (cell) {
        cell.setSymbol?.("BTCUSDT");
        cell.setTimeframe?.(targetTf);
      }
      const chart = getSafeActiveChart(ws) as any;
      if (chart?.setMarket) {
        chart.setMarket({
          symbol: "BTCUSDT",
          timeframe: targetTf,
          bars: barsForTf(targetTf),
        });
      }
    } catch (e) {
      console.warn("[ChartTabsBar] failed to set BTC on new tab:", e);
    }
  };

  const handleCloseTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length <= 1) return; // Keep at least one tab
    const closedIdx = tabs.findIndex((t) => t.id === id);
    const nextTabs = tabs.filter((t) => t.id !== id);
    setTabs(nextTabs);
    if (id === activeTabId && nextTabs.length > 0) {
      const targetIdx = Math.min(closedIdx, nextTabs.length - 1);
      handleSelectTab(nextTabs[targetIdx]);
    }
  };

  return (
    <div className="chart-tabs-bar" role="tablist" aria-label="Open Chart Tabs">
      <div className="chart-tabs-list">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const displayTf = formatTf(tab.timeframe);
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              className={`chart-tab-item${isActive ? " is-active" : ""}`}
              onClick={() => handleSelectTab(tab)}
              title={`${tab.symbol} · ${displayTf} (Click to switch chart)`}
            >
              <span className="chart-tab-glyph">{getCoinGlyph(tab.coin)}</span>
              <span className="chart-tab-name">
                {tab.coin}USDT <span className="chart-tab-tf">· {displayTf}</span>
              </span>
              {tabs.length > 1 && (
                <button
                  type="button"
                  className="chart-tab-close"
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  title="Close tab"
                  aria-label="Close tab"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}

        {/* Plus / Add New Tab Button (Opens BTC immediately) */}
        <div className="chart-tab-add-wrap">
          <button
            type="button"
            className="chart-tab-add-btn"
            onClick={handleAddNewTab}
            title="Open new tab (BTC)"
            aria-label="Open new tab"
          >
            +
          </button>
        </div>
      </div>

      {/* Docked In-Bar Paper Account Component Matching TradingView Dock */}
      <div className="chart-tabs-right">
        <PaperAccountWidget ws={ws} coin={activeCoin} />
      </div>
    </div>
  );
}
