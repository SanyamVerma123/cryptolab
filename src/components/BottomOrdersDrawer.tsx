/**
 * BottomOrdersDrawer — Exact TradingView Paper Trading Drawer
 *
 * Implements:
 * 1. Account Metrics Row (Matching Image 2 & 3):
 *    - Account balance | Equity | Realized PnL | Unrealized PnL | Account margin | Available funds | Orders margin | Margin buffer
 * 2. TradingView Tabs:
 *    - Positions (N), Orders (N), Order history, Balance history, Activity log, Trade history, Analytics
 * 3. Exact Positions Table (Matching Image 2 & 3):
 *    - Symbol badge ([ ₿ CRYPTO:BTCUSD ]), Side (Long/Short), Quantity, Avg fill price, Take profit, Stop loss,
 *      Last price, Unrealized PnL ($ and %), Trade value, Market value, Leverage, Margin, Actions (Edit ✎, Close ✕).
 * 4. Dual environment support (In-App Paper vs Alpaca Paper).
 */
import { useEffect, useState } from "react";
import { useOrders } from "../lib/orderState";

interface Props {
  currentCoin: string;
  currentPrice?: number;
  isOpen: boolean;
  onToggle: () => void;
  onResize?: () => void;
  focusTab?: "positions" | "orders";
  focusRequest?: number;
}

type BottomTab =
  | "positions"
  | "orders"
  | "order_history"
  | "balance_history"
  | "activity_log"
  | "trade_history"
  | "funds";

