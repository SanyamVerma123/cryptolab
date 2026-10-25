/**
 * JournalDashboard.tsx — LuxAlgo Trade Journal & Performance Analytics
 *
 * Implements full parity with LuxAlgo/trade-journal:
 * 1. KPI Metric Cards:
 *    - Net P&L, Win Rate %, Profit Factor, Total Trades, Avg Win / Avg Loss, Expectancy
 * 2. Calendar P&L Heatmap:
 *    - Month grid (Sun–Sat + Week totals), magnitude-based color tinting, day click-filter
 * 3. Interactive Visual Charts:
 *    - Cumulative Equity Area Curve & Daily PnL Bar Chart
 * 4. Trade Explorer & Log Table:
 *    - Searchable, filterable by Symbol, Side, Date, Strategy, and Source
 * 5. Full Page Expansion & Bottom Docked Mode:
 *    - mode="docked" fits in the bottom drawer with instant "⛶ Full Page" button
 *    - mode="full" provides full-screen immersive trading analytics
 */

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  JournalEntry,
  getJournalEntries,
  saveJournalEntries,
  addJournalEntry,
  deleteJournalEntry,
  calculateJournalStats,
  exportJournalCsv,
} from "../lib/journalState";

interface Props {
  mode?: "docked" | "full";
  onClose?: () => void;
  onExpandFull?: () => void;
}

