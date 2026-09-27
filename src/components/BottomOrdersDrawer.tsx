/**
 * BottomOrdersDrawer — Binance/TradingView-style Bottom Orders & Positions Drawer
 *
 * Sits docked at the bottom of the chart area. Features:
 * 1. Positions Tab (Open Trades):
 *    - Real-time PnL ($ and %), Entry Price, Mark Price, TP/SL, and instant Close Position button.
 * 2. Open Orders Tab:
 *    - Pending Limit Orders waiting for price execution, with Cancel and Cancel All buttons.
 * 3. Order History & Trade History:
 *    - Historical execution records with fees and realized PnL.
 * 4. Funds:
 *    - Asset balances breakdown.
 * 5. Controls:
 *    - "Hide Other Pairs" toggle, draggable vertical height resizer, and bottom-right "^" toggle chevron.
 */
import { useState } from "react";
import { useOrders } from "../lib/orderState";

interface Props {
  currentCoin: string;
  currentPrice?: number;
  isOpen: boolean;
  onToggle: () => void;
  onResize?: () => void;
}

type BottomTab = "positions" | "open" | "history" | "trades" | "funds";

export function BottomOrdersDrawer({
  currentCoin,
  currentPrice = 0,
  isOpen,
  onToggle,
  onResize,
}: Props) {
  const { orders, positions, history, balances, cancelOrder, cancelAllOrders, closePosition } =
    useOrders();
  const [tab, setTab] = useState<BottomTab>("positions");
  const [hideOtherPairs, setHideOtherPairs] = useState(false);

  const [drawerHeight, setDrawerHeight] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("tradepro_bottom_orders_height");
      return saved ? parseInt(saved, 10) : 230;
    } catch {
      return 230;
    }
  });

  const currentPair = `${currentCoin}/USD`;

  // Filter positions and orders if "Hide Other Pairs" is enabled
  const displayedPositions = hideOtherPairs
    ? positions.filter((p) => p.pair === currentPair || p.coin === currentCoin)
    : positions;

  const displayedOrders = hideOtherPairs
    ? orders.filter((o) => o.pair === currentPair || o.coin === currentCoin)
    : orders;

  const displayedHistory = hideOtherPairs
    ? history.filter((o) => o.pair === currentPair || o.coin === currentCoin)
    : history;

  const filledTrades = displayedHistory.filter((o) => o.status === "Filled");

  const posCount = displayedPositions.length;
  const openCount = displayedOrders.length;

  // Real-time Unrealized PnL for an open position
  const getPositionPnl = (pos: {
    side: "BUY" | "SELL";
    entryPrice: number;
    amount: number;
  }) => {
    if (!currentPrice || currentPrice <= 0 || !pos.entryPrice) return null;
    const diff =
      pos.side === "BUY"
        ? currentPrice - pos.entryPrice
        : pos.entryPrice - currentPrice;
    const pnlVal = diff * pos.amount;
    const pnlPct = (diff / pos.entryPrice) * 100;
    const isUp = pnlVal >= 0;
    return {
      val: pnlVal,
      pct: pnlPct,
      tone: isUp ? "up" : "down",
      str: `${isUp ? "+" : ""}$${pnlVal.toFixed(2)} (${isUp ? "+" : ""}${pnlPct.toFixed(2)}%)`,
    };
  };

  // Real-time PnL for historical / closed orders
  const getOrderPnl = (o: { side: string; price: number; amount: number }) => {
    if (!currentPrice || currentPrice <= 0 || !o.price) return null;
    const diff = o.side === "BUY" ? currentPrice - o.price : o.price - currentPrice;
    const pnlVal = diff * o.amount;
    const pnlPct = (diff / o.price) * 100;
    const isUp = pnlVal >= 0;
    return {
      val: pnlVal,
      pct: pnlPct,
      tone: isUp ? "up" : "down",
      str: `${isUp ? "+" : ""}$${pnlVal.toFixed(2)} (${isUp ? "+" : ""}${pnlPct.toFixed(2)}%)`,
    };
  };

  // Total Open Unrealized PnL across active positions
  const totalPositionPnl = displayedPositions.reduce((acc, pos) => {
    const pnl = getPositionPnl(pos);
    return acc + (pnl ? pnl.val : 0);
  }, 0);

  // Close all open positions at market price
  const handleCloseAllPositions = () => {
    for (const pos of displayedPositions) {
      closePosition(pos.id, currentPrice);
    }
  };

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
      const dy = startY - ev.clientY; // dragging up increases height
      const maxH = Math.round(window.innerHeight * 0.65);
      const newH = Math.max(90, Math.min(maxH, startH + dy));
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
      window.removeEventListener("pointercancel", onPointerUp);
      onResize?.();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  return (
    <div
      className={"bottom-orders-drawer" + (isOpen ? " open" : " collapsed")}
      style={isOpen ? { height: `${drawerHeight}px` } : undefined}
    >
      {/* Draggable horizontal separator bar */}
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
        <div className="bod-tabs">
          <button
            type="button"
            className={"bod-tab" + (tab === "positions" ? " active" : "")}
            onClick={() => {
              setTab("positions");
              if (!isOpen) onToggle();
            }}
          >
            Positions ({posCount})
          </button>
          <button
            type="button"
            className={"bod-tab" + (tab === "open" ? " active" : "")}
            onClick={() => {
              setTab("open");
              if (!isOpen) onToggle();
            }}
          >
            Open Orders ({openCount})
          </button>
          <button
            type="button"
            className={"bod-tab" + (tab === "history" ? " active" : "")}
            onClick={() => {
              setTab("history");
              if (!isOpen) onToggle();
            }}
          >
            Order History
          </button>
          <button
            type="button"
            className={"bod-tab" + (tab === "trades" ? " active" : "")}
            onClick={() => {
              setTab("trades");
              if (!isOpen) onToggle();
            }}
          >
            Trade History
          </button>
          <button
            type="button"
            className={"bod-tab" + (tab === "funds" ? " active" : "")}
            onClick={() => {
              setTab("funds");
              if (!isOpen) onToggle();
            }}
          >
            Funds
          </button>
        </div>

        <div className="bod-controls">
          {posCount > 0 && currentPrice > 0 && (
            <div className={"bod-pnl-pill " + (totalPositionPnl >= 0 ? "up" : "down")}>
              <span className="bod-pnl-pill-k">Unrealized PnL:</span>
              <span className="bod-pnl-pill-v">
                {totalPositionPnl >= 0 ? "+" : ""}${totalPositionPnl.toFixed(2)}
              </span>
            </div>
          )}

          <label className="bod-checkbox-label">
            <input
              type="checkbox"
              checked={hideOtherPairs}
              onChange={(e) => setHideOtherPairs(e.target.checked)}
            />
            <span>Hide Other Pairs</span>
          </label>

          {tab === "positions" && posCount > 0 && (
            <button
              type="button"
              className="bod-cancel-all-btn danger"
              onClick={handleCloseAllPositions}
              title="Close all open positions at market price"
            >
              Close All Positions
            </button>
          )}

          {tab === "open" && openCount > 0 && (
            <button
              type="button"
              className="bod-cancel-all-btn"
              onClick={() => cancelAllOrders(hideOtherPairs ? currentPair : undefined)}
              title="Cancel all listed open limit orders"
            >
              Cancel All Orders
            </button>
          )}

          {/* The "^" toggle button at the bottom-right corner */}
          <button
            type="button"
            className="bod-toggle-btn"
            onClick={onToggle}
            title={isOpen ? "Collapse orders panel" : "Expand orders panel"}
            aria-label={isOpen ? "Collapse orders" : "Expand orders"}
          >
            {isOpen ? "⌄" : "^"}
          </button>
        </div>
      </div>

      {/* Drawer Body (Table Content) */}
      {isOpen && (
        <div className="bod-body">
          {/* TAB 1: Positions (Open Trades) */}
          {tab === "positions" && (
            <div className="bod-table-wrap">
              {displayedPositions.length === 0 ? (
                <div className="bod-empty">No open positions</div>
              ) : (
                <table className="bod-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Pair</th>
                      <th>Side</th>
                      <th>Size</th>
                      <th>Entry Price</th>
                      <th>Mark Price</th>
                      <th>Total Value</th>
                      <th>Unrealized PnL</th>
                      <th>TP / SL</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedPositions.map((pos) => {
                      const pnl = getPositionPnl(pos);
                      return (
                        <tr key={pos.id}>
                          <td>{pos.date}</td>
                          <td className="bold">{pos.pair}</td>
                          <td>
                            <span
                              className={
                                "bod-side-badge " +
                                (pos.side === "BUY" ? "buy" : "sell")
                              }
                            >
                              {pos.side === "BUY" ? "LONG" : "SHORT"}
                            </span>
                          </td>
                          <td>
                            {pos.amount.toFixed(4)} {pos.coin}
                          </td>
                          <td>
                            $
                            {pos.entryPrice.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })}
                          </td>
                          <td>
                            $
                            {currentPrice.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })}
                          </td>
                          <td>
                            $
                            {(pos.entryPrice * pos.amount).toLocaleString(
                              undefined,
                              { minimumFractionDigits: 2 }
                            )}
                          </td>
                          <td
                            className={
                              pnl
                                ? pnl.tone === "up"
                                  ? "text-buy bold"
                                  : "text-sell bold"
                                : ""
                            }
                          >
                            {pnl ? pnl.str : "--"}
                          </td>
                          <td>
                            {pos.takeProfit || pos.stopLoss ? (
                              <span className="bod-tp-sl-tag">
                                {pos.takeProfit
                                  ? `TP $${pos.takeProfit.toLocaleString()}`
                                  : ""}
                                {pos.takeProfit && pos.stopLoss ? " / " : ""}
                                {pos.stopLoss
                                  ? `SL $${pos.stopLoss.toLocaleString()}`
                                  : ""}
                              </span>
                            ) : (
                              "--"
                            )}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="bod-close-pos-btn"
                              onClick={() => closePosition(pos.id, currentPrice)}
                              title="Close position at current market price"
                            >
                              Close Position
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 2: Open Orders (Pending Limit Orders) */}
          {tab === "open" && (
            <div className="bod-table-wrap">
              {displayedOrders.length === 0 ? (
                <div className="bod-empty">No open limit orders</div>
              ) : (
                <table className="bod-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Pair</th>
                      <th>Type</th>
                      <th>Side</th>
                      <th>Limit Price</th>
                      <th>Amount</th>
                      <th>Filled</th>
                      <th>Total</th>
                      <th>Trigger Conditions</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedOrders.map((o) => {
                      return (
                        <tr key={o.id}>
                          <td>{o.date}</td>
                          <td className="bold">{o.pair}</td>
                          <td>{o.type}</td>
                          <td>
                            <span
                              className={
                                "bod-side-badge " +
                                (o.side === "BUY" ? "buy" : "sell")
                              }
                            >
                              {o.side}
                            </span>
                          </td>
                          <td>
                            $
                            {o.price.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })}
                          </td>
                          <td>
                            {o.amount.toFixed(4)} {o.coin}
                          </td>
                          <td>{o.filled.toFixed(2)}%</td>
                          <td>
                            $
                            {o.total.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })}
                          </td>
                          <td>{o.trigger}</td>
                          <td>
                            <button
                              type="button"
                              className="bod-cancel-btn"
                              onClick={() => cancelOrder(o.id)}
                              title="Cancel limit order"
                            >
                              Cancel
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 3: Order History */}
          {tab === "history" && (
            <div className="bod-table-wrap">
              {displayedHistory.length === 0 ? (
                <div className="bod-empty">No order history</div>
              ) : (
                <table className="bod-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Pair</th>
                      <th>Type</th>
                      <th>Side</th>
                      <th>Price</th>
                      <th>Amount</th>
                      <th>Total</th>
                      <th>Status / PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedHistory.map((o) => {
                      return (
                        <tr key={o.id}>
                          <td>{o.date}</td>
                          <td className="bold">{o.pair}</td>
                          <td>{o.type}</td>
                          <td>
                            <span
                              className={
                                "bod-side-badge " +
                                (o.side === "BUY" ? "buy" : "sell")
                              }
                            >
                              {o.side}
                            </span>
                          </td>
                          <td>
                            $
                            {o.price.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })}
                          </td>
                          <td>
                            {o.amount.toFixed(4)} {o.coin}
                          </td>
                          <td>
                            $
                            {o.total.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })}
                          </td>
                          <td>
                            <span
                              className={
                                "bod-status " + o.status.toLowerCase()
                              }
                            >
                              {o.status}
                            </span>
                            {o.trigger && o.trigger !== "-" && (
                              <span className="bod-hist-trigger">
                                {" "}
                                {o.trigger}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 4: Trade History */}
          {tab === "trades" && (
            <div className="bod-table-wrap">
              {filledTrades.length === 0 ? (
                <div className="bod-empty">No trade history</div>
              ) : (
                <table className="bod-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Pair</th>
                      <th>Side</th>
                      <th>Executed Price</th>
                      <th>Filled Amount</th>
                      <th>Fee</th>
                      <th>Total</th>
                      <th>Execution Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filledTrades.map((o) => {
                      return (
                        <tr key={o.id}>
                          <td>{o.date}</td>
                          <td className="bold">{o.pair}</td>
                          <td>
                            <span
                              className={
                                "bod-side-badge " +
                                (o.side === "BUY" ? "buy" : "sell")
                              }
                            >
                              {o.side}
                            </span>
                          </td>
                          <td>
                            $
                            {o.price.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })}
                          </td>
                          <td>
                            {o.amount.toFixed(4)} {o.coin}
                          </td>
                          <td>${(o.total * 0.0005).toFixed(2)} (0.05%)</td>
                          <td>
                            $
                            {o.total.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })}
                          </td>
                          <td>
                            {o.trigger && o.trigger !== "-" ? (
                              <span className="text-buy bold">{o.trigger}</span>
                            ) : (
                              "Market Execution"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 5: Funds */}
          {tab === "funds" && (
            <div className="bod-table-wrap">
              <table className="bod-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Total Balance</th>
                    <th>Available</th>
                    <th>In Positions / Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(balances).map(([asset, bal]) => (
                    <tr key={asset}>
                      <td className="bold">{asset}</td>
                      <td>
                        {bal.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 6,
                        })}
                      </td>
                      <td>
                        {bal.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 6,
                        })}
                      </td>
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