export function BottomOrdersDrawer({
  currentCoin,
  currentPrice = 0,
  isOpen,
  onToggle,
  onResize,
  focusTab,
  focusRequest = 0,
}: Props) {
  const {
    tradingMode,
    orders,
    positions,
    history,
    balances,
    cancelOrder,
    cancelAllOrders,
    closePosition,
    setOrderTP,
    setOrderSL,
  } = useOrders();

  const [tab, setTab] = useState<BottomTab>("positions");
  const [hideOtherPairs, setHideOtherPairs] = useState(false);
  const [editingPosId, setEditingPosId] = useState<string | null>(null);
  const [editTpInput, setEditTpInput] = useState("");
  const [editSlInput, setEditSlInput] = useState("");

  useEffect(() => {
    if (focusTab) setTab(focusTab);
  }, [focusTab, focusRequest]);

  const [drawerHeight, setDrawerHeight] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("tradepro_bottom_orders_height");
      return saved ? parseInt(saved, 10) : 250;
    } catch {
      return 250;
    }
  });

  const currentPair = `${currentCoin}/USD`;

  const displayedPositions = hideOtherPairs
    ? positions.filter((p) => p.pair === currentPair || p.coin === currentCoin)
    : positions;

  const displayedOrders = hideOtherPairs
    ? orders.filter((o) => o.pair === currentPair || o.coin === currentCoin)
    : orders;

  const displayedHistory = hideOtherPairs
    ? history.filter((o) => o.pair === currentPair || o.coin === currentCoin)
    : history;

  const posCount = displayedPositions.length;
  const openCount = displayedOrders.length;

  // Real-time Unrealized PnL per position
  const getPosPnl = (pos: {
    coin?: string;
    side: "BUY" | "SELL";
    entryPrice: number;
    amount: number;
    currentPrice?: number;
    unrealizedPl?: number;
    unrealizedPlpc?: number;
  }) => {
    // If Alpaca provided official authoritative unrealized PnL, use it when not on current coin chart
    if (pos.unrealizedPl !== undefined && pos.unrealizedPlpc !== undefined && (pos.coin !== currentCoin || !currentPrice)) {
      const pnlVal = pos.unrealizedPl;
      const pnlPct = pos.unrealizedPlpc;
      return {
        val: pnlVal,
        pct: pnlPct,
        tone: pnlVal >= 0 ? "up" : "down",
        strVal: `${pnlVal >= 0 ? "+" : ""}${pnlVal.toFixed(2)} USD`,
        strPct: `${pnlVal >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%`,
      };
    }

    const effectivePx =
      pos.coin === currentCoin && currentPrice > 0
        ? currentPrice
        : pos.currentPrice && pos.currentPrice > 0
        ? pos.currentPrice
        : pos.entryPrice;

    if (!effectivePx || !pos.entryPrice) return null;
    const diff =
      pos.side === "BUY"
        ? effectivePx - pos.entryPrice
        : pos.entryPrice - effectivePx;
    const pnlVal = diff * pos.amount;
    const pnlPct = (diff / pos.entryPrice) * 100;
    return {
      val: pnlVal,
      pct: pnlPct,
      tone: pnlVal >= 0 ? "up" : "down",
      strVal: `${pnlVal >= 0 ? "+" : ""}${pnlVal.toFixed(2)} USD`,
      strPct: `${pnlVal >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%`,
    };
  };

  // Realized PnL from history
  const totalRealizedPnl = history.reduce((acc, h) => {
    if (h.status === "Filled" && h.trigger?.includes("PnL:")) {
      const match = h.trigger.match(/PnL:\s*([+-]?\$?[\d.]+)/);
      if (match) {
        const num = parseFloat(match[1].replace("$", ""));
        if (!isNaN(num)) return acc + num;
      }
    }
    return acc;
  }, 0);

  // Total Unrealized PnL across active positions
  const totalUnrealizedPnl = displayedPositions.reduce((acc, pos) => {
    const pnl = getPosPnl(pos);
    return acc + (pnl ? pnl.val : 0);
  }, 0);

  // Margin collateral locked in active positions
  const totalAccountMargin = displayedPositions.reduce((acc, pos) => {
    return acc + (pos.margin || pos.total / (pos.leverage || 1));
  }, 0);

  // Margin locked in pending limit orders
  const totalOrdersMargin = displayedOrders.reduce((acc, ord) => {
    return acc + ord.total / (ord.leverage || 1);
  }, 0);

  const isAlpaca = tradingMode === "alpaca";
  const accountBalance = balances.USD ?? (isAlpaca ? 0 : 50000);
  const equity = isAlpaca && balances.PORTFOLIO !== undefined && balances.PORTFOLIO > 0
    ? balances.PORTFOLIO
    : accountBalance + totalUnrealizedPnl;
  const availableFunds = isAlpaca && balances.BUYING_POWER !== undefined
    ? balances.BUYING_POWER
    : Math.max(0, accountBalance - totalAccountMargin - totalOrdersMargin);
  const marginBuffer = equity > 0 ? ((availableFunds / equity) * 100).toFixed(2) : "100.00";

  // Drag resizer
  const handleResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const handleEl = e.currentTarget;
    const startY = e.clientY;
    const startH = drawerHeight;
    try {
      handleEl.setPointerCapture(e.pointerId);
    } catch {}
    document.body.classList.add("resizing-row");

    const onPointerMove = (ev: PointerEvent) => {
      ev.preventDefault();
      const dy = startY - ev.clientY;
      const maxH = Math.round(window.innerHeight * 0.7);
      const newH = Math.max(100, Math.min(maxH, startH + dy));
      setDrawerHeight(newH);
      try {
        localStorage.setItem("tradepro_bottom_orders_height", String(newH));
      } catch {}
      onResize?.();
    };

    const onPointerUp = (ev: PointerEvent) => {
      try {
        handleEl.releasePointerCapture(ev.pointerId);
      } catch {}
      document.body.classList.remove("resizing-row");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      onResize?.();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
  };

  const handleSaveEditBrackets = (posId: string) => {
    const tpNum = parseFloat(editTpInput);
    const slNum = parseFloat(editSlInput);
    if (!isNaN(tpNum) && tpNum > 0) setOrderTP(posId, tpNum);
    if (!isNaN(slNum) && slNum > 0) setOrderSL(posId, slNum);
    setEditingPosId(null);
  };

  return (
    <div
      className={"bottom-orders-drawer tv-paper-drawer" + (isOpen ? " open" : " collapsed")}
      style={isOpen ? { height: `${drawerHeight}px` } : undefined}
    >
      {/* Draggable resize bar */}
      {isOpen && (
        <div
          className="bod-resizer-handle"
          onPointerDown={handleResizeStart}
          title="Drag up or down to resize orders panel"
        >
          <div className="bod-resizer-line" />
        </div>
      )}

      {/* Drawer Header Bar */}
      <div
        className="bod-header"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button, input, label")) return;
          onToggle();
        }}
      >
        <div className="bod-header-title-row">
          <span className="tv-drawer-logo">✦ Paper Trading</span>
          <span className={"bod-env-pill " + tradingMode}>
            {tradingMode === "alpaca" ? "Alpaca Live Sync" : "In-App Simulator"}
          </span>
        </div>

        <div className="bod-controls">
          <label className="bod-checkbox-label">
            <input
              type="checkbox"
              checked={hideOtherPairs}
              onChange={(e) => setHideOtherPairs(e.target.checked)}
            />
            <span>Hide Other Pairs</span>
          </label>

          {posCount > 0 && (
            <button
              type="button"
              className="bod-cancel-all-btn danger"
              onClick={() => {
                for (const p of displayedPositions) closePosition(p.id, currentPrice);
              }}
              title="Close all open positions at market price"
            >
              Close All
            </button>
          )}

          {openCount > 0 && (
            <button
              type="button"
              className="bod-cancel-all-btn"
              onClick={() => cancelAllOrders(hideOtherPairs ? currentPair : undefined)}
              title="Cancel all listed open limit orders"
            >
              Cancel All
            </button>
          )}

          <button
            type="button"
            className="bod-toggle-btn"
            onClick={onToggle}
            title={isOpen ? "Collapse panel" : "Expand panel"}
          >
            {isOpen ? "⌄" : "^"}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="bod-body tv-drawer-body">
          {/* ====================================================================
              TRADINGVIEW ACCOUNT METRICS ROW (MATCHING IMAGE 2 & 3)
              ==================================================================== */}
          <div className="tv-acc-metrics-row">
            <div className="tv-am-item">
              <span className="tv-am-k">Account balance</span>
              <span className="tv-am-v">
                {accountBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            <div className="tv-am-item">
              <span className="tv-am-k">Equity</span>
              <span className="tv-am-v bold">
                {equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            <div className="tv-am-item">
              <span className="tv-am-k">Realized PnL</span>
              <span className={`tv-am-v ${totalRealizedPnl >= 0 ? "text-buy" : "text-sell"}`}>
                {totalRealizedPnl >= 0 ? "+" : ""}{totalRealizedPnl.toFixed(2)}
              </span>
            </div>

            <div className="tv-am-item">
              <span className="tv-am-k">Unrealized PnL</span>
              <span className={`tv-am-v bold ${totalUnrealizedPnl >= 0 ? "text-buy" : "text-sell"}`}>
                {totalUnrealizedPnl >= 0 ? "+" : ""}{totalUnrealizedPnl.toFixed(2)}
              </span>
            </div>

            <div className="tv-am-item">
              <span className="tv-am-k">Account margin</span>
              <span className="tv-am-v">
                {totalAccountMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            <div className="tv-am-item">
              <span className="tv-am-k">Available funds</span>
              <span className="tv-am-v">
                {availableFunds.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            <div className="tv-am-item">
              <span className="tv-am-k">Orders margin</span>
              <span className="tv-am-v">
                {totalOrdersMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            <div className="tv-am-item">
              <span className="tv-am-k">Margin buffer</span>
              <span className="tv-am-v">{marginBuffer}%</span>
            </div>
          </div>

          {/* ====================================================================
              TRADINGVIEW TABS (MATCHING IMAGE 2 & 3)
              ==================================================================== */}
          <div className="tv-tab-bar">
            <button
              type="button"
              className={"tv-tab-item" + (tab === "positions" ? " active" : "")}
              onClick={() => setTab("positions")}
            >
              Positions <span className="tv-tab-badge">{posCount}</span>
            </button>
            <button
              type="button"
              className={"tv-tab-item" + (tab === "orders" ? " active" : "")}
              onClick={() => setTab("orders")}
            >
              Orders <span className="tv-tab-badge">{openCount}</span>
            </button>
            <button
              type="button"
              className={"tv-tab-item" + (tab === "order_history" ? " active" : "")}
              onClick={() => setTab("order_history")}
            >
              Order history
            </button>
            <button
              type="button"
              className={"tv-tab-item" + (tab === "balance_history" ? " active" : "")}
              onClick={() => setTab("balance_history")}
            >
              Balance history
            </button>
            <button
              type="button"
              className={"tv-tab-item" + (tab === "activity_log" ? " active" : "")}
              onClick={() => setTab("activity_log")}
            >
              Activity log
            </button>
            <button
              type="button"
              className={"tv-tab-item" + (tab === "trade_history" ? " active" : "")}
              onClick={() => setTab("trade_history")}
            >
              Trade history
            </button>
            <button
              type="button"
              className={"tv-tab-item" + (tab === "funds" ? " active" : "")}
              onClick={() => setTab("funds")}
            >
              Funds
            </button>
          </div>

          {/* ====================================================================
              TABLE CONTENT
              ==================================================================== */}
          {/* TAB 1: POSITIONS (IMAGE 2 & 3 EXACT TABLE) */}
          {tab === "positions" && (
            <div className="bod-table-wrap">
              {displayedPositions.length === 0 ? (
                <div className="bod-empty">No open positions</div>
              ) : (
                <table className="bod-table tv-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Side</th>
                      <th>Quantity</th>
                      <th>Avg fill price</th>
                      <th>Take profit</th>
                      <th>Stop loss</th>
                      <th>Last price</th>
                      <th>Unrealized PnL</th>
                      <th>Unrealized PnL %</th>
                      <th>Trade value</th>
                      <th>Market value</th>
                      <th>Leverage</th>
                      <th>Margin</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedPositions.map((pos) => {
                      const pnl = getPosPnl(pos);
                      const isLong = pos.side === "BUY";
                      const posCurrentPrice =
                        pos.coin === currentCoin && currentPrice > 0
                          ? currentPrice
                          : pos.currentPrice && pos.currentPrice > 0
                          ? pos.currentPrice
                          : pos.entryPrice;

                      const tradeVal = pos.entryPrice * pos.amount;
                      const mktVal = pos.marketValue && pos.marketValue > 0 ? pos.marketValue : posCurrentPrice * pos.amount;
                      const lev = pos.leverage || 10;
                      const marginVal = pos.margin || tradeVal / lev;

                      return (
                        <tr key={pos.id}>
                          <td>
                            <span className="tv-sym-pill">
                              <span className="tv-sym-coin-icon">₿</span>
                              <span>CRYPTO:{pos.coin}USD</span>
                            </span>
                          </td>
                          <td className={isLong ? "text-buy bold" : "text-sell bold"}>
                            {isLong ? "Long" : "Short"}
                          </td>
                          <td className="bold">{pos.amount}</td>
                          <td>
                            {pos.entryPrice.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                          <td>
                            {pos.takeProfit
                              ? pos.takeProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })
                              : "—"}
                          </td>
                          <td>
                            {pos.stopLoss
                              ? pos.stopLoss.toLocaleString(undefined, { minimumFractionDigits: 2 })
                              : "—"}
                          </td>
                          <td>
                            {posCurrentPrice.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                          <td className={pnl ? (pnl.tone === "up" ? "text-buy bold" : "text-sell bold") : ""}>
                            {pnl ? pnl.strVal : "—"}
                          </td>
                          <td className={pnl ? (pnl.tone === "up" ? "text-buy bold" : "text-sell bold") : ""}>
                            {pnl ? pnl.strPct : "—"}
                          </td>
                          <td>{tradeVal.toLocaleString(undefined, { minimumFractionDigits: 2 })} USD</td>
                          <td>{mktVal.toLocaleString(undefined, { minimumFractionDigits: 2 })} USD</td>
                          <td>
                            <span className="tv-leverage-box">{lev}x</span>
                          </td>
                          <td>{marginVal.toLocaleString(undefined, { minimumFractionDigits: 2 })} USD</td>
                          <td>
                            <div className="tv-table-actions">
                              <button
                                type="button"
                                className="tv-act-btn edit"
                                title="Edit Take Profit / Stop Loss"
                                onClick={() => {
                                  setEditingPosId(pos.id);
                                  setEditTpInput(pos.takeProfit ? String(pos.takeProfit) : "");
                                  setEditSlInput(pos.stopLoss ? String(pos.stopLoss) : "");
                                }}
                              >
                                ✎
                              </button>
                              <button
                                type="button"
                                className="tv-act-btn close"
                                title="Close position at market price"
                                onClick={() => closePosition(pos.id, currentPrice)}
                              >
                                ✕
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {/* In-Drawer Edit Modal */}
              {editingPosId && (
                <div className="tv-edit-inline-bar">
                  <span>Edit TP / SL:</span>
                  <input
                    type="number"
                    placeholder="Take Profit Price"
                    className="sm-input small"
                    value={editTpInput}
                    onChange={(e) => setEditTpInput(e.target.value)}
                  />
                  <input
                    type="number"
                    placeholder="Stop Loss Price"
                    className="sm-input small"
                    value={editSlInput}
                    onChange={(e) => setEditSlInput(e.target.value)}
                  />
                  <button
                    type="button"
                    className="sm-btn primary small"
                    onClick={() => handleSaveEditBrackets(editingPosId)}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="sm-btn secondary small"
                    onClick={() => setEditingPosId(null)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: ORDERS (PENDING LIMIT ORDERS) */}
          {tab === "orders" && (
            <div className="bod-table-wrap">
              {displayedOrders.length === 0 ? (
                <div className="bod-empty">No open orders</div>
              ) : (
                <table className="bod-table tv-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Type</th>
                      <th>Side</th>
                      <th>Limit price</th>
                      <th>Quantity</th>
                      <th>Total value</th>
                      <th>Take profit</th>
                      <th>Stop loss</th>
                      <th>Date</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedOrders.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <span className="tv-sym-pill">
                            <span className="tv-sym-coin-icon">₿</span>
                            <span>CRYPTO:{o.coin}USD</span>
                          </span>
                        </td>
                        <td>{o.type}</td>
                        <td className={o.side === "BUY" ? "text-buy bold" : "text-sell bold"}>
                          {o.side === "BUY" ? "Buy" : "Sell"}
                        </td>
                        <td className="bold">
                          ${o.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td>{o.amount}</td>
                        <td>${o.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td>{o.takeProfit ? `$${o.takeProfit.toLocaleString()}` : "—"}</td>
                        <td>{o.stopLoss ? `$${o.stopLoss.toLocaleString()}` : "—"}</td>
                        <td>{o.date}</td>
                        <td>
                          <button
                            type="button"
                            className="tv-act-btn close"
                            title="Cancel order"
                            onClick={() => cancelOrder(o.id)}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 3: ORDER HISTORY */}
          {tab === "order_history" && (
            <div className="bod-table-wrap">
              {displayedHistory.length === 0 ? (
                <div className="bod-empty">No order history</div>
              ) : (
                <table className="bod-table tv-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Symbol</th>
                      <th>Type</th>
                      <th>Side</th>
                      <th>Price</th>
                      <th>Quantity</th>
                      <th>Total</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedHistory.map((h) => (
                      <tr key={h.id}>
                        <td>{h.date}</td>
                        <td>CRYPTO:{h.coin}USD</td>
                        <td>{h.type}</td>
                        <td className={h.side === "BUY" ? "text-buy bold" : "text-sell bold"}>
                          {h.side}
                        </td>
                        <td>${h.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td>{h.amount}</td>
                        <td>${h.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td>
                          <span className={"bod-status " + h.status.toLowerCase()}>{h.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 4: BALANCE HISTORY */}
          {tab === "balance_history" && (
            <div className="bod-table-wrap">
              <table className="bod-table tv-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Account balance</th>
                    <th>Equity</th>
                    <th>Change</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{new Date().toLocaleDateString()}</td>
                    <td>${accountBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td>${equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td className={totalUnrealizedPnl >= 0 ? "text-buy" : "text-sell"}>
                      {totalUnrealizedPnl >= 0 ? "+" : ""}${totalUnrealizedPnl.toFixed(2)}
                    </td>
                    <td>Trading balance update</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 5: ACTIVITY LOG */}
          {tab === "activity_log" && (
            <div className="bod-table-wrap">
              <table className="bod-table tv-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Activity</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedHistory.slice(0, 15).map((h) => (
                    <tr key={h.id}>
                      <td>{h.date}</td>
                      <td>{h.status === "Filled" ? "Order Filled" : "Order Canceled"}</td>
                      <td>
                        {h.side} {h.amount} {h.coin} @ ${h.price.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 6: TRADE HISTORY */}
          {tab === "trade_history" && (
            <div className="bod-table-wrap">
              {displayedHistory.filter((h) => h.status === "Filled").length === 0 ? (
                <div className="bod-empty">No trade history</div>
              ) : (
                <table className="bod-table tv-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Symbol</th>
                      <th>Side</th>
                      <th>Executed Price</th>
                      <th>Filled Amount</th>
                      <th>Fee</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedHistory
                      .filter((h) => h.status === "Filled")
                      .map((h) => (
                        <tr key={h.id}>
                          <td>{h.date}</td>
                          <td>CRYPTO:{h.coin}USD</td>
                          <td className={h.side === "BUY" ? "text-buy bold" : "text-sell bold"}>
                            {h.side}
                          </td>
                          <td>${h.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                          <td>{h.amount}</td>
                          <td>${(h.total * 0.00035).toFixed(3)}</td>
                          <td>${h.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 7: FUNDS */}
          {tab === "funds" && (
            <div className="bod-table-wrap">
              <table className="bod-table tv-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Total balance</th>
                    <th>Available funds</th>
                    <th>In positions</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(balances)
                    .filter(([k]) => k !== "BUYING_POWER" && k !== "PORTFOLIO")
                    .map(([asset, bal]) => (
                      <tr key={asset}>
                        <td className="bold">{asset}</td>
                        <td>{bal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
                        <td>{bal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
                        <td>0.00</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
