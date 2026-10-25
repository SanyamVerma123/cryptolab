/**
 * IndicatorsModal.tsx — Redesigned, ultra-smooth indicator dialog matching vela.luxalgo.com.
 *
 * Implements:
 * 1. Categorization matching official Vela & MCP:
 *    - Yours: Favorites, On chart (with live handles & toggles), My scripts
 *    - Built-in: Basic (80), Order flow (17)
 *    - Library: Discover, All scripts (817), Concepts (853)
 *    - Families (All 17 MCP Families): Trend, Momentum, Volatility, Volume & Flow, Structure,
 *      SMC / ICT, Wyckoff, Elliott & Harmonics, Patterns, Levels, Statistics, Machine Learning,
 *      Time & Sessions, Sentiment & Breadth, Risk & Exits, Meta, Validation
 * 2. On Chart management:
 *    - Live count in sidebar under "Yours"
 *    - Direct visibility toggle (eye open/closed)
 *    - Direct removal from active chart
 * 3. Bottom pagination & smooth scrolling:
 *    - Middle scrollbar eliminated (sidebar scrollbar hidden)
 *    - Chunked bottom loading (32 initial + 48 on scroll/button)
 *    - Fast, fluid rendering on any device (low-RAM optimized)
 * 4. Custom scripts deletion:
 *    - Permanent deletion option ONLY for custom scripts ('My scripts')
 *    - Pre-installed built-in & library indicators protected
 */
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import { getSafeActiveChart, getSafeActiveCell } from "../lib/workspaceSafe";
import {
  CATALOG_INDICATORS,
  INDICATOR_CATEGORIES,
  loadIndicatorFavorites,
  saveIndicatorFavorites,
  type CatalogIndicator,
  type CategoryId,
} from "../lib/indicatorsCatalog";
import {
  loadPineLibrary,
  forgetPineIndicatorEverywhere,
  rememberPineIndicator,
  type SavedPineScript,
} from "../lib/pinePersist";
import { getIndicatorSource, runPineIndicator } from "../lib/luxAlgoClient";
import { rememberLuxIndicator } from "../lib/luxPersist";
import { pushToCloud, scheduleCloudPush } from "../lib/cloudSync";
import { syncCustomLibrary } from "./PineEditor";
import "../styles/indicatorsModal.css";

interface Props {
  open: boolean;
  onClose: () => void;
  ws: VelaWorkspace | null;
}

interface AppliedIndicator {
  id: string;
  name: string;
  badge: string;
  visible: boolean;
  native?: boolean;
  nativeType?: string;
  handle?: any;
  index: number;
}

const PAGE_SIZE = 32;

