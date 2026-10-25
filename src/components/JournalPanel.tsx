/**
 * JournalPanel.tsx — Professional Trading Journal & Performance Analytics
 *
 * Implements:
 * 1. Performance Overview: Win Rate %, Net PnL, Profit Factor, Best/Worst Trades, Long/Short Win Rates
 * 2. Multi-View Architecture:
 *    - 📋 Trade Log: Filterable, searchable table with inline badges, PnL tags, MAE/MFE
 *    - 📅 Calendar: Month view with daily PnL chips and trade counts
 *    - 📊 Analytics: Breakdown by Strategy, Long vs Short metrics, Win/Loss distribution
 * 3. Management Actions:
 *    - "+ Add Trade" manual log modal
 *    - "Export CSV" and "Import CSV"
 *    - Auto-sync with Paper Trading & Replay practice trades
 */
import { useEffect, useMemo, useState, useRef } from "react";
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
  onClose?: () => void;
}

export function JournalPanel({ onClose }: Props) {
  const [entries, setEntries] = useState<JournalEntry[]>(() => getJournalEntries());
  const [activeTab, setActiveTab] = useState<"trades" | "calendar" | "analytics">("trades");
  const [search, setSearch] = useState("");
  const [sideFilter, setSideFilter] = useState<"ALL" | "LONG" | "SHORT">("ALL");
  const [sourceFilter, setSourceFilter] = useState<"ALL" | "paper" | "replay" | "manual">("ALL");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form State for "+ Add Trade"
  const [formSymbol, setFormSymbol] = useState("BTCUSDT");
  const [formSide, setFormSide] = useState<"LONG" | "SHORT">("LONG");
  const [formEntry, setFormEntry] = useState("79200");
  const [formExit, setFormExit] = useState("80500");
  const [formAmount, setFormAmount] = useState("0.5");
  const [formStrategy, setFormStrategy] = useState("Breakout Retest");
  const [formTags, setFormTags] = useState("SMC, 15m, New York");
  const [formNotes, setFormNotes] = useState("");
  const [formMae, setFormMae] = useState("");
  const [formMfe, setFormMfe] = useState("");

  const refresh = () => setEntries(getJournalEntries());

  useEffect(() => {
    window.addEventListener("tradepro:journal-updated", refresh);
    return () => window.removeEventListener("tradepro:journal-updated", refresh);
  }, []);

  const stats = useMemo(() => calculateJournalStats(entries), [entries]);

  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (sideFilter !== "ALL" && e.side !== sideFilter) return false;
      if (sourceFilter !== "ALL" && (e.source || "manual") !== sourceFilter) return false;
      if (selectedDate) {
        const entryDay = new Date(e.date).toISOString().slice(0, 10);
        if (entryDay !== selectedDate) return false;
      }
      if (search) {
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

  const handleCreateTrade = (ev: React.FormEvent) => {
    ev.preventDefault();
    const entryP = parseFloat(formEntry) || 0;
    const exitP = parseFloat(formExit) || 0;
    const amt = parseFloat(formAmount) || 0;
    if (entryP <= 0 || exitP <= 0 || amt <= 0) return;

    const diff = formSide === "LONG" ? exitP - entryP : entryP - exitP;
    const pnl = diff * amt;
    const pnlPercent = (diff / entryP) * 100;

    addJournalEntry({
      symbol: formSymbol.toUpperCase(),
      side: formSide,
      entryPrice: entryP,
      exitPrice: exitP,
      amount: amt,
      pnl: Math.round(pnl * 100) / 100,
      pnlPercent: Math.round(pnlPercent * 100) / 100,
      strategy: formStrategy.trim(),
      tags: formTags.split(",").map((t) => t.trim()).filter(Boolean),
      notes: formNotes.trim(),
      mae: formMae ? parseFloat(formMae) : undefined,
      mfe: formMfe ? parseFloat(formMfe) : undefined,
      source: "manual",
    });

    setAddModalOpen(false);
    setFormNotes("");
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = String(event.target?.result || "");
        const lines = text.split(/\r?\n/).filter(Boolean);
        if (lines.length < 2) return;
        const newEntries: JournalEntry[] = [];
        for (let i = 1; i < lines.length; i++) {
          const row = lines[i].split(",").map((c) => c.replace(/^"|"$/g, "").trim());
          if (row.length < 7) continue;
          const [date, symbol, side, entryPrice, exitPrice, amount, pnl, pnlPercent, duration, strategy, tags, notes] = row;
          newEntries.push({
            id: `csv_${Date.now()}_${i}`,
            date: date || new Date().toISOString(),
            timestamp: Date.now() - i * 3600000,
            symbol: symbol || "BTCUSDT",
            side: (side?.toUpperCase() === "SHORT" ? "SHORT" : "LONG") as "LONG" | "SHORT",
            entryPrice: parseFloat(entryPrice) || 0,
            exitPrice: parseFloat(exitPrice) || 0,
            amount: parseFloat(amount) || 1,
            pnl: parseFloat(pnl) || 0,
            pnlPercent: parseFloat(pnlPercent) || 0,
            duration: duration || undefined,
            strategy: strategy || undefined,
            tags: tags ? tags.split(";").map((t) => t.trim()) : undefined,
            notes: notes || undefined,
            source: "manual",
          });
        }
        if (newEntries.length > 0) {
          saveJournalEntries([...newEntries, ...entries]);
        }
      } catch (err) {
        console.error("Failed to parse CSV:", err);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // Calendar grouping
  const calendarData = useMemo(() => {
    const map = new Map<string, { pnl: number; count: number; wins: number }>();
    entries.forEach((e) => {
      const d = new Date(e.date).toISOString().slice(0, 10);
      const curr = map.get(d) || { pnl: 0, count: 0, wins: 0 };
      curr.pnl += e.pnl;
      curr.count += 1;
      if (e.pnl > 0) curr.wins += 1;
      map.set(d, curr);
    });
    return map;
  }, [entries]);

  // Strategy performance
  const strategyStats = useMemo(() => {
    const map = new Map<string, { count: number; wins: number; pnl: number }>();
    entries.forEach((e) => {
      const strat = e.strategy || "Uncategorized";
      const curr = map.get(strat) || { count: 0, wins: 0, pnl: 0 };
      curr.count += 1;
      curr.pnl += e.pnl;
      if (e.pnl > 0) curr.wins += 1;
      map.set(strat, curr);
    });
    return Array.from(map.entries()).map(([strategy, data]) => ({
      strategy,
      count: data.count,
      winRate: Math.round((data.wins / data.count) * 100),
      totalPnl: Math.round(data.pnl * 100) / 100,
    })).sort((a, b) => b.totalPnl - a.totalPnl);
  }, [entries]);

  return (
    <div className="tradepro-journal-panel">
      {/* Header bar */}
      <div className="jp-header">
        <div className="jp-title-group">
          <span className="jp-title-icon">📓</span>
          <span className="jp-title-text">Trading Journal</span>
          <span className="jp-trade-badge">{entries.length} Trades</span>
        </div>
        <div className="jp-header-actions">
          <button
            className="jp-btn jp-btn-primary"
            onClick={() => setAddModalOpen(true)}
            title="Log a new trade manually"
          >
            + Add Trade
          </button>
          <button
            className="jp-btn jp-btn-secondary"
            onClick={exportJournalCsv}
            title="Export journal to CSV"
          >
            Export CSV
          </button>
          <button
            className="jp-btn jp-btn-secondary"
            onClick={() => fileInputRef.current?.click()}
            title="Import trades from CSV"
          >
            Import CSV
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            onChange={handleCsvUpload}
          />
          {onClose && (
            <button className="jp-btn-icon" onClick={onClose} title="Close Journal">
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Metrics Cards Bar */}
      <div className="jp-metrics-bar">
        <div className="jp-metric-card">
          <span className="jp-metric-label">Win Rate</span>
          <span
            className={
              "jp-metric-val " + (stats.winRate >= 50 ? "jp-val-up" : "jp-val-down")
            }
          >
            {stats.winRate}%
          </span>
          <span className="jp-metric-sub">
            {stats.winningTrades}W / {stats.losingTrades}L
          </span>
        </div>

        <div className="jp-metric-card">
          <span className="jp-metric-label">Net Profit</span>
          <span
            className={
              "jp-metric-val " + (stats.totalPnl >= 0 ? "jp-val-up" : "jp-val-down")
            }
          >
            {stats.totalPnl >= 0 ? "+" : ""}${stats.totalPnl.toLocaleString()}
          </span>
          <span className="jp-metric-sub">
            Profit Factor: {stats.profitFactor}
          </span>
        </div>

        <div className="jp-metric-card">
          <span className="jp-metric-label">Avg Win / Loss</span>
          <span className="jp-metric-val">
            <span className="jp-val-up">+${stats.avgWin}</span>
            <span className="jp-val-sep">/</span>
            <span className="jp-val-down">-${stats.avgLoss}</span>
          </span>
          <span className="jp-metric-sub">Avg Trade: ${stats.avgTrade}</span>
        </div>

        <div className="jp-metric-card">
          <span className="jp-metric-label">Long / Short Win %</span>
          <span className="jp-metric-val">
            {stats.longWinRate}% <span className="jp-val-sep">|</span> {stats.shortWinRate}%
          </span>
          <span className="jp-metric-sub">Directional edge</span>
        </div>
      </div>

      {/* Sub-tabs: Trade Log, Calendar, Analytics */}
      <div className="jp-subtabs-row">
        <div className="jp-subtabs">
          <button
            className={"jp-subtab " + (activeTab === "trades" ? "active" : "")}
            onClick={() => setActiveTab("trades")}
          >
            📋 Trade Log
          </button>
          <button
            className={"jp-subtab " + (activeTab === "calendar" ? "active" : "")}
            onClick={() => setActiveTab("calendar")}
          >
            📅 Calendar View
          </button>
          <button
            className={"jp-subtab " + (activeTab === "analytics" ? "active" : "")}
            onClick={() => setActiveTab("analytics")}
          >
            📊 Analytics & Strategies
          </button>
        </div>

        {activeTab === "trades" && (
          <div className="jp-filters">
            <input
              type="text"
              placeholder="Search symbol, tags, notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="jp-search-input"
            />
            <select
              value={sideFilter}
              onChange={(e) => setSideFilter(e.target.value as any)}
              className="jp-select"
            >
              <option value="ALL">All Sides</option>
              <option value="LONG">Long Only</option>
              <option value="SHORT">Short Only</option>
            </select>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as any)}
              className="jp-select"
            >
              <option value="ALL">All Sources</option>
              <option value="paper">Paper Trading</option>
              <option value="replay">Bar Replay</option>
              <option value="manual">Manual Entry</option>
            </select>
            {selectedDate && (
              <button
                className="jp-btn-clear-date"
                onClick={() => setSelectedDate(null)}
                title="Clear date filter"
              >
                Day: {selectedDate} ✕
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="jp-body">
        {activeTab === "trades" && (
          <div className="jp-table-wrapper">
            <table className="jp-table">
              <thead>
                <tr>
                  <th>Date & Time</th>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th className="num">Entry</th>
                  <th className="num">Exit</th>
                  <th className="num">Amount</th>
                  <th className="num">Net PnL</th>
                  <th className="num">PnL %</th>
                  <th>MAE / MFE</th>
                  <th>Strategy & Notes</th>
                  <th>Source</th>
                  <th className="act">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="jp-empty-cell">
                      No journal entries found matching criteria.
                    </td>
                  </tr>
                ) : (
                  filteredEntries.map((e) => (
                    <tr
                      key={e.id}
                      className="jp-tr"
                      onClick={() => setSelectedEntry(e)}
                    >
                      <td className="jp-td-date">
                        {new Date(e.date).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="jp-td-symbol">
                        <span className="jp-symbol-badge">{e.symbol}</span>
                      </td>
                      <td>
                        <span
                          className={
                            "jp-side-badge " +
                            (e.side === "LONG" ? "jp-side-long" : "jp-side-short")
                          }
                        >
                          {e.side}
                        </span>
                      </td>
                      <td className="num">${e.entryPrice.toLocaleString()}</td>
                      <td className="num">${e.exitPrice.toLocaleString()}</td>
                      <td className="num">{e.amount}</td>
                      <td
                        className={
                          "num jp-bold " + (e.pnl >= 0 ? "jp-val-up" : "jp-val-down")
                        }
                      >
                        {e.pnl >= 0 ? "+" : ""}${e.pnl.toLocaleString()}
                      </td>
                      <td
                        className={
                          "num " + (e.pnlPercent >= 0 ? "jp-val-up" : "jp-val-down")
                        }
                      >
                        {e.pnlPercent >= 0 ? "+" : ""}{e.pnlPercent.toFixed(2)}%
                      </td>
                      <td className="jp-td-excursion">
                        {e.mae != null || e.mfe != null ? (
                          <span>
                            <span className="jp-val-down">
                              {e.mae != null ? `${e.mae >= 0 ? "+" : ""}$${e.mae}` : "-"}
                            </span>
                            {" / "}
                            <span className="jp-val-up">
                              {e.mfe != null ? `+$${e.mfe}` : "-"}
                            </span>
                          </span>
                        ) : (
                          <span className="jp-dim">—</span>
                        )}
                      </td>
                      <td className="jp-td-notes">
                        {e.strategy && (
                          <span className="jp-strat-tag">{e.strategy}</span>
                        )}
                        <span className="jp-notes-preview">{e.notes || "—"}</span>
                      </td>
                      <td>
                        <span className={"jp-source-chip jp-src-" + (e.source || "manual")}>
                          {e.source || "manual"}
                        </span>
                      </td>
                      <td className="act" onClick={(ev) => ev.stopPropagation()}>
                        <button
                          className="jp-btn-del"
                          onClick={() => deleteJournalEntry(e.id)}
                          title="Delete trade"
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "calendar" && (
          <div className="jp-calendar-container">
            <div className="jp-calendar-head">
              <h4>Monthly Performance Calendar</h4>
              <span className="jp-dim">Click any day to filter Trade Log</span>
            </div>
            <div className="jp-calendar-grid">
              {Array.from({ length: 30 }, (_, i) => {
                const dayDate = new Date(Date.now() - (29 - i) * 86400000);
                const dayStr = dayDate.toISOString().slice(0, 10);
                const data = calendarData.get(dayStr);
                const isSelected = selectedDate === dayStr;
                return (
                  <div
                    key={dayStr}
                    className={
                      "jp-cal-cell " +
                      (data ? (data.pnl >= 0 ? "jp-cal-win" : "jp-cal-loss") : "jp-cal-empty") +
                      (isSelected ? " jp-cal-selected" : "")
                    }
                    onClick={() => {
                      if (data) {
                        setSelectedDate(dayStr);
                        setActiveTab("trades");
                      }
                    }}
                  >
                    <div className="jp-cal-cell-date">
                      {dayDate.toLocaleDateString([], { month: "short", day: "numeric" })}
                    </div>
                    {data ? (
                      <div className="jp-cal-cell-content">
                        <div
                          className={
                            "jp-cal-pnl " + (data.pnl >= 0 ? "jp-val-up" : "jp-val-down")
                          }
                        >
                          {data.pnl >= 0 ? "+" : ""}${Math.round(data.pnl)}
                        </div>
                        <div className="jp-cal-count">
                          {data.count} {data.count === 1 ? "trade" : "trades"}
                        </div>
                      </div>
                    ) : (
                      <div className="jp-cal-none">—</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === "analytics" && (
          <div className="jp-analytics-view">
            <div className="jp-analytics-grid">
              <div className="jp-card">
                <h4>Strategy Performance</h4>
                <table className="jp-mini-table">
                  <thead>
                    <tr>
                      <th>Strategy</th>
                      <th className="num">Trades</th>
                      <th className="num">Win %</th>
                      <th className="num">Total PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {strategyStats.map((s) => (
                      <tr key={s.strategy}>
                        <td><strong>{s.strategy}</strong></td>
                        <td className="num">{s.count}</td>
                        <td className="num">{s.winRate}%</td>
                        <td
                          className={
                            "num " + (s.totalPnl >= 0 ? "jp-val-up" : "jp-val-down")
                          }
                        >
                          {s.totalPnl >= 0 ? "+" : ""}${s.totalPnl.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="jp-card">
                <h4>Extremes & Risk Metrics</h4>
                <div className="jp-stat-rows">
                  <div className="jp-stat-row">
                    <span>Best Trade:</span>
                    <strong className="jp-val-up">+${stats.bestTrade}</strong>
                  </div>
                  <div className="jp-stat-row">
                    <span>Worst Trade:</span>
                    <strong className="jp-val-down">${stats.worstTrade}</strong>
                  </div>
                  <div className="jp-stat-row">
                    <span>Gross Profit:</span>
                    <span className="jp-val-up">+${stats.grossProfit}</span>
                  </div>
                  <div className="jp-stat-row">
                    <span>Gross Loss:</span>
                    <span className="jp-val-down">-${stats.grossLoss}</span>
                  </div>
                  <div className="jp-stat-row">
                    <span>Profit Factor:</span>
                    <span>{stats.profitFactor}</span>
                  </div>
                  <div className="jp-stat-row">
                    <span>Break-even Trades:</span>
                    <span>{stats.breakEvenTrades}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Manual "+ Add Trade" Modal */}
      {addModalOpen && (
        <div className="jp-modal-overlay" onClick={() => setAddModalOpen(false)}>
          <div className="jp-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="jp-modal-head">
              <h3>+ Log New Trade</h3>
              <button className="jp-btn-icon" onClick={() => setAddModalOpen(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateTrade} className="jp-form">
              <div className="jp-form-row">
                <div className="jp-form-group">
                  <label>Symbol</label>
                  <input
                    type="text"
                    value={formSymbol}
                    onChange={(e) => setFormSymbol(e.target.value)}
                    required
                  />
                </div>
                <div className="jp-form-group">
                  <label>Side</label>
                  <select
                    value={formSide}
                    onChange={(e) => setFormSide(e.target.value as any)}
                  >
                    <option value="LONG">Long (Buy)</option>
                    <option value="SHORT">Short (Sell)</option>
                  </select>
                </div>
              </div>

              <div className="jp-form-row">
                <div className="jp-form-group">
                  <label>Entry Price ($)</label>
                  <input
                    type="number"
                    step="any"
                    value={formEntry}
                    onChange={(e) => setFormEntry(e.target.value)}
                    required
                  />
                </div>
                <div className="jp-form-group">
                  <label>Exit Price ($)</label>
                  <input
                    type="number"
                    step="any"
                    value={formExit}
                    onChange={(e) => setFormExit(e.target.value)}
                    required
                  />
                </div>
                <div className="jp-form-group">
                  <label>Amount / Quantity</label>
                  <input
                    type="number"
                    step="any"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="jp-form-row">
                <div className="jp-form-group">
                  <label>MAE (Max Adverse Excursion, $)</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="-50"
                    value={formMae}
                    onChange={(e) => setFormMae(e.target.value)}
                  />
                </div>
                <div className="jp-form-group">
                  <label>MFE (Max Favorable Excursion, $)</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="+200"
                    value={formMfe}
                    onChange={(e) => setFormMfe(e.target.value)}
                  />
                </div>
              </div>

              <div className="jp-form-row">
                <div className="jp-form-group">
                  <label>Strategy Setup</label>
                  <input
                    type="text"
                    placeholder="e.g. FVG Swept, 15m Trendline"
                    value={formStrategy}
                    onChange={(e) => setFormStrategy(e.target.value)}
                  />
                </div>
                <div className="jp-form-group">
                  <label>Tags (comma separated)</label>
                  <input
                    type="text"
                    placeholder="e.g. SMC, London Open, Scalp"
                    value={formTags}
                    onChange={(e) => setFormTags(e.target.value)}
                  />
                </div>
              </div>

              <div className="jp-form-group">
                <label>Trade Notes & Retrospective</label>
                <textarea
                  rows={3}
                  placeholder="What was the reason for entry? Did you stick to the plan?"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                />
              </div>

              <div className="jp-modal-actions">
                <button
                  type="button"
                  className="jp-btn jp-btn-secondary"
                  onClick={() => setAddModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="jp-btn jp-btn-primary">
                  Save to Journal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Trade Detail Inspector Modal */}
      {selectedEntry && (
        <div className="jp-modal-overlay" onClick={() => setSelectedEntry(null)}>
          <div className="jp-modal-card jp-detail-card" onClick={(e) => e.stopPropagation()}>
            <div className="jp-modal-head">
              <h3>
                Trade #{selectedEntry.id} — {selectedEntry.symbol} {selectedEntry.side}
              </h3>
              <button className="jp-btn-icon" onClick={() => setSelectedEntry(null)}>
                ✕
              </button>
            </div>
            <div className="jp-detail-content">
              <div className="jp-detail-pnl-banner">
                <span className="jp-dim">Realized PnL:</span>
                <span
                  className={
                    "jp-detail-pnl-val " +
                    (selectedEntry.pnl >= 0 ? "jp-val-up" : "jp-val-down")
                  }
                >
                  {selectedEntry.pnl >= 0 ? "+" : ""}${selectedEntry.pnl.toLocaleString()} (
                  {selectedEntry.pnlPercent >= 0 ? "+" : ""}
                  {selectedEntry.pnlPercent.toFixed(2)}%)
                </span>
              </div>

              <div className="jp-detail-grid">
                <div>
                  <span className="jp-dim">Entry Price:</span> ${selectedEntry.entryPrice}
                </div>
                <div>
                  <span className="jp-dim">Exit Price:</span> ${selectedEntry.exitPrice}
                </div>
                <div>
                  <span className="jp-dim">Size:</span> {selectedEntry.amount}
                </div>
                <div>
                  <span className="jp-dim">Date:</span> {new Date(selectedEntry.date).toLocaleString()}
                </div>
                <div>
                  <span className="jp-dim">MAE:</span>{" "}
                  {selectedEntry.mae != null ? `$${selectedEntry.mae}` : "N/A"}
                </div>
                <div>
                  <span className="jp-dim">MFE:</span>{" "}
                  {selectedEntry.mfe != null ? `+$${selectedEntry.mfe}` : "N/A"}
                </div>
                <div>
                  <span className="jp-dim">Strategy:</span> {selectedEntry.strategy || "—"}
                </div>
                <div>
                  <span className="jp-dim">Source:</span> {selectedEntry.source || "manual"}
                </div>
              </div>

              {selectedEntry.notes && (
                <div className="jp-detail-notes">
                  <h4>Trade Notes</h4>
                  <p>{selectedEntry.notes}</p>
                </div>
              )}

              {selectedEntry.tags && selectedEntry.tags.length > 0 && (
                <div className="jp-detail-tags">
                  {selectedEntry.tags.map((t) => (
                    <span key={t} className="jp-tag-pill">
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
