/**
 * BottomOrdersDrawer — Binance-style Bottom Orders & Positions Drawer
 *
 * Sits docked at the bottom of the chart area. Features Open Orders, Order History,
 * Trade History, Funds, "Hide Other Pairs", "Cancel All", draggable height resize bar,
 * and an expand/collapse chevron button ("^" / "⌄") at the bottom-right corner.
 */
import { useState } from "react";
import { useOrders } from "../lib/orderState";

interface Props {
  currentCoin: string;
  isOpen: boolean;
  onToggle: () => void;
  onResize?: () => void;
}

type BottomTab = "open" | "history" | "trades" | "funds";

export function BottomOrdersDrawer({ currentCoin, isOpen, onToggle, onResize }: Props) {
  const { orders, history, balances, cancelOrder, cancelAllOrders } = useOrders();
  const [tab, setTab] = useState<BottomTab>("open");
  const [hideOtherPairs, setHideOtherPairs] = useState(false);

  const [drawerHeight, setDrawerHeight] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("tradepro_bottom_orders_height");
      return saved ? parseInt(saved, 10) : 220;
    } catch {
      return 220;
    }
  });

  const currentPair = `${currentCoin}/USD`;

  // Filter orders if "Hide Other Pairs" is enabled
  const displayedOrders = hideOtherPairs
    ? orders.filter((o) => o.pair === currentPair || o.coin === currentCoin)
    : orders;

  const displayedHistory = hideOtherPairs
    ? history.filter((o) => o.pair === currentPair || o.coin === currentCoin)
    : history;

  const filledTrades = displayedHistory.filter((o) => o.status === "Filled");

  const openCount = displayedOrders.length;

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
      const newH = Math.max(80, Math.min(maxH, startH + dy));
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
          <label className="bod-checkbox-label">
            <input
              type="checkbox"
              checked={hideOtherPairs}
              onChange={(e) => setHideOtherPairs(e.target.checked)}
            />
            <span>Hide Other Pairs</span>
          </label>

          {tab === "open" && openCount > 0 && (
            <button
              type="button"
              className="bod-cancel-all-btn"
              onClick={() => cancelAllOrders(hideOtherPairs ? currentPair : undefined)}
              title="Cancel all listed open orders"
            >
              Cancel All
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
          {tab === "open" && (
            <div className="bod-table-wrap">
              {displayedOrders.length === 0 ? (
                <div className="bod-empty">No open orders</div>
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
                      <th>Filled</th>
                      <th>Total</th>
                      <th>Trigger Conditions</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedOrders.map((o) => (
                      <tr key={o.id}>
                        <td>{o.date}</td>
                        <td className="bold">{o.pair}</td>
                        <td>{o.type}</td>
                        <td className={o.side === "BUY" ? "text-buy" : "text-sell"}>
                          {o.side}
                        </td>
                        <td>${o.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td>{o.amount.toFixed(4)} {o.coin}</td>
                        <td>{o.filled.toFixed(2)}%</td>
                        <td>${o.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td>{o.trigger}</td>
                        <td>
                          <button
                            type="button"
                            className="bod-cancel-btn"
                            onClick={() => cancelOrder(o.id)}
                            title="Cancel order"
                          >
                            Cancel
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

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
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedHistory.map((o) => (
                      <tr key={o.id}>
                        <td>{o.date}</td>
                        <td className="bold">{o.pair}</td>
                        <td>{o.type}</td>
                        <td className={o.side === "BUY" ? "text-buy" : "text-sell"}>
                          {o.side}
                        </td>
                        <td>${o.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td>{o.amount.toFixed(4)} {o.coin}</td>
                        <td>${o.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td>
                          <span className={"bod-status " + o.status.toLowerCase()}>
                            {o.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

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
                    </tr>
                  </thead>
                  <tbody>
                    {filledTrades.map((o) => (
                      <tr key={o.id}>
                        <td>{o.date}</td>
                        <td className="bold">{o.pair}</td>
                        <td className={o.side === "BUY" ? "text-buy" : "text-sell"}>
                          {o.side}
                        </td>
                        <td>${o.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td>{o.amount.toFixed(4)} {o.coin}</td>
                        <td>${(o.total * 0.0005).toFixed(2)} (0.05%)</td>
                        <td>${o.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === "funds" && (
            <div className="bod-table-wrap">
              <table className="bod-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Total Balance</th>
                    <th>Available</th>
                    <th>In Order</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(balances).map(([asset, bal]) => (
                    <tr key={asset}>
                      <td className="bold">{asset}</td>
                      <td>{bal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</td>
                      <td>{bal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</td>
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