export function IndicatorsModal({ open, onClose, ws }: Props) {
  const [activeCategory, setActiveCategory] = useState<CategoryId>("favorites");
  const [query, setQuery] = useState("");
  const [favs, setFavs] = useState<string[]>(() => loadIndicatorFavorites());
  const [customScripts, setCustomScripts] = useState<SavedPineScript[]>(() => loadPineLibrary());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Sync favorites & custom scripts on modal open
  useEffect(() => {
    if (open) {
      setFavs(loadIndicatorFavorites());
      setCustomScripts(loadPineLibrary());
      setQuery("");
      setLimit(PAGE_SIZE);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [open]);

  // Reset pagination limit and scroll to top whenever category or search query changes
  useEffect(() => {
    setLimit(PAGE_SIZE);
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [activeCategory, query]);

  // Global keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "/" && document.activeElement !== searchInputRef.current) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Live indicators applied to the current active chart
  const appliedIndicators = useMemo<AppliedIndicator[]>(() => {
    if (!ws || !open) return [];
    const list: AppliedIndicator[] = [];

    try {
      const chart = getSafeActiveChart(ws);
      const handles = chart?.indicators?.() || [];
      if (handles.length > 0) {
        handles.forEach((h: any, idx: number) => {
          let badge = "Indicator";
          if (h.nativeType) badge = "Built-in";
          else if (h.source?.includes("luxalgo") || h.title?.includes("LuxAlgo")) badge = "LuxAlgo";
          else if (h.source) badge = "Pine";

          list.push({
            id: h.id || `ind_${idx}`,
            name: h.title || h.name || `Indicator ${idx + 1}`,
            badge,
            visible: h.visible !== false,
            native: !!h.nativeType,
            nativeType: h.nativeType,
            handle: h,
            index: idx,
          });
        });
        return list;
      }

      // Fallback: read from cell onChartRows
      const cell = getSafeActiveCell(ws);
      const rows = (cell as any)?.onChartRows?.() || [];
      rows.forEach((r: any, idx: number) => {
        list.push({
          id: `row_${idx}`,
          name: r.name || `Indicator ${idx + 1}`,
          badge: r.native ? "Built-in" : (r.language ? "Pine" : "Script"),
          visible: true,
          native: r.native,
          nativeType: r.nativeType,
          index: idx,
        });
      });
    } catch (err) {
      console.warn("[trade-pro] error reading on-chart indicators:", err);
    }

    return list;
  }, [ws, open, refreshKey, feedback]);

  // Set of names currently on the chart for ON CHART badges
  const onChartNames = useMemo(() => {
    const set = new Set<string>();
    appliedIndicators.forEach((a) => {
      if (a.name) set.add(a.name.toLowerCase());
    });
    return set;
  }, [appliedIndicators]);

  // Toggle favorite
  const handleToggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavs((prev) => {
      const next = prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id];
      saveIndicatorFavorites(next);
      return next;
    });
  };

  // Toggle visibility of an indicator on chart
  const handleToggleVisibility = (item: AppliedIndicator, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (item.handle && typeof item.handle.setVisible === "function") {
        item.handle.setVisible(!item.visible);
        setRefreshKey((k) => k + 1);
      }
    } catch (err) {
      console.warn("Could not toggle visibility:", err);
    }
  };

  // Remove indicator from the active chart
  const handleRemoveFromChart = (item: AppliedIndicator, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const cell = getSafeActiveCell(ws);
      const chart = getSafeActiveChart(ws);
      if (item.handle && typeof item.handle.remove === "function") {
        item.handle.remove();
      } else if (cell && typeof (cell as any).removeFromChart === "function") {
        (cell as any).removeFromChart(item.index);
      } else if (chart && typeof (chart as any).removeIndicator === "function") {
        (chart as any).removeIndicator(item.handle || item.id);
      }

      setFeedback(`Removed "${item.name}" from chart`);
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      setFeedback(`Failed to remove: ${err?.message || "error"}`);
    }
    setTimeout(() => setFeedback(null), 2500);
  };

  // Delete custom indicator permanently from panel, chart, and database
  const handleDeleteCustom = async (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to permanently delete custom script "${name}"?`)) return;

    // 1. Remove from local pine library and scrub from all symbols
    forgetPineIndicatorEverywhere(name);
    setCustomScripts(loadPineLibrary());

    // 2. Remove from favorites if favorited
    setFavs((prev) => {
      const next = prev.filter((id) => id !== name && !id.includes(name));
      saveIndicatorFavorites(next);
      return next;
    });

    // 3. Remove from live chart across all workspace cells
    try {
      if (ws) {
        for (const cell of ws.cells()) {
          const handles = cell.chart?.indicators?.() || [];
          for (const h of handles) {
            if (h.title === name || (h as any).name === name) {
              try {
                if (typeof h.remove === "function") h.remove();
                else (cell.chart as any)?.removeIndicator?.(h);
              } catch {}
            }
          }
        }
        syncCustomLibrary(ws);
      }
    } catch (err) {
      console.warn("[trade-pro] error removing indicator from chart:", err);
    }

    // 4. Instantly push changes to Supabase Cloud Database
    try {
      await pushToCloud();
      setFeedback(`Permanently deleted "${name}" from panel & database`);
    } catch {
      scheduleCloudPush(0);
      setFeedback(`Deleted "${name}"`);
    }

    setRefreshKey((k) => k + 1);
    setTimeout(() => setFeedback(null), 3000);
  };

  // Add indicator to the chart
  const handleAdd = useCallback(
    async (item: CatalogIndicator) => {
      if (!ws) return;
      const chart = getSafeActiveChart(ws);
      if (!chart) {
        setFeedback("No active chart ready.");
        setTimeout(() => setFeedback(null), 2500);
        return;
      }
      const sym = chart.market?.symbol;

      try {
        setFeedback(`Adding "${item.name}"…`);

        if (item.isCustom && item.pineScript) {
          // Custom Pine Script
          const handle = await runPineIndicator(chart, item.pineScript, item.name);
          if (handle?.id) {
            rememberPineIndicator(sym, item.pineScript, item.name, handle.id);
          }
          setFeedback(`Added "${item.name}"`);
          setRefreshKey((k) => k + 1);
        } else if (item.luxSlug) {
          // LuxAlgo Library Indicator
          const res = await getIndicatorSource(item.luxSlug);
          if (res?.source) {
            const handle = await runPineIndicator(chart, res.source, item.name);
            if (handle?.id) {
              rememberLuxIndicator(sym, item.luxSlug, handle.id);
            }
            setFeedback(`Added "${item.name}"`);
            setRefreshKey((k) => k + 1);
          }
        } else if (item.nativeType) {
          // Native studies use Vela's native API. Passing a type such as "rsi"
          // to addIndicator() treats it as Pine source and causes missing-name
          // errors in the Pine runtime.
          const available = await chart.availableNativeIndicators();
          const native = available.find((entry: any) => entry.type === item.nativeType);
          if (!native) {
            throw new Error(`“${item.name}” is not registered as a native chart indicator.`);
          }
          if (!native.supported) {
            throw new Error(`“${item.name}” is not available for this symbol or data provider.`);
          }
          chart.addNativeIndicator(item.nativeType, item.nativeInputs ? { inputs: item.nativeInputs } : undefined);
          setFeedback(`Added "${item.name}"`);
          setRefreshKey((k) => k + 1);
        }
      } catch (err: any) {
        setFeedback(`Failed to add: ${err?.message || "Unknown error"}`);
      }

      setTimeout(() => setFeedback(null), 2500);
    },
    [ws]
  );

  // Compute all indicators including dynamically loaded custom scripts
  const allIndicators = useMemo<CatalogIndicator[]>(() => {
    const custom: CatalogIndicator[] = customScripts.map((s, idx) => ({
      id: `custom_${idx}_${s.name.replace(/\s+/g, "_")}`,
      name: s.name,
      category: "my_scripts",
      badge: "Custom",
      pineScript: s.script,
      isCustom: true,
      description: "User-created custom Pine Script indicator.",
    }));

    return [...custom, ...CATALOG_INDICATORS];
  }, [customScripts]);

  // Filtered indicators based on category and search query
  const displayedIndicators = useMemo(() => {
    const q = query.trim().toLowerCase();

    if (q) {
      return allIndicators.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.badge?.toLowerCase().includes(q) ||
          i.author?.toLowerCase().includes(q) ||
          i.description?.toLowerCase().includes(q)
      );
    }

    if (activeCategory === "favorites") {
      return allIndicators.filter((i) => favs.includes(i.id) || favs.includes(i.name));
    }

    if (activeCategory === "my_scripts") {
      return allIndicators.filter((i) => i.isCustom || i.category === "my_scripts");
    }

    if (activeCategory === "all_scripts") {
      return allIndicators;
    }

    if (activeCategory === "order_flow") {
      return allIndicators.filter(
        (i) =>
          i.category === "order_flow" ||
          i.family === "order_flow" ||
          i.families?.includes("volume-orderflow") ||
          i.families?.includes("order_flow")
      );
    }

    if (activeCategory === "concepts") {
      return allIndicators.filter(
        (i) =>
          i.category === "concepts" ||
          i.badge === "Concepts" ||
          i.families?.some((f) =>
            ["market-structure", "smc-ict", "wyckoff", "elliott-harmonics", "patterns"].includes(f)
          )
      );
    }

    if (activeCategory === "discover") {
      return allIndicators.filter(
        (i) =>
          i.category === "discover" ||
          i.badge === "Top rated" ||
          i.badge === "Trending" ||
          i.badge === "Featured" ||
          i.author === "LuxAlgo"
      );
    }

    // Check all 17 families
    const familyIds = [
      "trend",
      "momentum",
      "volatility",
      "volume-orderflow",
      "market-structure",
      "smc-ict",
      "wyckoff",
      "elliott-harmonics",
      "patterns",
      "levels",
      "statistics",
      "machine-learning",
      "time-seasonality",
      "sentiment-breadth",
      "risk-exits",
      "meta-composition",
      "validation",
    ];

    if (familyIds.includes(activeCategory)) {
      return allIndicators.filter(
        (i) =>
          i.family === activeCategory ||
          i.families?.includes(activeCategory) ||
          i.category === activeCategory
      );
    }

    // Default "basic"
    return allIndicators.filter((i) => i.category === "basic");
  }, [allIndicators, activeCategory, query, favs]);

  // Sliced indicators for smooth virtual bottom chunking
  const visibleIndicators = useMemo(() => {
    return displayedIndicators.slice(0, limit);
  }, [displayedIndicators, limit]);

  // Scroll listener on the indicators list to load more from the bottom
  const handleListScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      if (target.scrollTop + target.clientHeight >= target.scrollHeight - 70) {
        setLimit((prev) => {
          if (prev < displayedIndicators.length) {
            return Math.min(prev + 48, displayedIndicators.length);
          }
          return prev;
        });
      }
    },
    [displayedIndicators.length]
  );

  // Dynamic counts for sidebar badges
  const counts = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {
      favorites: allIndicators.filter((i) => favs.includes(i.id) || favs.includes(i.name)).length,
      on_chart: appliedIndicators.length,
      my_scripts: customScripts.length,
      basic: 80,
      order_flow: 17,
      discover: 14,
      all_scripts: 817,
      concepts: 853,
      trend: 148,
      momentum: 105,
      volatility: 63,
      "volume-orderflow": 123,
      "market-structure": 89,
      "smc-ict": 92,
      wyckoff: 15,
      "elliott-harmonics": 23,
      patterns: 70,
      levels: 66,
      statistics: 63,
      "machine-learning": 30,
      "time-seasonality": 44,
      "sentiment-breadth": 25,
      "risk-exits": 20,
      "meta-composition": 34,
      validation: 3,
    };
    return map;
  }, [allIndicators, favs, appliedIndicators.length, customScripts.length]);

  if (!open) return null;

  const currentCategoryInfo = INDICATOR_CATEGORIES.find((c) => c.id === activeCategory);
  const isOnChartView = !query && activeCategory === "on_chart";
  const categoryTitle = query
    ? `Search Results (${displayedIndicators.length})`
    : currentCategoryInfo?.label || "Indicators";

  return (
    <div className="ind-modal-backdrop" onClick={onClose}>
      <div className="ind-modal" onClick={(e) => e.stopPropagation()}>
        {/* Top Header */}
        <div className="ind-header">
          <div className="ind-header-left">
            <span className="ind-header-title">Indicators</span>
          </div>

          <div className="ind-search-wrap">
            <svg className="ind-search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5L14 14" strokeLinecap="round" />
            </svg>
            <input
              ref={searchInputRef}
              className="ind-search-input"
              placeholder="Search indicators, concepts or aliases"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="ind-search-shortcut">/</span>
          </div>

          <button type="button" className="ind-close-btn" onClick={onClose} title="Close (Esc)">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M2.5 2.5L11.5 11.5M11.5 2.5L2.5 11.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Main Body */}
        <div className="ind-body">
          {/* Left Sidebar */}
          <div className="ind-sidebar">
            {["Yours", "Built-in", "Library", "Families"].map((grp) => {
              const cats = INDICATOR_CATEGORIES.filter((c) => c.group === grp);
              return (
                <div className="ind-cat-group" key={grp}>
                  <div className="ind-group-label">{grp}</div>
                  {cats.map((cat) => {
                    const isActive = !query && activeCategory === cat.id;
                    const catCount = counts[cat.id] ?? cat.count;

                    return (
                      <button
                        key={cat.id}
                        type="button"
                        className={"ind-cat-item" + (isActive ? " active" : "")}
                        onClick={() => {
                          setQuery("");
                          setActiveCategory(cat.id);
                        }}
                      >
                        <span className="ind-cat-left">
                          {cat.icon === "star" && (
                            <svg className="ind-cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                              <path d="M8 2.2l1.75 3.55 3.9.55-2.8 2.75.65 3.9L8 11.1l-3.5 1.85.65-3.9-2.8-2.75 3.9-.55z" strokeLinejoin="round" />
                            </svg>
                          )}
                          {cat.icon === "check-circle" && (
                            <svg className="ind-cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                              <circle cx="8" cy="8" r="6" />
                              <path d="M5.5 8l1.8 1.8 3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                          {cat.icon === "user" && (
                            <svg className="ind-cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                              <circle cx="8" cy="5" r="2.5" />
                              <path d="M2.5 14c.5-3 2.3-4.5 5.5-4.5s5 1.5 5.5 4.5" />
                            </svg>
                          )}
                          {cat.icon === "line-chart" && (
                            <svg className="ind-cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                              <path d="M2 13.5h12M3 10l3.5-4.5 3 3 4-5.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                          {cat.icon === "bar-chart" && (
                            <svg className="ind-cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                              <path d="M2 13.5h12M4 11V8m4 3V4m4 7V6" strokeLinecap="round" />
                            </svg>
                          )}
                          {cat.icon === "compass" && (
                            <svg className="ind-cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                              <circle cx="8" cy="8" r="6" />
                              <path d="M10.5 5.5l-2 5-3 1 2-5 3-1z" strokeLinejoin="round" />
                            </svg>
                          )}
                          {cat.icon === "grid" && (
                            <svg className="ind-cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                              <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
                              <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
                              <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
                              <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
                            </svg>
                          )}
                          {cat.icon === "layers" && (
                            <svg className="ind-cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                              <path d="M2 5l6-3 6 3-6 3-6-3zm0 3.5l6 3 6-3m-12 3.5l6 3 6-3" strokeLinejoin="round" strokeLinecap="round" />
                            </svg>
                          )}
                          {cat.icon === "activity" && (
                            <svg className="ind-cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                              <path d="M2 8h3l2.5-5 3 10 2-5h3.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                          {cat.icon === "waves" && (
                            <svg className="ind-cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                              <path d="M2 9c2-3 4-3 6 0s4 3 6 0M2 5c2-3 4-3 6 0s4 3 6 0" strokeLinecap="round" />
                            </svg>
                          )}
                          {cat.icon === "shield" && (
                            <svg className="ind-cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                              <path d="M8 2.5l5 2.5v4c0 3.5-3 5.5-5 6.5-2-1-5-3-5-6.5v-4l5-2.5z" strokeLinejoin="round" />
                            </svg>
                          )}
                          {cat.icon === "crosshair" && (
                            <svg className="ind-cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                              <circle cx="8" cy="8" r="5" />
                              <line x1="8" y1="1" x2="8" y2="4" strokeLinecap="round" />
                              <line x1="8" y1="12" x2="8" y2="15" strokeLinecap="round" />
                              <line x1="1" y1="8" x2="4" y2="8" strokeLinecap="round" />
                              <line x1="12" y1="8" x2="15" y2="8" strokeLinecap="round" />
                            </svg>
                          )}
                          {cat.icon === "trending-up" && (
                            <svg className="ind-cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                              <polyline points="2 12.5 6.5 8 9.5 11 14 5.5" strokeLinecap="round" strokeLinejoin="round" />
                              <polyline points="10.5 5.5 14 5.5 14 9" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                          {cat.icon === "triangle" && (
                            <svg className="ind-cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                              <polygon points="8 2.5 14 13.5 2 13.5" strokeLinejoin="round" />
                            </svg>
                          )}
                          {cat.icon === "shapes" && (
                            <svg className="ind-cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                              <polygon points="8 2.5 13.5 5.5 13.5 11.5 8 14.5 2.5 11.5 2.5 5.5" strokeLinejoin="round" />
                            </svg>
                          )}
                          {cat.icon === "sliders" && (
                            <svg className="ind-cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                              <line x1="2" y1="4" x2="14" y2="4" strokeLinecap="round" />
                              <line x1="2" y1="8" x2="14" y2="8" strokeLinecap="round" />
                              <line x1="2" y1="12" x2="14" y2="12" strokeLinecap="round" />
                              <circle cx="5" cy="4" r="1.5" fill="currentColor" />
                              <circle cx="11" cy="8" r="1.5" fill="currentColor" />
                              <circle cx="7" cy="12" r="1.5" fill="currentColor" />
                            </svg>
                          )}
                          {cat.icon === "pie-chart" && (
                            <svg className="ind-cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                              <circle cx="8" cy="8" r="6" />
                              <path d="M8 2a6 6 0 0 1 6 6H8z" fill="currentColor" opacity="0.3" />
                            </svg>
                          )}
                          {cat.icon === "cpu" && (
                            <svg className="ind-cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                              <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
                              <path d="M6 1.5v2M10 1.5v2M6 12.5v2M10 12.5v2M1.5 6h2M1.5 10h2M12.5 6h2M12.5 10h2" strokeLinecap="round" />
                            </svg>
                          )}
                          {cat.icon === "clock" && (
                            <svg className="ind-cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                              <circle cx="8" cy="8" r="6" />
                              <polyline points="8 4.5 8 8 10.5 9.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                          {cat.icon === "gauge" && (
                            <svg className="ind-cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                              <path d="M3 12a6 6 0 1 1 10 0" strokeLinecap="round" />
                              <line x1="8" y1="8" x2="10.5" y2="5.5" strokeLinecap="round" />
                            </svg>
                          )}
                          {cat.icon === "alert-triangle" && (
                            <svg className="ind-cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                              <polygon points="8 2.5 14 13.5 2 13.5" strokeLinejoin="round" />
                              <line x1="8" y1="6.5" x2="8" y2="9.5" strokeLinecap="round" />
                              <circle cx="8" cy="11.5" r="0.7" fill="currentColor" />
                            </svg>
                          )}
                          {cat.icon === "box" && (
                            <svg className="ind-cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                              <path d="M2.5 5.5L8 2.5l5.5 3v5L8 13.5l-5.5-3v-5z" strokeLinejoin="round" />
                              <path d="M8 2.5v11M2.5 5.5l11 5.5M13.5 5.5l-11 5.5" />
                            </svg>
                          )}
                          {cat.icon === "check-square" && (
                            <svg className="ind-cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                              <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
                              <path d="M5.5 8l2 2 3.5-4" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                          <span>{cat.label}</span>
                        </span>
                        {catCount !== undefined && <span className="ind-cat-count">{catCount}</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Right Main Content */}
          <div className="ind-content">
            <div className="ind-content-head">
              <span className="ind-content-title">
                {categoryTitle}
                <span className="ind-content-count">
                  {isOnChartView ? appliedIndicators.length : displayedIndicators.length}
                </span>
              </span>
              {feedback && <span style={{ color: "#26a69a", fontSize: "12px", fontWeight: 500 }}>{feedback}</span>}
            </div>

            {/* List with right-aligned outer scrollbar and bottom chunked loading */}
            <div className="ind-list" ref={listRef} onScroll={isOnChartView ? undefined : handleListScroll}>
              {isOnChartView ? (
                // --- ON CHART VIEW ---
                appliedIndicators.length === 0 ? (
                  <div className="ind-empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <circle cx="12" cy="12" r="9" />
                      <polyline points="9 12 11 14 15 10" />
                    </svg>
                    <div>No indicators currently applied to the chart.</div>
                    <div style={{ fontSize: "12px", color: "#60646e" }}>
                      Select any indicator from Built-in or Library to add it to your chart.
                    </div>
                  </div>
                ) : (
                  appliedIndicators.map((item) => (
                    <div key={item.id} className="ind-row">
                      <div className="ind-row-left">
                        <div className="ind-row-title-line">
                          <span className="ind-row-name" style={{ opacity: item.visible ? 1 : 0.45 }}>
                            {item.name}
                          </span>
                          <span className="ind-badge">{item.badge}</span>
                          <span className="ind-applied-pill">ON CHART</span>
                          {!item.visible && (
                            <span style={{ fontSize: "11px", color: "#787b86", fontStyle: "italic" }}>
                              (Hidden)
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="ind-row-actions">
                        {/* Eye Visibility Toggle Button */}
                        <button
                          type="button"
                          className={"ind-row-btn eye" + (!item.visible ? " off" : "")}
                          title={item.visible ? "Hide indicator" : "Show indicator"}
                          onClick={(e) => handleToggleVisibility(item, e)}
                        >
                          {item.visible ? (
                            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                              <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" />
                              <circle cx="8" cy="8" r="2" />
                            </svg>
                          ) : (
                            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                              <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" strokeDasharray="2 2" />
                              <line x1="2" y1="2" x2="14" y2="14" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          )}
                        </button>

                        {/* Remove from chart Button */}
                        <button
                          type="button"
                          className="ind-row-btn delete"
                          title={`Remove "${item.name}" from chart`}
                          onClick={(e) => handleRemoveFromChart(item, e)}
                        >
                          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M3 4.5h10M6.5 7v5M9.5 7v5M4.5 4.5v9a1 1 0 001 1h5a1 1 0 001-1v-9M6 4.5V3a1 1 0 011-1h2a1 1 0 011 1v1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))
                )
              ) : (
                // --- GENERAL INDICATORS VIEW ---
                displayedIndicators.length === 0 ? (
                  <div className="ind-empty-state">
                    {activeCategory === "favorites" ? (
                      <>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                        <div>Star an indicator to keep it here.</div>
                      </>
                    ) : activeCategory === "my_scripts" ? (
                      <>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                          <polyline points="10 9 9 9 8 9" />
                        </svg>
                        <div>No custom scripts yet.</div>
                        <div style={{ fontSize: "12px", color: "#60646e" }}>
                          Open the Pine Editor in topbar to write, compile, and save your own indicators.
                        </div>
                      </>
                    ) : (
                      <div>No indicators found matching "{query}".</div>
                    )}
                  </div>
                ) : (
                  <>
                    {visibleIndicators.map((ind) => {
                      const isFav = favs.includes(ind.id) || favs.includes(ind.name);
                      const isOnChart = onChartNames.has(ind.name.toLowerCase());

                      return (
                        <div
                          key={ind.id}
                          className="ind-row"
                          onClick={() => handleAdd(ind)}
                          title={`Click to add "${ind.name}" to chart`}
                        >
                          <div className="ind-row-left">
                            <div className="ind-row-title-line">
                              <span className="ind-row-name">{ind.name}</span>
                              {ind.badge && (
                                <span
                                  className={
                                    "ind-badge" +
                                    (ind.isCustom ? " custom" : ind.author === "LuxAlgo" ? " lux" : "")
                                  }
                                >
                                  {ind.badge}
                                </span>
                              )}
                              {isOnChart && <span className="ind-applied-pill">ON CHART</span>}
                            </div>
                            {ind.description && <span className="ind-row-desc">{ind.description}</span>}
                          </div>

                          <div className="ind-row-actions">
                            {/* DELETE BUTTON: ONLY for user's custom scripts ('My scripts') */}
                            {ind.isCustom && (
                              <button
                                type="button"
                                className="ind-row-btn delete"
                                title={`Delete custom script "${ind.name}"`}
                                onClick={(e) => handleDeleteCustom(ind.name, e)}
                              >
                                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                                  <path d="M3 4.5h10M6.5 7v5M9.5 7v5M4.5 4.5v9a1 1 0 001 1h5a1 1 0 001-1v-9M6 4.5V3a1 1 0 011-1h2a1 1 0 011 1v1.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
                            )}

                            {/* Star / Favorite Button */}
                            <button
                              type="button"
                              className={"ind-row-btn star" + (isFav ? " on" : "")}
                              title={isFav ? "Remove from favorites" : "Add to favorites"}
                              onClick={(e) => handleToggleFavorite(ind.id, e)}
                            >
                              <svg width="15" height="15" viewBox="0 0 16 16" fill={isFav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3">
                                <path d="M8 2.2l1.75 3.55 3.9.55-2.8 2.75.65 3.9L8 11.1l-3.5 1.85.65-3.9-2.8-2.75 3.9-.55z" strokeLinejoin="round" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {/* Bottom Load More Sentinel Button */}
                    {visibleIndicators.length < displayedIndicators.length && (
                      <div className="ind-load-more-bottom">
                        <button
                          type="button"
                          className="ind-show-more-btn"
                          onClick={() =>
                            setLimit((prev) => Math.min(prev + 48, displayedIndicators.length))
                          }
                        >
                          Show more · {visibleIndicators.length} of {displayedIndicators.length}
                        </button>
                      </div>
                    )}
                  </>
                )
              )}
            </div>
          </div>
        </div>

        {/* Bottom Footer */}
        <div className="ind-footer">
          <div className="ind-footer-shortcuts">
            <span className="ind-shortcut-item">
              <kbd className="ind-key-badge">↑</kbd> <kbd className="ind-key-badge">↓</kbd> Browse
            </span>
            <span className="ind-shortcut-item">
              <kbd className="ind-key-badge">↵</kbd> Add
            </span>
            <span className="ind-shortcut-item">
              <kbd className="ind-key-badge">⇧</kbd> <kbd className="ind-key-badge">↵</kbd> Add, keep open
            </span>
            <span className="ind-shortcut-item">
              <kbd className="ind-key-badge">F</kbd> Favorite
            </span>
            <span className="ind-shortcut-item">
              <kbd className="ind-key-badge">Esc</kbd> Close
            </span>
          </div>

          <div className="ind-footer-meta">817 scripts · newest Oct 9, 2026</div>
        </div>
      </div>
    </div>
  );
}