export function JournalDashboard({ mode = "docked", onClose, onExpandFull }: Props) {
  const [entries, setEntries] = useState<JournalEntry[]>(() => getJournalEntries());
  const [privacy, setPrivacy] = useState(false);
  const [search, setSearch] = useState("");
  const [sideFilter, setSideFilter] = useState<"ALL" | "LONG" | "SHORT">("ALL");
  const [sourceFilter, setSourceFilter] = useState<"ALL" | "paper" | "replay" | "manual">("ALL");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [chartTab, setChartTab] = useState<"equity" | "daily" | "breakdown">("equity");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Month navigation for Calendar (defaults to current month)
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  // "+ Add Trade" Form State
  const [fSymbol, setFSymbol] = useState("BTCUSDT");
  const [fSide, setFSide] = useState<"LONG" | "SHORT">("LONG");
  const [fEntry, setFEntry] = useState("79200");
  const [fExit, setFExit] = useState("80500");
  const [fAmount, setFAmount] = useState("0.5");
  const [fStrategy, setFStrategy] = useState("Breakout Retest");
  const [fTags, setFTags] = useState("SMC, 15m");
  const [fNotes, setFNotes] = useState("");
  const [fMae, setFMae] = useState("");
  const [fMfe, setFMfe] = useState("");

  const refresh = () => setEntries(getJournalEntries());

  useEffect(() => {
    window.addEventListener("tradepro:journal-updated", refresh);
    return () => window.removeEventListener("tradepro:journal-updated", refresh);
  }, []);

  // Keyboard shortcut to close full modal
  useEffect(() => {
    if (mode !== "full") return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, onClose]);

  // Aggregate statistics
  const stats = useMemo(() => calculateJournalStats(entries), [entries]);

  // Mathematical Expectancy
  const expectancy = useMemo(() => {
    if (stats.totalTrades === 0) return 0;
    const wr = stats.winRate / 100;
    const lossRate = 1 - wr;
    const exp = wr * stats.avgWin - lossRate * Math.abs(stats.avgLoss);
    return Math.round(exp * 100) / 100;
  }, [stats]);

  // Filtered entries for table and preview
  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (sideFilter !== "ALL" && e.side !== sideFilter) return false;
      if (sourceFilter !== "ALL" && (e.source || "manual") !== sourceFilter) return false;
      if (selectedDate) {
        const d = new Date(e.date).toISOString().slice(0, 10);
        if (d !== selectedDate) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesSym = e.symbol.toLowerCase().includes(q);
        const matchesStrat = (e.strategy || "").toLowerCase().includes(q);
        const matchesTags = (e.tags || []).some((t) => t.toLowerCase().includes(q));
        const matchesNotes = (e.notes || "").toLowerCase().includes(q);
        if (!matchesSym && !matchesStrat && !matchesTags && !matchesNotes) return false;
      }
      return true;
    });
  }, [entries, sideFilter, sourceFilter, selectedDate, search]);

  // Helper formatting for privacy
  const fmtMoney = (val: number) => {
    if (privacy) return "$***.**";
    const sign = val > 0 ? "+" : val < 0 ? "-" : "";
    return `${sign}$${Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const fmtPercent = (val: number) => {
    if (privacy) return "***%";
    const sign = val > 0 ? "+" : val < 0 ? "-" : "";
    return `${sign}${Math.abs(val).toFixed(2)}%`;
  };

  // Calendar calculations
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const monthName = calendarMonth.toLocaleString("en-US", { month: "long", year: "numeric" });

  const calendarDays = useMemo(() => {
    const firstDayIndex = new Date(year, month, 1).getDay(); // 0 is Sunday
    const totalDaysInMonth = new Date(year, month + 1, 0).getDate();

    // Group entries by YYYY-MM-DD
    const pnlByDay: Record<string, { netPnl: number; count: number; wins: number }> = {};
    for (const e of entries) {
      const dKey = new Date(e.date).toISOString().slice(0, 10);
      if (!pnlByDay[dKey]) {
        pnlByDay[dKey] = { netPnl: 0, count: 0, wins: 0 };
      }
      pnlByDay[dKey].netPnl += e.pnl ?? 0;
      pnlByDay[dKey].count += 1;
      if ((e.pnl ?? 0) >= 0) pnlByDay[dKey].wins += 1;
    }

    const maxAbsPnl = Math.max(
      1,
      ...Object.values(pnlByDay).map((v) => Math.abs(v.netPnl))
    );

    // Build weeks
    const weeks: Array<Array<{
      dateStr: string | null;
      dayNumber: number | null;
      netPnl: number;
      count: number;
      intensity: number;
    }>> = [];

    let currentWeek: Array<{
      dateStr: string | null;
      dayNumber: number | null;
      netPnl: number;
      count: number;
      intensity: number;
    }> = [];

    // Pre-pad first week
    for (let i = 0; i < firstDayIndex; i++) {
      currentWeek.push({ dateStr: null, dayNumber: null, netPnl: 0, count: 0, intensity: 0 });
    }

    let monthTradingDays = 0;
    let monthWinningDays = 0;
    let monthNetPnl = 0;

    for (let day = 1; day <= totalDaysInMonth; day++) {
      const dayStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dayData = pnlByDay[dayStr];
      const netPnl = dayData ? dayData.netPnl : 0;
      const count = dayData ? dayData.count : 0;
      const intensity = count > 0 ? Math.min(1, Math.max(0.2, Math.abs(netPnl) / maxAbsPnl)) : 0;

      if (count > 0) {
        monthTradingDays += 1;
        if (netPnl >= 0) monthWinningDays += 1;
        monthNetPnl += netPnl;
      }

      currentWeek.push({
        dateStr: dayStr,
        dayNumber: day,
        netPnl,
        count,
        intensity,
      });

      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    }

    // Post-pad last week
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) {
        currentWeek.push({ dateStr: null, dayNumber: null, netPnl: 0, count: 0, intensity: 0 });
      }
      weeks.push(currentWeek);
    }

    return { weeks, monthTradingDays, monthWinningDays, monthNetPnl };
  }, [entries, year, month]);

  // Equity Curve Data (Sorted Chronologically)
  const equityData = useMemo(() => {
    const sorted = [...entries].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    let cum = 0;
    return sorted.map((e, idx) => {
      cum += e.pnl ?? 0;
      return {
        tradeIndex: idx + 1,
        pnl: e.pnl ?? 0,
        cumPnl: cum,
        symbol: e.symbol,
        date: new Date(e.date).toLocaleDateString(),
      };
    });
  }, [entries]);

  // Daily PnL Bars Data
  const dailyData = useMemo(() => {
    const grouped: Record<string, number> = {};
    for (const e of entries) {
      const d = new Date(e.date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      grouped[d] = (grouped[d] ?? 0) + (e.pnl ?? 0);
    }
    return Object.entries(grouped).map(([date, pnl]) => ({ date, pnl }));
  }, [entries]);

  // Handle Add Trade
  const handleSaveTrade = (ev: React.FormEvent) => {
    ev.preventDefault();
    const entryP = parseFloat(fEntry) || 0;
    const exitP = parseFloat(fExit) || 0;
    const amt = parseFloat(fAmount) || 0;
    if (entryP <= 0 || exitP <= 0 || amt <= 0) return;

    const diff = fSide === "LONG" ? exitP - entryP : entryP - exitP;
    const pnl = diff * amt;
    const pnlPercent = (diff / entryP) * 100;

    addJournalEntry({
      symbol: fSymbol.toUpperCase(),
      side: fSide,
      entryPrice: entryP,
      exitPrice: exitP,
      amount: amt,
      pnl: Math.round(pnl * 100) / 100,
      pnlPercent: Math.round(pnlPercent * 100) / 100,
      strategy: fStrategy,
      tags: fTags ? fTags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      notes: fNotes,
      mae: fMae ? parseFloat(fMae) : undefined,
      mfe: fMfe ? parseFloat(fMfe) : undefined,
      source: "manual",
    });

    setAddModalOpen(false);
    setFNotes("");
  };

  // CSV Import
  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        if (!text) return;
        const lines = text.split("\n").filter((l) => l.trim().length > 0);
        if (lines.length < 2) return;

        const imported: JournalEntry[] = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(",").map((c) => c.replace(/^"|"$/g, "").trim());
          if (cols.length >= 7) {
            const side = cols[2]?.toUpperCase() === "SHORT" ? "SHORT" : "LONG";
            const entryPrice = parseFloat(cols[3]) || 0;
            const exitPrice = parseFloat(cols[4]) || 0;
            const amount = parseFloat(cols[5]) || 0;
            const pnl = parseFloat(cols[6]) || 0;
            const pnlPercent = parseFloat(cols[7]) || 0;

            if (entryPrice > 0 && amount > 0) {
              imported.push({
                id: `j_imp_${Date.now()}_${i}`,
                date: cols[0] || new Date().toISOString(),
                timestamp: new Date(cols[0] || Date.now()).getTime(),
                symbol: cols[1] || "BTCUSDT",
                side,
                entryPrice,
                exitPrice,
                amount,
                pnl,
                pnlPercent,
                duration: cols[8] || "",
                strategy: cols[9] || "",
                tags: cols[10] ? cols[10].split(";").map((t) => t.trim()) : [],
                notes: cols[11] || "",
                source: "manual",
              });
            }
          }
        }

        if (imported.length > 0) {
          saveJournalEntries([...imported, ...entries]);
        }
      } catch (err) {
        console.warn("[journal] CSV import error:", err);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className={`tradepro-journal-dashboard ${mode === "full" ? "is-full-page" : "is-docked"}`}>
      {/* HEADER BAR */}
      <div className="jd-header">
        <div className="jd-title-group">
          <span className="jd-title-icon">📊</span>
          <div>
            <h2 className="jd-title-text">Trading Journal & Analytics</h2>
            {mode === "full" && (
              <p className="jd-subtitle">Performance tracking • P&L Calendar • Trade Explorer</p>
            )}
          </div>
          <span className="jd-badge-count">{entries.length} Trades</span>
        </div>

        <div className="jd-header-actions">
          {/* Privacy Toggle */}
          <button
            type="button"
            className={`jd-btn jd-btn-secondary ${privacy ? "active" : ""}`}
            onClick={() => setPrivacy((p) => !p)}
            title={privacy ? "Show Financial Numbers" : "Hide Financial Numbers (Privacy Mode)"}
          >
            {privacy ? "🔒 Masked" : "👁 Public"}
          </button>

          {/* Quick Add Trade */}
          <button
            type="button"
            className="jd-btn jd-btn-primary"
            onClick={() => setAddModalOpen(true)}
          >
            + Add Trade
          </button>

          {/* CSV Import / Export */}
          <button
            type="button"
            className="jd-btn jd-btn-secondary"
            onClick={exportJournalCsv}
            title="Export trades as CSV"
          >
            Export CSV
          </button>

          <input
            type="file"
            ref={fileInputRef}
            style={{ display: "none" }}
            accept=".csv"
            onChange={handleCsvImport}
          />
          <button
            type="button"
            className="jd-btn jd-btn-secondary"
            onClick={() => fileInputRef.current?.click()}
            title="Import trades from CSV"
          >
            Import CSV
          </button>

          {/* Full Page Toggle / Close */}
          {mode === "docked" ? (
            <button
              type="button"
              className="jd-btn jd-btn-expand"
              onClick={onExpandFull}
              title="Expand to Full Page Dashboard"
            >
              ⛶ Open Full Page Dashboard
            </button>
          ) : (
            <button
              type="button"
              className="jd-btn jd-btn-icon jd-close-btn"
              onClick={onClose}
              title="Close Full Page Dashboard (Esc)"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* TOP KPI METRICS BAR */}
      <div className="jd-kpi-grid">
        {/* 1. Net PnL */}
        <div className="jd-kpi-card">
          <div className="jd-kpi-header">
            <span className="jd-kpi-label">Net P&L</span>
            <span className={`jd-kpi-indicator ${stats.totalPnl >= 0 ? "up" : "down"}`} />
          </div>
          <div className={`jd-kpi-val ${stats.totalPnl >= 0 ? "up" : "down"}`}>
            {fmtMoney(stats.totalPnl)}
          </div>
          <div className="jd-kpi-sub">
            Gross Profit: <span className="up">{fmtMoney(stats.grossProfit)}</span> • Gross Loss:{" "}
            <span className="down">{fmtMoney(stats.grossLoss)}</span>
          </div>
        </div>

        {/* 2. Win Rate */}
        <div className="jd-kpi-card">
          <div className="jd-kpi-header">
            <span className="jd-kpi-label">Win Rate</span>
            <span className="jd-kpi-badge">{stats.winningTrades}W / {stats.losingTrades}L</span>
          </div>
          <div className="jd-kpi-val">{privacy ? "**%" : `${stats.winRate}%`}</div>
          <div className="jd-kpi-bar-wrap">
            <div
              className="jd-kpi-bar-fill"
              style={{ width: `${stats.winRate}%` }}
            />
          </div>
        </div>

        {/* 3. Profit Factor */}
        <div className="jd-kpi-card">
          <div className="jd-kpi-header">
            <span className="jd-kpi-label">Profit Factor</span>
            <span className="jd-kpi-tag">Risk / Reward</span>
          </div>
          <div className="jd-kpi-val">{privacy ? "*.*" : stats.profitFactor}</div>
          <div className="jd-kpi-sub">
            Long Win Rate: <b>{privacy ? "**%" : `${stats.longWinRate}%`}</b> • Short Win Rate:{" "}
            <b>{privacy ? "**%" : `${stats.shortWinRate}%`}</b>
          </div>
        </div>

        {/* 4. Total Trades */}
        <div className="jd-kpi-card">
          <div className="jd-kpi-header">
            <span className="jd-kpi-label">Total Trades</span>
            <span className="jd-kpi-tag">Sample</span>
          </div>
          <div className="jd-kpi-val">{stats.totalTrades}</div>
          <div className="jd-kpi-sub">
            Average Trade: <span className={stats.avgTrade >= 0 ? "up" : "down"}>{fmtMoney(stats.avgTrade)}</span>
          </div>
        </div>

        {/* 5. Avg Win / Avg Loss (Full Mode) */}
        {mode === "full" && (
          <div className="jd-kpi-card">
            <div className="jd-kpi-header">
              <span className="jd-kpi-label">Avg Win / Avg Loss</span>
              <span className="jd-kpi-tag">Payoff</span>
            </div>
            <div className="jd-kpi-val">
              <span className="up">{fmtMoney(stats.avgWin)}</span> /{" "}
              <span className="down">{fmtMoney(stats.avgLoss)}</span>
            </div>
            <div className="jd-kpi-sub">
              Best Trade: <span className="up">{fmtMoney(stats.bestTrade)}</span> • Worst Trade:{" "}
              <span className="down">{fmtMoney(stats.worstTrade)}</span>
            </div>
          </div>
        )}

        {/* 6. Expectancy (Full Mode) */}
        {mode === "full" && (
          <div className="jd-kpi-card">
            <div className="jd-kpi-header">
              <span className="jd-kpi-label">Expectancy / Trade</span>
              <span className="jd-kpi-tag">Edge</span>
            </div>
            <div className={`jd-kpi-val ${expectancy >= 0 ? "up" : "down"}`}>
              {fmtMoney(expectancy)}
            </div>
            <div className="jd-kpi-sub">
              Mathematical expectancy per executed trade
            </div>
          </div>
        )}
      </div>

      {/* MAIN BODY: CALENDAR + CHARTS */}
      <div className="jd-middle-section">
        {/* CALENDAR P&L HEATMAP */}
        <div className="jd-calendar-card">
          <div className="jd-card-header">
            <div className="jd-cal-nav">
              <button
                type="button"
                className="jd-btn-icon"
                onClick={() => setCalendarMonth(new Date(year, month - 1, 1))}
                title="Previous Month"
              >
                ◀
              </button>
              <span className="jd-cal-month-title">{monthName}</span>
              <button
                type="button"
                className="jd-btn-icon"
                onClick={() => setCalendarMonth(new Date(year, month + 1, 1))}
                title="Next Month"
              >
                ▶
              </button>
            </div>
            {selectedDate && (
              <button
                type="button"
                className="jd-btn jd-btn-secondary jd-btn-sm"
                onClick={() => setSelectedDate(null)}
              >
                Clear Day Filter ({selectedDate})
              </button>
            )}
          </div>

          <div className="jd-cal-grid">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Week"].map((d) => (
              <div key={d} className="jd-cal-weekday">
                {d}
              </div>
            ))}

            {calendarDays.weeks.map((week, wIdx) => {
              const weekNet = week.reduce((acc, curr) => acc + curr.netPnl, 0);
              return (
                <React.Fragment key={wIdx}>
                  {week.map((day, dIdx) => {
                    if (!day.dayNumber) {
                      return <div key={`empty-${wIdx}-${dIdx}`} className="jd-cal-cell empty" />;
                    }
                    const isSelected = selectedDate === day.dateStr;
                    const isWin = day.netPnl >= 0;
                    const hasTrades = day.count > 0;

                    let bgStyle = undefined;
                    if (hasTrades) {
                      const color = isWin ? "8, 153, 129" : "242, 54, 69";
                      const alpha = 0.12 + day.intensity * 0.35;
                      bgStyle = { backgroundColor: `rgba(${color}, ${alpha})` };
                    }

                    return (
                      <div
                        key={`day-${day.dateStr}`}
                        className={`jd-cal-cell ${hasTrades ? "has-trades" : ""} ${isSelected ? "selected" : ""}`}
                        style={bgStyle}
                        onClick={() => {
                          if (!hasTrades) return;
                          setSelectedDate(isSelected ? null : day.dateStr);
                        }}
                        title={
                          hasTrades
                            ? `${day.dateStr}: ${day.count} trades | Net: ${fmtMoney(day.netPnl)}`
                            : undefined
                        }
                      >
                        <div className="jd-cal-day-num">{day.dayNumber}</div>
                        {hasTrades && (
                          <div className="jd-cal-day-data">
                            <span className={`jd-cal-day-pnl ${isWin ? "up" : "down"}`}>
                              {fmtMoney(day.netPnl)}
                            </span>
                            <span className="jd-cal-day-count">{day.count}t</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {/* Weekly Total Column */}
                  <div
                    className={`jd-cal-cell week-summary ${weekNet > 0 ? "up" : weekNet < 0 ? "down" : ""}`}
                  >
                    <span className="jd-cal-week-label">Total</span>
                    <span className="jd-cal-week-val">{fmtMoney(weekNet)}</span>
                  </div>
                </React.Fragment>
              );
            })}
          </div>

          <div className="jd-cal-footer">
            <span>
              {calendarDays.monthTradingDays} Trading Days (
              <span className="up">{calendarDays.monthWinningDays} Green</span>)
            </span>
            <span>
              Month Total:{" "}
              <b className={calendarDays.monthNetPnl >= 0 ? "up" : "down"}>
                {fmtMoney(calendarDays.monthNetPnl)}
              </b>
            </span>
          </div>
        </div>

        {/* CHARTS CARD */}
        <div className="jd-chart-card">
          <div className="jd-card-header">
            <div className="jd-chart-tabs">
              <button
                type="button"
                className={`jd-chart-tab ${chartTab === "equity" ? "active" : ""}`}
                onClick={() => setChartTab("equity")}
              >
                Equity Curve
              </button>
              <button
                type="button"
                className={`jd-chart-tab ${chartTab === "daily" ? "active" : ""}`}
                onClick={() => setChartTab("daily")}
              >
                Daily P&L
              </button>
              <button
                type="button"
                className={`jd-chart-tab ${chartTab === "breakdown" ? "active" : ""}`}
                onClick={() => setChartTab("breakdown")}
              >
                Performance
              </button>
            </div>
          </div>

          <div className="jd-chart-content">
            {chartTab === "equity" ? (
              <div className="jd-svg-chart-wrap">
                {equityData.length < 2 ? (
                  <div className="jd-empty-hint">Add more trades to visualize cumulative equity curve.</div>
                ) : (
                  <svg className="jd-svg-chart" viewBox="0 0 500 200" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2962ff" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#2962ff" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>
                    {(() => {
                      const minPnl = Math.min(0, ...equityData.map((d) => d.cumPnl));
                      const maxPnl = Math.max(10, ...equityData.map((d) => d.cumPnl));
                      const range = maxPnl - minPnl || 1;
                      const zeroY = 180 - ((0 - minPnl) / range) * 160;

                      const points = equityData.map((d, i) => {
                        const x = 20 + (i / (equityData.length - 1)) * 460;
                        const y = 180 - ((d.cumPnl - minPnl) / range) * 160;
                        return `${x},${y}`;
                      });

                      const pathD = `M ${points[0]} L ${points.join(" L ")}`;
                      const areaD = `${pathD} L 480,${zeroY} L 20,${zeroY} Z`;

                      return (
                        <>
                          <line x1="20" y1={zeroY} x2="480" y2={zeroY} stroke="#363c4e" strokeDasharray="3 3" />
                          <path d={areaD} fill="url(#equityGrad)" />
                          <path d={pathD} fill="none" stroke="#2962ff" strokeWidth="2.5" />
                          {equityData.map((d, i) => {
                            const x = 20 + (i / (equityData.length - 1)) * 460;
                            const y = 180 - ((d.cumPnl - minPnl) / range) * 160;
                            return (
                              <circle
                                key={i}
                                cx={x}
                                cy={y}
                                r="4"
                                fill={d.pnl >= 0 ? "#089981" : "#f23645"}
                                stroke="#1e222d"
                                strokeWidth="1.5"
                              >
                                <title>{`Trade #${d.tradeIndex} (${d.symbol}): ${fmtMoney(d.pnl)} | Cum: ${fmtMoney(d.cumPnl)}`}</title>
                              </circle>
                            );
                          })}
                        </>
                      );
                    })()}
                  </svg>
                )}
              </div>
            ) : chartTab === "daily" ? (
              <div className="jd-svg-chart-wrap">
                {dailyData.length === 0 ? (
                  <div className="jd-empty-hint">No trades recorded yet.</div>
                ) : (
                  <svg className="jd-svg-chart" viewBox="0 0 500 200" preserveAspectRatio="none">
                    {(() => {
                      const maxAbs = Math.max(1, ...dailyData.map((d) => Math.abs(d.pnl)));
                      const zeroY = 100;
                      const barW = Math.max(12, Math.min(36, 420 / dailyData.length - 8));

                      return (
                        <>
                          <line x1="10" y1={zeroY} x2="490" y2={zeroY} stroke="#363c4e" />
                          {dailyData.map((d, i) => {
                            const x = 30 + (i / dailyData.length) * 440;
                            const height = (Math.abs(d.pnl) / maxAbs) * 85;
                            const y = d.pnl >= 0 ? zeroY - height : zeroY;
                            const fill = d.pnl >= 0 ? "#089981" : "#f23645";

                            return (
                              <g key={i}>
                                <rect
                                  x={x}
                                  y={y}
                                  width={barW}
                                  height={Math.max(2, height)}
                                  fill={fill}
                                  rx="2"
                                >
                                  <title>{`${d.date}: ${fmtMoney(d.pnl)}`}</title>
                                </rect>
                                <text
                                  x={x + barW / 2}
                                  y={192}
                                  fontSize="9"
                                  fill="#787b86"
                                  textAnchor="middle"
                                >
                                  {d.date}
                                </text>
                              </g>
                            );
                          })}
                        </>
                      );
                    })()}
                  </svg>
                )}
              </div>
            ) : (
              <div className="jd-breakdown-list">
                <div className="jd-breakdown-row">
                  <span>Long Trades</span>
                  <b>{stats.longWinRate}% Win Rate</b>
                </div>
                <div className="jd-breakdown-row">
                  <span>Short Trades</span>
                  <b>{stats.shortWinRate}% Win Rate</b>
                </div>
                <div className="jd-breakdown-row">
                  <span>Profit Factor</span>
                  <b>{stats.profitFactor}</b>
                </div>
                <div className="jd-breakdown-row">
                  <span>Avg Win / Avg Loss Ratio</span>
                  <b>
                    {stats.avgLoss !== 0
                      ? (Math.abs(stats.avgWin / stats.avgLoss)).toFixed(2)
                      : "N/A"}
                  </b>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* TRADE EXPLORER / TABLE */}
      <div className="jd-table-card">
        <div className="jd-card-header jd-table-controls">
          <div className="jd-filter-group">
            <input
              type="text"
              className="jd-search-input"
              placeholder="Search symbol, notes, strategy, tags..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="jd-pill-group">
              {(["ALL", "LONG", "SHORT"] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  className={`jd-pill ${sideFilter === side ? "active" : ""}`}
                  onClick={() => setSideFilter(side)}
                >
                  {side}
                </button>
              ))}
            </div>
            <div className="jd-pill-group">
              {(["ALL", "paper", "replay", "manual"] as const).map((src) => (
                <button
                  key={src}
                  type="button"
                  className={`jd-pill ${sourceFilter === src ? "active" : ""}`}
                  onClick={() => setSourceFilter(src)}
                >
                  {src.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          {selectedDate && (
            <span className="jd-active-filter-badge">
              Date: <b>{selectedDate}</b>
              <button type="button" onClick={() => setSelectedDate(null)}>
                ✕
              </button>
            </span>
          )}
        </div>

        <div className="jd-table-wrap">
          <table className="jd-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Symbol</th>
                <th>Side</th>
                <th>Entry Price</th>
                <th>Exit Price</th>
                <th>Qty</th>
                <th>Net P&L</th>
                <th>PnL %</th>
                <th>Strategy</th>
                <th>MAE</th>
                <th>MFE</th>
                <th>Notes</th>
                <th style={{ width: 50 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={13} className="jd-empty-row">
                    No trades match the current filters.
                  </td>
                </tr>
              ) : (
                filteredEntries.map((e) => {
                  const isWin = (e.pnl ?? 0) >= 0;
                  return (
                    <tr key={e.id}>
                      <td>{new Date(e.date).toLocaleDateString()}</td>
                      <td>
                        <span className="jd-sym-badge">{e.symbol}</span>
                      </td>
                      <td>
                        <span className={`jd-side-badge ${e.side === "LONG" ? "long" : "short"}`}>
                          {e.side}
                        </span>
                      </td>
                      <td>${(e.entryPrice ?? 0).toLocaleString()}</td>
                      <td>${(e.exitPrice ?? 0).toLocaleString()}</td>
                      <td>{e.amount}</td>
                      <td className={isWin ? "up" : "down"}>
                        <b>{fmtMoney(e.pnl ?? 0)}</b>
                      </td>
                      <td className={isWin ? "up" : "down"}>{fmtPercent(e.pnlPercent ?? 0)}</td>
                      <td>{e.strategy || "—"}</td>
                      <td className="down">{e.mae != null ? `$${e.mae}` : "—"}</td>
                      <td className="up">{e.mfe != null ? `+$${e.mfe}` : "—"}</td>
                      <td className="jd-notes-cell" title={e.notes}>
                        {e.notes || "—"}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="jd-del-btn"
                          title="Delete trade entry"
                          onClick={() => {
                            if (window.confirm(`Delete trade ${e.symbol} (${e.side})?`)) {
                              deleteJournalEntry(e.id);
                            }
                          }}
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ADD TRADE MODAL */}
      {addModalOpen && (
        <div className="jd-modal-overlay" onClick={() => setAddModalOpen(false)}>
          <div className="jd-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="jd-modal-header">
              <h3>+ Log Trade to Journal</h3>
              <button
                type="button"
                className="jd-btn-icon"
                onClick={() => setAddModalOpen(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveTrade} className="jd-form">
              <div className="jd-form-row">
                <div className="jd-form-group">
                  <label>Symbol</label>
                  <input
                    type="text"
                    required
                    value={fSymbol}
                    onChange={(e) => setFSymbol(e.target.value.toUpperCase())}
                  />
                </div>
                <div className="jd-form-group">
                  <label>Side</label>
                  <select
                    value={fSide}
                    onChange={(e) => setFSide(e.target.value as "LONG" | "SHORT")}
                  >
                    <option value="LONG">LONG (Buy)</option>
                    <option value="SHORT">SHORT (Sell)</option>
                  </select>
                </div>
              </div>

              <div className="jd-form-row">
                <div className="jd-form-group">
                  <label>Entry Price ($)</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={fEntry}
                    onChange={(e) => setFEntry(e.target.value)}
                  />
                </div>
                <div className="jd-form-group">
                  <label>Exit Price ($)</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={fExit}
                    onChange={(e) => setFExit(e.target.value)}
                  />
                </div>
                <div className="jd-form-group">
                  <label>Quantity / Amount</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={fAmount}
                    onChange={(e) => setFAmount(e.target.value)}
                  />
                </div>
              </div>

              <div className="jd-form-row">
                <div className="jd-form-group">
                  <label>Strategy / Setup</label>
                  <input
                    type="text"
                    placeholder="e.g. Order Block, Liquidity Sweep"
                    value={fStrategy}
                    onChange={(e) => setFStrategy(e.target.value)}
                  />
                </div>
                <div className="jd-form-group">
                  <label>Tags (comma separated)</label>
                  <input
                    type="text"
                    placeholder="e.g. SMC, 15m, Breakout"
                    value={fTags}
                    onChange={(e) => setFTags(e.target.value)}
                  />
                </div>
              </div>

              <div className="jd-form-row">
                <div className="jd-form-group">
                  <label>MAE ($)</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="Adverse excursion"
                    value={fMae}
                    onChange={(e) => setFMae(e.target.value)}
                  />
                </div>
                <div className="jd-form-group">
                  <label>MFE ($)</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="Favorable excursion"
                    value={fMfe}
                    onChange={(e) => setFMfe(e.target.value)}
                  />
                </div>
              </div>

              <div className="jd-form-group">
                <label>Trade Notes & Retrospective</label>
                <textarea
                  rows={3}
                  placeholder="Reason for entry, execution quality, emotional state..."
                  value={fNotes}
                  onChange={(e) => setFNotes(e.target.value)}
                />
              </div>

              <div className="jd-modal-actions">
                <button
                  type="button"
                  className="jd-btn jd-btn-secondary"
                  onClick={() => setAddModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="jd-btn jd-btn-primary">
                  Save Trade
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
