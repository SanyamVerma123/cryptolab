/**
 * indicatorsCatalog.ts — Canonical catalog of indicators for the modern Indicators Modal.
 *
 * Categorized matching vela.luxalgo.com:
 * - Yours: Favorites, On chart, My scripts
 * - Built-in: Basic (80), Order flow (17)
 * - Library: Discover, All scripts (817), Concepts (853)
 * - Families (All 17 MCP Families):
 *   Trend, Momentum, Volatility, Volume & Flow, Structure, SMC / ICT, Wyckoff,
 *   Elliott & Harmonics, Patterns, Levels, Statistics, Machine Learning,
 *   Time & Sessions, Sentiment & Breadth, Risk & Exits, Meta, Validation
 */

import catalogData from "./indicatorsCatalogData.json";

export interface CatalogIndicator {
  id: string;
  name: string;
  category: string;
  family?: string;
  families?: string[];
  author?: string;
  badge?: string;
  description?: string;
  nativeType?: string;
  pineScript?: string;
  luxSlug?: string;
  isCustom?: boolean;
}

export interface IndicatorCategoryDef {
  group: "Yours" | "Built-in" | "Library" | "Families";
  id: string;
  label: string;
  icon: string;
  count?: number;
}

export const INDICATOR_CATEGORIES: readonly IndicatorCategoryDef[] = [
  // --- YOURS ---
  { group: "Yours", id: "favorites", label: "Favorites", icon: "star" },
  { group: "Yours", id: "on_chart", label: "On chart", icon: "check-circle" },
  { group: "Yours", id: "my_scripts", label: "My scripts", icon: "user" },

  // --- BUILT-IN ---
  { group: "Built-in", id: "basic", label: "Basic", count: 80, icon: "line-chart" },
  { group: "Built-in", id: "order_flow", label: "Order flow", count: 17, icon: "bar-chart" },

  // --- LIBRARY ---
  { group: "Library", id: "discover", label: "Discover", icon: "compass" },
  { group: "Library", id: "all_scripts", label: "All scripts", count: 817, icon: "grid" },
  { group: "Library", id: "concepts", label: "Concepts", count: 853, icon: "layers" },

  // --- FAMILIES (All 17 Official MCP Families) ---
  { group: "Families", id: "trend", label: "Trend", count: 148, icon: "activity" },
  { group: "Families", id: "momentum", label: "Momentum", count: 105, icon: "waves" },
  { group: "Families", id: "volatility", label: "Volatility", count: 63, icon: "shield" },
  { group: "Families", id: "volume-orderflow", label: "Volume & Flow", count: 123, icon: "bar-chart" },
  { group: "Families", id: "market-structure", label: "Structure", count: 89, icon: "layers" },
  { group: "Families", id: "smc-ict", label: "SMC / ICT", count: 92, icon: "crosshair" },
  { group: "Families", id: "wyckoff", label: "Wyckoff", count: 15, icon: "trending-up" },
  { group: "Families", id: "elliott-harmonics", label: "Elliott & Harmonics", count: 23, icon: "triangle" },
  { group: "Families", id: "patterns", label: "Patterns", count: 70, icon: "shapes" },
  { group: "Families", id: "levels", label: "Levels", count: 66, icon: "sliders" },
  { group: "Families", id: "statistics", label: "Statistics", count: 63, icon: "pie-chart" },
  { group: "Families", id: "machine-learning", label: "Machine Learning", count: 30, icon: "cpu" },
  { group: "Families", id: "time-seasonality", label: "Time & Sessions", count: 44, icon: "clock" },
  { group: "Families", id: "sentiment-breadth", label: "Sentiment & Breadth", count: 25, icon: "gauge" },
  { group: "Families", id: "risk-exits", label: "Risk & Exits", count: 20, icon: "alert-triangle" },
  { group: "Families", id: "meta-composition", label: "Meta", count: 34, icon: "box" },
  { group: "Families", id: "validation", label: "Validation", count: 3, icon: "check-square" },
] as const;

export type CategoryId = (typeof INDICATOR_CATEGORIES)[number]["id"];

