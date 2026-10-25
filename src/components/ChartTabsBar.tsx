import { useState, useEffect } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import { getSafeActiveChart } from "../lib/workspaceSafe";

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

const TABS_STORAGE_KEY = "tradepro_chart_tabs_v1";

const DEFAULT_TABS: ChartTabItem[] = [
  { id: "tab_btc", coin: "BTC", symbol: "BTCUSDT", timeframe: "1m" },
  { id: "tab_eth", coin: "ETH", symbol: "ETHUSDT", timeframe: "15m" },
];

function getCoinGlyph(coin: string): string {
  const c = coin.toUpperCase();
  if (c === "BTC") return "₿";
  if (c === "ETH") return "⟠";
  if (c === "SOL") return "◎";
  if (c === "DOGE") return "Ð";
  if (c === "BNB") return "⬡";
  return "●";
}

const QUICK_PAIRS = [
  { coin: "BTC", symbol: "BTCUSDT", timeframe: "1m" },
  { coin: "ETH", symbol: "ETHUSDT", timeframe: "15m" },
  { coin: "SOL", symbol: "SOLUSDT", timeframe: "1h" },
  { coin: "DOGE", symbol: "DOGEUSDT", timeframe: "4h" },
  { coin: "XRP", symbol: "XRPUSDT", timeframe: "1D" },
];

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

  const [pickerOpen, setPickerOpen] = useState(false);

  // Save tabs on change
  useEffect(() => {
    try {
      localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabs));
    } catch {}
  }, [tabs]);

  // Sync activeCoin with current tabs
  useEffect(() => {
    const exists = tabs.some((t) => t.coin.toUpperCase() === activeCoin.toUpperCase());
    if (!exists) {
      const newTab: ChartTabItem = {
        id: `tab_${Date.now()}`,
        coin: activeCoin,
        symbol: `${activeCoin.toUpperCase()}USDT`,
        timeframe: activeTimeframe,
      };
      setTabs((prev) => [...prev, newTab]);
    }
  }, [activeCoin, activeTimeframe, tabs]);

  const handleSelectTab = (tab: ChartTabItem) => {
    onSelect(tab.coin, tab.timeframe);
    try {
      const chart = getSafeActiveChart(ws) as any;
      if (chart?.setMarket) {
        chart.setMarket(`${tab.coin.toUpperCase()}USDT`, tab.timeframe);
      }
    } catch {}
  };

  const handleCloseTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length <= 1) return; // Keep at least one tab
    const nextTabs = tabs.filter((t) => t.id !== id);
    setTabs(nextTabs);
    const closedTab = tabs.find((t) => t.id === id);
    if (closedTab && closedTab.coin.toUpperCase() === activeCoin.toUpperCase() && nextTabs.length > 0) {
      handleSelectTab(nextTabs[0]);
    }
  };

  const handleAddTab = (pair: { coin: string; symbol: string; timeframe: string }) => {
    const existing = tabs.find((t) => t.coin.toUpperCase() === pair.coin.toUpperCase());
    if (existing) {
      handleSelectTab(existing);
      setPickerOpen(false);
      return;
    }
    const newTab: ChartTabItem = {
      id: `tab_${Date.now()}`,
      coin: pair.coin,
      symbol: pair.symbol,
      timeframe: pair.timeframe,
    };
    setTabs((prev) => [...prev, newTab]);
    handleSelectTab(newTab);
    setPickerOpen(false);
  };

  return (
    <div className="chart-tabs-bar" role="tablist" aria-label="Open Chart Tabs">
      <div className="chart-tabs-list">
        {tabs.map((tab) => {
          const isActive = tab.coin.toUpperCase() === activeCoin.toUpperCase();
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              className={`chart-tab-item${isActive ? " is-active" : ""}`}
              onClick={() => handleSelectTab(tab)}
              title={`${tab.symbol} · ${tab.timeframe}`}
            >
              <span className="chart-tab-glyph">{getCoinGlyph(tab.coin)}</span>
              <span className="chart-tab-name">
                {tab.coin}USDT <span className="chart-tab-tf">· {tab.timeframe}</span>
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

        {/* Plus / Add Tab Button */}
        <div className="chart-tab-add-wrap">
          <button
            type="button"
            className="chart-tab-add-btn"
            onClick={() => setPickerOpen((v) => !v)}
            title="Open new chart tab"
            aria-label="Add new chart tab"
          >
            +
          </button>

          {pickerOpen && (
            <div className="chart-tab-picker">
              <div className="ctp-head">
                <span>Open New Chart Tab</span>
                <button type="button" className="ctp-close" onClick={() => setPickerOpen(false)}>
                  ✕
                </button>
              </div>
              <div className="ctp-list">
                {QUICK_PAIRS.map((p) => (
                  <button
                    key={p.coin}
                    type="button"
                    className="ctp-item"
                    onClick={() => handleAddTab(p)}
                  >
                    <span className="ctp-glyph">{getCoinGlyph(p.coin)}</span>
                    <span className="ctp-title">{p.symbol}</span>
                    <span className="ctp-tf">{p.timeframe}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
