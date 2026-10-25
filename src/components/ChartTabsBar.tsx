import { useState, useEffect, useRef } from "react";
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

const TABS_STORAGE_KEY = "tradepro_chart_tabs_v1";

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
  const c = coin.toUpperCase();
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

const POPULAR_COINS = [
  { coin: "BTC", name: "Bitcoin", glyph: "₿", tf: "1m" },
  { coin: "ETH", name: "Ethereum", glyph: "⟠", tf: "15m" },
  { coin: "SOL", name: "Solana", glyph: "◎", tf: "1h" },
  { coin: "DOGE", name: "Dogecoin", glyph: "Ð", tf: "4h" },
  { coin: "XRP", name: "Ripple", glyph: "✕", tf: "1D" },
  { coin: "BNB", name: "BNB", glyph: "⬡", tf: "1h" },
  { coin: "AVAX", name: "Avalanche", glyph: "▲", tf: "15m" },
  { coin: "SUI", name: "Sui", glyph: "💧", tf: "1h" },
  { coin: "NEAR", name: "Near Protocol", glyph: "Ⓝ", tf: "4h" },
  { coin: "LINK", name: "Chainlink", glyph: "⬡", tf: "1h" },
  { coin: "PEPE", name: "Pepe", glyph: "🐸", tf: "15m" },
  { coin: "ARB", name: "Arbitrum", glyph: "🔵", tf: "1h" },
  { coin: "APT", name: "Aptos", glyph: "▲", tf: "15m" },
  { coin: "OP", name: "Optimism", glyph: "🔴", tf: "1h" },
  { coin: "INJ", name: "Injective", glyph: "⚡", tf: "4h" },
  { coin: "TIA", name: "Celestia", glyph: "✨", tf: "1h" },
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
  const [searchQuery, setSearchQuery] = useState("");

  // Save tabs on change
  useEffect(() => {
    try {
      localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabs));
    } catch {}
  }, [tabs]);

  const pickerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close tab picker on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    const outside = (e: PointerEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
        setSearchQuery("");
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [pickerOpen]);

  // Focus search input when picker opens
  useEffect(() => {
    if (pickerOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 60);
    }
  }, [pickerOpen]);

  // Sync activeCoin & activeTimeframe with current tabs
  const cleanActiveTf = formatTf(activeTimeframe);
  useEffect(() => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.coin.toUpperCase() === activeCoin.toUpperCase());
      if (idx === -1) {
        return [
          ...prev,
          {
            id: `tab_${Date.now()}`,
            coin: activeCoin.toUpperCase(),
            symbol: `${activeCoin.toUpperCase()}USDT`,
            timeframe: cleanActiveTf,
          },
        ];
      }
      if (prev[idx].timeframe !== cleanActiveTf) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], timeframe: cleanActiveTf };
        return updated;
      }
      return prev;
    });
  }, [activeCoin, cleanActiveTf]);

  const handleSelectTab = (tab: ChartTabItem) => {
    const targetTf = formatTf(tab.timeframe);
    onSelect(tab.coin, targetTf);
    try {
      const cell = getSafeActiveCell(ws) as any;
      if (cell) {
        cell.setSymbol?.(tab.symbol || `${tab.coin.toUpperCase()}USDT`);
        cell.setTimeframe?.(tab.timeframe);
      }
      const chart = getSafeActiveChart(ws) as any;
      if (chart?.setMarket) {
        chart.setMarket({
          symbol: tab.symbol || `${tab.coin.toUpperCase()}USDT`,
          timeframe: tab.timeframe,
          bars: barsForTf(tab.timeframe),
        });
      }
    } catch (e) {
      console.warn("[ChartTabsBar] handleSelectTab failed:", e);
    }
  };

  const handleCloseTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length <= 1) return; // Keep at least one tab
    const closedIdx = tabs.findIndex((t) => t.id === id);
    const nextTabs = tabs.filter((t) => t.id !== id);
    setTabs(nextTabs);
    const closedTab = tabs[closedIdx];
    if (closedTab && closedTab.coin.toUpperCase() === activeCoin.toUpperCase() && nextTabs.length > 0) {
      const targetIdx = Math.min(closedIdx, nextTabs.length - 1);
      handleSelectTab(nextTabs[targetIdx]);
    }
  };

  const handleAddTab = (coinName: string, tf: string = cleanActiveTf) => {
    const cleanCoin = coinName.toUpperCase().replace(/USDT$/i, "").trim();
    if (!cleanCoin) return;
    const existing = tabs.find((t) => t.coin.toUpperCase() === cleanCoin);
    if (existing) {
      handleSelectTab(existing);
      setPickerOpen(false);
      setSearchQuery("");
      return;
    }
    const newTab: ChartTabItem = {
      id: `tab_${Date.now()}`,
      coin: cleanCoin,
      symbol: `${cleanCoin}USDT`,
      timeframe: formatTf(tf),
    };
    setTabs((prev) => [...prev, newTab]);
    handleSelectTab(newTab);
    setPickerOpen(false);
    setSearchQuery("");
  };

  const filteredCoins = POPULAR_COINS.filter((c) => {
    const q = searchQuery.trim().toUpperCase();
    if (!q) return true;
    return c.coin.includes(q) || c.name.toUpperCase().includes(q);
  });

  const queryCoin = searchQuery.trim().toUpperCase().replace(/USDT$/i, "");
  const hasExactMatch = POPULAR_COINS.some((c) => c.coin === queryCoin);

  return (
    <div className="chart-tabs-bar" role="tablist" aria-label="Open Chart Tabs">
      <div className="chart-tabs-list">
        {tabs.map((tab) => {
          const isActive = tab.coin.toUpperCase() === activeCoin.toUpperCase();
          const displayTf = formatTf(tab.timeframe);
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              className={`chart-tab-item${isActive ? " is-active" : ""}`}
              onClick={() => handleSelectTab(tab)}
              title={`${tab.symbol} · ${displayTf}`}
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

        {/* Plus / Add Tab Button & Searchable Picker */}
        <div className="chart-tab-add-wrap" ref={pickerRef}>
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
                <span>Add Chart Tab</span>
                <button
                  type="button"
                  className="ctp-close"
                  onClick={() => {
                    setPickerOpen(false);
                    setSearchQuery("");
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Instant Search Bar */}
              <div className="ctp-search-wrap">
                <svg className="ctp-search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  className="ctp-search-input"
                  placeholder="Search coin (e.g. PEPE, SUI)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && queryCoin) {
                      handleAddTab(queryCoin);
                    } else if (e.key === "Escape") {
                      setPickerOpen(false);
                      setSearchQuery("");
                    }
                  }}
                />
              </div>

              <div className="ctp-list">
                {queryCoin && !hasExactMatch && (
                  <button
                    type="button"
                    className="ctp-item ctp-custom-add"
                    onClick={() => handleAddTab(queryCoin)}
                  >
                    <span className="ctp-glyph">+</span>
                    <span className="ctp-title">Open <b>{queryCoin}USDT</b></span>
                    <span className="ctp-tf">{cleanActiveTf}</span>
                  </button>
                )}

                {filteredCoins.map((p) => (
                  <button
                    key={p.coin}
                    type="button"
                    className="ctp-item"
                    onClick={() => handleAddTab(p.coin, p.tf)}
                  >
                    <span className="ctp-glyph">{p.glyph}</span>
                    <div className="ctp-info">
                      <span className="ctp-title">{p.coin}USDT</span>
                      <span className="ctp-subtitle">{p.name}</span>
                    </div>
                    <span className="ctp-tf">{formatTf(p.tf)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Docked In-Bar Paper Account Component Matching TradingView Dock */}
      <div className="chart-tabs-right">
        <PaperAccountWidget ws={ws} coin={activeCoin} />
      </div>
    </div>
  );
}