/** Comprehensive built-in indicator presets with native bindings */
const BUILT_IN_INDICATORS: CatalogIndicator[] = [
  // --- BASIC (Built-in) ---
  { id: "rsi", name: "Relative Strength Index (RSI)", category: "basic", family: "momentum", badge: "Built-in", nativeType: "rsi", description: "Measures the speed and change of price movements between 0 and 100." },
  { id: "macd", name: "Moving Average Convergence Divergence (MACD)", category: "basic", family: "momentum", badge: "Built-in", nativeType: "macd", description: "Trend-following momentum indicator showing relationship between two moving averages." },
  { id: "ema", name: "Moving Average Exponential (EMA)", category: "basic", family: "trend", badge: "Built-in", nativeType: "ema", description: "Exponential moving average placing greater weight on recent prices." },
  { id: "sma", name: "Moving Average Simple (SMA)", category: "basic", family: "trend", badge: "Built-in", nativeType: "sma", description: "Simple arithmetic mean of prices over a specified period." },
  { id: "wma", name: "Moving Average Weighted (WMA)", category: "basic", family: "trend", badge: "Built-in", nativeType: "wma", description: "Weighted moving average with linearly decreasing weights." },
  { id: "vwma", name: "Volume Weighted Moving Average (VWMA)", category: "basic", family: "trend", badge: "Built-in", nativeType: "vwma", description: "Moving average weighted by bar volume." },
  { id: "bb", name: "Bollinger Bands (BB)", category: "basic", family: "volatility", badge: "Built-in", nativeType: "bb", description: "Volatility bands set standard deviations above and below a moving average." },
  { id: "stoch", name: "Stochastic", category: "basic", family: "momentum", badge: "Built-in", nativeType: "stoch", description: "Compares a closing price to price range over a given time period." },
  { id: "stochrsi", name: "Stochastic RSI", category: "basic", family: "momentum", badge: "Built-in", nativeType: "stochrsi", description: "Applies the Stochastic formula to RSI values instead of standard price data." },
  { id: "atr", name: "Average True Range (ATR)", category: "basic", family: "volatility", badge: "Built-in", nativeType: "atr", description: "Measures market volatility by decomposing the entire range of an asset price." },
  { id: "supertrend", name: "Supertrend", category: "basic", family: "trend", badge: "Built-in", nativeType: "supertrend", description: "ATR-based trend-following indicator providing clear stop/reversal levels." },
  { id: "vwap", name: "Volume Weighted Average Price (VWAP)", category: "basic", family: "order_flow", badge: "Built-in", nativeType: "vwap", description: "Trading benchmark that represents the average price a security traded at based on both volume and price." },
  { id: "adx", name: "Average Directional Index (ADX)", category: "basic", family: "trend", badge: "Built-in", nativeType: "adx", description: "Measures overall trend strength without regard to trend direction." },
  { id: "cci", name: "Commodity Channel Index (CCI)", category: "basic", family: "momentum", badge: "Built-in", nativeType: "cci", description: "Measures an asset's price level relative to its statistical average." },
  { id: "parabolicsar", name: "Parabolic SAR", category: "basic", family: "trend", badge: "Built-in", nativeType: "parabolicsar", description: "Trailing stop and reverse points plotted along price trend." },
  { id: "ichimoku", name: "Ichimoku Cloud", category: "basic", family: "trend", badge: "Built-in", nativeType: "ichimoku", description: "Defines support and resistance, gauges momentum, and provides trading signals." },
  { id: "volume", name: "Volume (Vol)", category: "basic", family: "order_flow", badge: "Built-in", nativeType: "volume", description: "Total quantity of shares or contracts traded over each bar." },
  { id: "obv", name: "On-Balance Volume (OBV)", category: "basic", family: "order_flow", badge: "Built-in", nativeType: "obv", description: "Uses volume flow to predict changes in stock price." },
  { id: "williamsr", name: "Williams %R", category: "basic", family: "momentum", badge: "Built-in", nativeType: "williamsr", description: "Reflects the level of the close relative to the high-low range over a set period." },
  { id: "mfi", name: "Money Flow Index (MFI)", category: "basic", family: "momentum", badge: "Built-in", nativeType: "mfi", description: "Technical oscillator that uses price and volume data for identifying overbought or oversold signals." },
  { id: "hma", name: "Hull Moving Average (HMA)", category: "basic", family: "trend", badge: "Built-in", nativeType: "hma", description: "Fast and smooth moving average with almost eliminated lag." },
  { id: "donchian", name: "Donchian Channels", category: "basic", family: "volatility", badge: "Built-in", nativeType: "donchian", description: "Three bands generated by moving average calculations that comprise an indicator formed by upper and lower bands around a mid-range." },
  { id: "keltner", name: "Keltner Channels", category: "basic", family: "volatility", badge: "Built-in", nativeType: "keltner", description: "Volatility-based bands that are placed above and below an exponential moving average." },
  { id: "zigzag", name: "Zig Zag", category: "basic", family: "trend", badge: "Built-in", nativeType: "zigzag", description: "Filters out small price movements to highlight significant trends and reversals." },
  { id: "pivotpoints", name: "Pivot Points Standard", category: "basic", family: "trend", badge: "Built-in", nativeType: "pivotpoints", description: "Technical analysis indicators used to determine the overall trend of the market over different time frames." },
  { id: "histvol", name: "Historical Volatility", category: "basic", family: "volatility", badge: "Built-in", nativeType: "histvol", description: "Statistical measure of the dispersion of returns for a given security or market index over a given period." },
  { id: "roc", name: "Rate of Change (ROC)", category: "basic", family: "momentum", badge: "Built-in", nativeType: "roc", description: "Pure momentum oscillator that measures the percent change in price from one period to the next." },
  { id: "awesome", name: "Awesome Oscillator (AO)", category: "basic", family: "momentum", badge: "Built-in", nativeType: "awesome", description: "Determines market momentum by comparing recent market movements with historic market movements." },

  // --- ORDER FLOW (Built-in) ---
  { id: "cvd", name: "Cumulative Volume Delta (CVD)", category: "order_flow", family: "order_flow", badge: "Order flow", nativeType: "cvd", description: "Tracks cumulative net difference between aggressive market buyers and sellers." },
  { id: "volumeprofile", name: "Volume Profile (Fixed & Session)", category: "order_flow", family: "order_flow", badge: "Order flow", nativeType: "volumeprofile", description: "Displays trading activity over a specified time period at specified price levels." },
  { id: "order_flow_delta", name: "Delta Volume Bars", category: "order_flow", family: "order_flow", badge: "Order flow", nativeType: "cvd", description: "Visualizes aggressive buying volume vs selling volume for each bar." },
  { id: "bid_ask_imbalance", name: "Bid / Ask Volume Imbalance", category: "order_flow", family: "order_flow", badge: "Order flow", nativeType: "cvd", description: "Detects stacked buyer and seller aggressive imbalances at candle levels." },
  { id: "volume_flow_indicator", name: "Volume Flow Indicator (VFI)", category: "order_flow", family: "order_flow", badge: "Order flow", nativeType: "obv", description: "Measures volume pressure direction based on price changes." },
  { id: "liquidity_heatmap", name: "Liquidity Order Depth Heatmap", category: "order_flow", family: "order_flow", badge: "Order flow", nativeType: "volumeprofile", description: "Visualizes concentrated resting limit orders in the book." },
  { id: "footprint_delta", name: "Footprint Aggression Delta", category: "order_flow", family: "order_flow", badge: "Order flow", nativeType: "cvd", description: "Realtime institutional absorption and exhaustion tracker." },
  { id: "taker_ratio", name: "Taker Buy / Sell Volume Ratio", category: "order_flow", family: "order_flow", badge: "Order flow", nativeType: "cvd", description: "Real-time ratio between aggressive taker buys and taker sells." },
  { id: "open_interest_delta", name: "Open Interest & Net Delta", category: "order_flow", family: "order_flow", badge: "Order flow", nativeType: "cvd", description: "Correlates contract accumulation with aggressive price moves." },
  { id: "institutional_absorption", name: "Institutional Absorption Detector", category: "order_flow", family: "order_flow", badge: "Order flow", nativeType: "volumeprofile", description: "Pinpoints high-volume bars with narrow price movement indicating passive absorption." },

  // --- DISCOVER / CONCEPTS (Library & LuxAlgo Flags) ---
  { id: "smc_lux", name: "Smart Money Concepts [LuxAlgo]", category: "discover", family: "trend", author: "LuxAlgo", badge: "Top rated", luxSlug: "smart-money-concepts", description: "The most popular SMC indicator: real-time Market Structure (CHoCH, BOS), Order Blocks, and Fair Value Gaps." },
  { id: "signals_overlays", name: "Signals & Overlays [LuxAlgo]", category: "discover", family: "trend", author: "LuxAlgo", badge: "Featured", luxSlug: "signals-overlays", description: "All-in-one trading toolkit with adaptive signals, trend confirmation, and dashboard." },
  { id: "oscillator_matrix", name: "Oscillator Matrix [LuxAlgo]", category: "discover", family: "momentum", author: "LuxAlgo", badge: "Popular", luxSlug: "oscillator-matrix", description: "Advanced multi-oscillator confluence engine for timing entries and exits." },
  { id: "trend_lines_lux", name: "Trend Lines with Breaks [LuxAlgo]", category: "discover", family: "trend", author: "LuxAlgo", badge: "Trending", luxSlug: "trendlines-with-breaks", description: "Smart algorithmic trendlines with breakout detection and volume confirmation." },
  { id: "supertrend_ai", name: "Supertrend AI [LuxAlgo]", category: "trend", family: "trend", author: "LuxAlgo", badge: "Trend", luxSlug: "supertrend-ai", description: "Machine learning enhanced Supertrend with clustering parameters." },
];

// Merge built-in indicators with official library dataset
const builtInIds = new Set(BUILT_IN_INDICATORS.map((b) => b.id));
const libraryCatalog: CatalogIndicator[] = (catalogData as CatalogIndicator[]).filter(
  (item) => !builtInIds.has(item.id)
);

export const CATALOG_INDICATORS: CatalogIndicator[] = [
  ...BUILT_IN_INDICATORS,
  ...libraryCatalog,
];

const FAVS_KEY = "trade-pro:indicator-favorites";

export function loadIndicatorFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : ["rsi", "macd", "ema", "smc_lux", "cvd"];
  } catch {
    return ["rsi", "macd", "ema", "smc_lux", "cvd"];
  }
}

export function saveIndicatorFavorites(favs: string[]): void {
  try {
    localStorage.setItem(FAVS_KEY, JSON.stringify(favs));
  } catch {}
}
