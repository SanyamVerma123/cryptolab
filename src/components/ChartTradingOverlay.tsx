/**
 * ChartTradingOverlay — TradingView-style Chart Trading Lines & Context Menu
 *
 * Features:
 * 1. Open Trades (Positions) & Open Orders (Limit Orders) marked at precise chart price points:
 *    - Open Trades: Marked with solid line, concise "BUY" / "SELL" tag, entry price, live PnL, and close button.
 *    - Open Orders: Marked with dashed line, limit price, drag handle ("⠿"), and cancel button.
 * 2. Movable / Draggable Limit Orders:
 *    - Drag the limit order handle up or down directly on the chart to adjust price in real-time.
 *    - If dragged past current market price, it automatically executes into an Open Trade!
 * 3. Double-Click Context Menu (Desktop) & Long-Press (Mobile Touch):
 *    - Double click with mouse (or long-press on touch) opens the context menu at that exact chart price.
 *    - Quick options: "Buy @ $price", "Short @ $price", "Set Alert @ $price".
 * 4. Real-time limit order matching engine & TP/SL auto-execution.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import {
  useOrders,
  checkPriceTriggers,
  type Order,
  type TradePosition,
} from "../lib/orderState";
import type { LiveData } from "../lib/useLiveData";

interface Props {
  ws: VelaWorkspace | null;
  coin: string;
  data: LiveData;
}

interface ProjectedLine {
  id: string;
  type: "position" | "tp" | "sl" | "limit" | "alert";
  side: "BUY" | "SELL" | "ALERT";
  price: number;
  amount?: number;
  coin?: string;
  y: number;
  badgeText: string;
  pnl?: string;
  pnlTone?: "up" | "down";
  orderRef?: Order;
  positionRef?: TradePosition;
  onCancel?: () => void;
  onClose?: () => void;
}

interface MenuState {
  visible: boolean;
  x: number;
  y: number;
  price: number;
}

interface DraggingOrderState {
  id: string;
  side: "BUY" | "SELL";
  amount: number;
  coin: string;
  y: number;
  price: number;
}

export function ChartTradingOverlay({ ws, coin, data }: Props) {
  const {
    orders,
    positions,
    alerts,
    cancelOrder,
    placeOrder,
    updateOrderPrice,
    closePosition,
    addAlert,
    removeAlert,
  } = useOrders();

  const [lines, setLines] = useState<ProjectedLine[]>([]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [alertFeedback, setAlertFeedback] = useState<string | null>(null);
  const [draggingOrder, setDraggingOrder] = useState<DraggingOrderState | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPos = useRef<{ x: number; y: number; time: number } | null>(null);

  const currentPrice = data.ctx?.markPx || data.ctx?.midPx || 0;

  // Run limit order matching engine and TP/SL checks whenever current price updates
  useEffect(() => {
    if (currentPrice > 0) {
      const { filledOrders, closedPositions, triggeredAlerts } = checkPriceTriggers(coin, currentPrice);

      if (filledOrders.length > 0) {
        setAlertFeedback(
          `Filled: ${filledOrders[0].side} ${filledOrders[0].amount} ${coin} @ $${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })} (Now Open Trade)`
        );
        setTimeout(() => setAlertFeedback(null), 4500);
      }

      if (closedPositions.length > 0) {
        const cp = closedPositions[0];
        setAlertFeedback(
          `${cp.reason} Executed: Closed ${cp.position.side} ${cp.position.amount} ${coin} [PnL: ${cp.pnl >= 0 ? "+" : ""}$${cp.pnl.toFixed(2)}]`
        );
        setTimeout(() => setAlertFeedback(null), 5000);
      }

      if (triggeredAlerts.length > 0) {
        setAlertFeedback(
          `🔔 Alert Triggered: ${coin} reached $${triggeredAlerts[0].price.toLocaleString(undefined, { minimumFractionDigits: 2 })}!`
        );
        setTimeout(() => setAlertFeedback(null), 5000);
      }
    }
  }, [currentPrice, coin]);

  // Project price coordinates to pixel Y inside the chart container
  useEffect(() => {
    if (!ws) {
      setLines([]);
      return;
    }

    let rafId: number;

    const updateProjections = () => {
      try {
        const r = (ws.chart?.renderer as any)?.renderer;
        if (!r?.coords || !r?.scene?.panes) return;

        let pane = r.scene.panes.get("price");
        if (!pane) pane = [...r.scene.panes.values()][0];
        if (!pane?.scale || !pane?.bounds) return;

        const dataH = r.coords.height || 400;
        const currentPair = `${coin}/USD`;

        const activePositions = positions.filter(
          (p) => p.pair === currentPair || p.coin === coin
        );
        const activeOrders = orders.filter(
          (o) => o.status === "Open" && (o.pair === currentPair || o.coin === coin)
        );
        const activeAlerts = alerts.filter(
          (a) => a.pair === currentPair || a.coin === coin
        );

        const nextLines: ProjectedLine[] = [];

        // 1. Open Trades (Positions) at precise entry price point
        for (const pos of activePositions) {
          const y = r.coords.priceToY(pos.entryPrice, pane.scale, pane.bounds);
          if (y >= 0 && y <= dataH) {
            let pnlStr = "";
            let tone: "up" | "down" = "up";
            if (currentPrice > 0) {
              const diff = pos.side === "BUY" ? currentPrice - pos.entryPrice : pos.entryPrice - currentPrice;
              const pnlVal = diff * pos.amount;
              const pnlPct = (diff / pos.entryPrice) * 100;
              tone = pnlVal >= 0 ? "up" : "down";
              pnlStr = `${pnlVal >= 0 ? "+" : ""}$${pnlVal.toFixed(2)} (${pnlVal >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)`;
            }

            nextLines.push({
              id: pos.id,
              type: "position",
              side: pos.side,
              price: pos.entryPrice,
              amount: pos.amount,
              coin: pos.coin,
              y,
              badgeText: pos.side, // strictly "BUY" or "SELL" per user request
              pnl: pnlStr || undefined,
              pnlTone: tone,
              positionRef: pos,
              onClose: () => {
                const res = closePosition(pos.id, currentPrice);
                if (res.ok) {
                  setAlertFeedback(
                    `Closed ${pos.side} ${pos.amount} ${pos.coin} @ $${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })} [PnL: ${(res.pnl ?? 0) >= 0 ? "+" : ""}$${(res.pnl ?? 0).toFixed(2)}]`
                  );
                  setTimeout(() => setAlertFeedback(null), 4000);
                }
              },
            });
          }

          // Take Profit Line
          if (pos.takeProfit && pos.takeProfit > 0) {
            const tpy = r.coords.priceToY(pos.takeProfit, pane.scale, pane.bounds);
            if (tpy >= 0 && tpy <= dataH) {
              nextLines.push({
                id: pos.id + "_tp",
                type: "tp",
                side: pos.side,
                price: pos.takeProfit,
                y: tpy,
                badgeText: "TP",
                positionRef: pos,
              });
            }
          }

          // Stop Loss Line
          if (pos.stopLoss && pos.stopLoss > 0) {
            const sly = r.coords.priceToY(pos.stopLoss, pane.scale, pane.bounds);
            if (sly >= 0 && sly <= dataH) {
              nextLines.push({
                id: pos.id + "_sl",
                type: "sl",
                side: pos.side,
                price: pos.stopLoss,
                y: sly,
                badgeText: "SL",
                positionRef: pos,
              });
            }
          }
        }

        // 2. Open Orders (Pending Limit Orders) at precise limit price point (Movable)
        for (const ord of activeOrders) {
          // If this order is currently being dragged, don't project static line
          if (draggingOrder && draggingOrder.id === ord.id) continue;

          const y = r.coords.priceToY(ord.price, pane.scale, pane.bounds);
          if (y >= 0 && y <= dataH) {
            nextLines.push({
              id: ord.id,
              type: "limit",
              side: ord.side,
              price: ord.price,
              amount: ord.amount,
              coin: ord.coin,
              y,
              badgeText: ord.side, // "BUY" or "SELL"
              orderRef: ord,
              onCancel: () => {
                cancelOrder(ord.id);
                setAlertFeedback(`Canceled ${ord.side} Limit Order @ $${ord.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
                setTimeout(() => setAlertFeedback(null), 3000);
              },
            });
          }

          // If Stop-Limit trigger is present
          if (ord.type === "Stop-Limit" && ord.trigger && ord.trigger !== "-") {
            const trigPx = parseFloat(ord.trigger.replace(/[^\d.]/g, ""));
            if (trigPx > 0) {
              const ty = r.coords.priceToY(trigPx, pane.scale, pane.bounds);
              if (ty >= 0 && ty <= dataH) {
                nextLines.push({
                  id: ord.id + "_trig",
                  type: "sl",
                  side: ord.side,
                  price: trigPx,
                  y: ty,
                  badgeText: "SL",
                  onCancel: () => cancelOrder(ord.id),
                });
              }
            }
          }
        }

        // 3. Price Alerts
        for (const alt of activeAlerts) {
          const y = r.coords.priceToY(alt.price, pane.scale, pane.bounds);
          if (y >= 0 && y <= dataH) {
            nextLines.push({
              id: alt.id,
              type: "alert",
              side: "ALERT",
              price: alt.price,
              y,
              badgeText: `🔔 ALERT`,
              onCancel: () => removeAlert(alt.id),
            });
          }
        }

        setLines(nextLines);
      } catch {}
    };

    const loop = () => {
      updateProjections();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [ws, coin, orders, positions, alerts, currentPrice, draggingOrder, cancelOrder, closePosition, removeAlert]);

  // Convert pixel Y inside container to Chart Price
  const getPriceAtY = useCallback(
    (clientY: number): number | null => {
      if (!ws) return null;
      try {
        const r = (ws.chart?.renderer as any)?.renderer;
        if (!r?.coords || !r?.scene?.panes) return null;
        let pane = r.scene.panes.get("price") || [...r.scene.panes.values()][0];
        if (!pane?.scale || !pane?.bounds) return null;

        const host = containerRef.current?.closest(".chart-host") as HTMLElement | null;
        if (!host) return null;
        const rect = host.getBoundingClientRect();
        const relY = clientY - rect.top;

        return r.coords.yToPrice(relY, pane.scale, pane.bounds);
      } catch {
        return null;
      }
    },
    [ws]
  );

  // Open context menu at client coordinates
  const triggerMenuAt = useCallback(
    (clientX: number, clientY: number) => {
      const host = containerRef.current?.closest(".chart-host") as HTMLElement | null;
      if (!host) return;
      const rect = host.getBoundingClientRect();

      const price = getPriceAtY(clientY);
      if (!price || price <= 0) return;

      // Constrain popup inside chart bounds
      const posX = Math.min(clientX - rect.left, rect.width - 220);
      const posY = Math.min(clientY - rect.top, rect.height - 180);

      setMenu({
        visible: true,
        x: Math.max(10, posX),
        y: Math.max(10, posY),
        price: parseFloat(price.toFixed(2)),
      });
    },
    [getPriceAtY]
  );

  // Drag-and-drop limit order adjustment on chart
  const handleLimitDragStart = (e: React.PointerEvent, ord: Order) => {
    e.preventDefault();
    e.stopPropagation();

    const host = containerRef.current?.closest(".chart-host") as HTMLElement | null;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const handleEl = e.currentTarget;

    try {
      handleEl.setPointerCapture(e.pointerId);
    } catch {}

    const initialPx = getPriceAtY(e.clientY) ?? ord.price;

    setDraggingOrder({
      id: ord.id,
      side: ord.side,
      amount: ord.amount,
      coin: ord.coin,
      y: e.clientY - rect.top,
      price: parseFloat(initialPx.toFixed(2)),
    });

    const onPointerMove = (ev: PointerEvent) => {
      ev.preventDefault();
      const curY = ev.clientY - rect.top;
      const px = getPriceAtY(ev.clientY);
      setDraggingOrder((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          y: curY,
          price: px && px > 0 ? parseFloat(px.toFixed(2)) : prev.price,
        };
      });
    };

    const onPointerUp = (ev: PointerEvent) => {
      try {
        handleEl.releasePointerCapture(ev.pointerId);
      } catch {}
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);

      const finalPx = getPriceAtY(ev.clientY);
      if (finalPx && finalPx > 0) {
        const newPrice = parseFloat(finalPx.toFixed(2));
        const res = updateOrderPrice(ord.id, newPrice, currentPrice);
        if (res.ok) {
          if (res.position) {
            setAlertFeedback(
              `⚡ Limit order crossed market price and executed into an Open Trade (${ord.side} ${ord.amount} ${ord.coin} @ $${newPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })})!`
            );
          } else {
            setAlertFeedback(
              `Limit order moved to $${newPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
            );
          }
          setTimeout(() => setAlertFeedback(null), 4000);
        }
      }
      setDraggingOrder(null);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  // Event listeners:
  // 1. Double click on desktop opens context menu (single click does not)
  // 2. Long press on mobile touch (420ms) opens context menu
  // 3. Right-click contextmenu also opens it
  useEffect(() => {
    const host = containerRef.current?.closest(".chart-host") as HTMLElement | null;
    if (!host) return;

    // Mobile touch long-press detection
    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest(".ctl-badge, .chart-ctx-menu, button, .mobile-draw-hud, .mobile-draw-cancel-btn")) return;
      const startX = e.clientX;
      const startY = e.clientY;
      touchStartPos.current = { x: startX, y: startY, time: performance.now() };

      if (e.pointerType === "touch" || window.matchMedia("(pointer: coarse)").matches) {
        if (touchTimer.current) clearTimeout(touchTimer.current);
        touchTimer.current = setTimeout(() => {
          try {
            if (navigator.vibrate) navigator.vibrate(30);
          } catch {}
          triggerMenuAt(startX, startY);
          touchStartPos.current = null;
        }, 420);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!touchStartPos.current) return;
      const dist = Math.hypot(e.clientX - touchStartPos.current.x, e.clientY - touchStartPos.current.y);
      if (dist > 8) {
        if (touchTimer.current) {
          clearTimeout(touchTimer.current);
          touchTimer.current = null;
        }
      }
    };

    const onPointerUp = () => {
      if (touchTimer.current) {
        clearTimeout(touchTimer.current);
        touchTimer.current = null;
      }
      touchStartPos.current = null;
    };

    // User requested: Double Click triggers context menu on desktop
    const onDblClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(".ctl-badge, .chart-ctx-menu, button, .mobile-draw-hud, .mobile-draw-cancel-btn")) return;
      triggerMenuAt(e.clientX, e.clientY);
    };

    // Right-click context menu
    const onContextMenu = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(".ctl-badge, .chart-ctx-menu, button")) return;
      e.preventDefault();
      triggerMenuAt(e.clientX, e.clientY);
    };

    host.addEventListener("pointerdown", onPointerDown, { capture: true });
    window.addEventListener("pointermove", onPointerMove, { capture: true });
    window.addEventListener("pointerup", onPointerUp, { capture: true });
    host.addEventListener("dblclick", onDblClick, { capture: true });
    host.addEventListener("contextmenu", onContextMenu, { capture: true });

    return () => {
      host.removeEventListener("pointerdown", onPointerDown, { capture: true });
      window.removeEventListener("pointermove", onPointerMove, { capture: true });
      window.removeEventListener("pointerup", onPointerUp, { capture: true });
      host.removeEventListener("dblclick", onDblClick, { capture: true });
      host.removeEventListener("contextmenu", onContextMenu, { capture: true });
    };
  }, [triggerMenuAt]);

  // Context Menu Actions
  const handleMenuBuy = () => {
    if (!menu) return;
    const defaultAmount = currentPrice > 10000 ? 0.05 : currentPrice > 100 ? 1 : 10;
    const res = placeOrder({
      coin,
      pair: `${coin}/USD`,
      type: "Limit",
      side: "BUY",
      price: menu.price,
      amount: defaultAmount,
      currentPrice,
    });
    if (res.ok) {
      if (res.position) {
        setAlertFeedback(`Executed BUY @ $${menu.price.toLocaleString(undefined, { minimumFractionDigits: 2 })} (Open Trade)`);
      } else {
        setAlertFeedback(`Limit BUY @ $${menu.price.toLocaleString(undefined, { minimumFractionDigits: 2 })} placed`);
      }
      setTimeout(() => setAlertFeedback(null), 3500);
    }
    setMenu(null);
  };

  const handleMenuSell = () => {
    if (!menu) return;
    const defaultAmount = currentPrice > 10000 ? 0.05 : currentPrice > 100 ? 1 : 10;
    const res = placeOrder({
      coin,
      pair: `${coin}/USD`,
      type: "Limit",
      side: "SELL",
      price: menu.price,
      amount: defaultAmount,
      currentPrice,
    });
    if (res.ok) {
      if (res.position) {
        setAlertFeedback(`Executed SHORT @ $${menu.price.toLocaleString(undefined, { minimumFractionDigits: 2 })} (Open Trade)`);
      } else {
        setAlertFeedback(`Limit SHORT @ $${menu.price.toLocaleString(undefined, { minimumFractionDigits: 2 })} placed`);
      }
      setTimeout(() => setAlertFeedback(null), 3500);
    }
    setMenu(null);
  };

  const handleMenuAlert = () => {
    if (!menu) return;
    addAlert({
      coin,
      price: menu.price,
      pair: `${coin}/USD`,
    });
    setAlertFeedback(`🔔 Alert set at $${menu.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    setTimeout(() => setAlertFeedback(null), 3000);
    setMenu(null);
  };

  return (
    <div ref={containerRef} className="chart-trading-overlay">
      {/* 1. Visual Position, Limit Order & Alert Lines */}
      {lines.map((l) => {
        const isLimit = l.type === "limit";
        const isPos = l.type === "position";

        return (
          <div
            key={l.id}
            className={"chart-trade-line " + l.type + " " + l.side.toLowerCase()}
            style={{ top: `${l.y}px` }}
          >
            <div className="ctl-dash" />
            <div className="ctl-badge">
              {/* Movable Drag Handle for Limit Orders */}
              {isLimit && l.orderRef && (
                <span
                  className="ctl-drag-handle"
                  title="Drag up or down to adjust limit price"
                  onPointerDown={(e) => handleLimitDragStart(e, l.orderRef!)}
                >
                  ⠿
                </span>
              )}

              {/* Show only BUY (or SELL, TP, SL, ALERT) without long verbose sentences */}
              <span className="ctl-side-tag">{l.badgeText}</span>

              {/* Precise Price Tag */}
              <span className="ctl-price-tag">
                ${l.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>

              {/* Amount Tag */}
              {l.amount && (
                <span className="ctl-amount-tag">
                  {l.amount.toFixed(4)} {l.coin}
                </span>
              )}

              {/* Real-time PnL chip for Open Trades (Positions) */}
              {l.pnl && <span className={"ctl-pnl " + l.pnlTone}>{l.pnl}</span>}

              {/* Close Position Button */}
              {isPos && l.onClose && (
                <button
                  type="button"
                  className="ctl-close-pos-btn"
                  title="Close Position @ Market Price"
                  onClick={(e) => {
                    e.stopPropagation();
                    l.onClose?.();
                  }}
                >
                  ✕ Close
                </button>
              )}

              {/* Cancel Limit Order / Alert Button */}
              {!isPos && l.onCancel && (
                <button
                  type="button"
                  className="ctl-cancel-btn"
                  title="Cancel / Remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    l.onCancel?.();
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* 2. Draggable Ghost Preview Line while user is moving a Limit Order */}
      {draggingOrder && (
        <div
          className={"chart-trade-line limit dragging " + draggingOrder.side.toLowerCase()}
          style={{ top: `${draggingOrder.y}px`, zIndex: 30 }}
        >
          <div className="ctl-dash dragging" />
          <div className="ctl-badge dragging">
            <span className="ctl-drag-handle active">⠿</span>
            <span className="ctl-side-tag">{draggingOrder.side}</span>
            <span className="ctl-price-tag bold">
              ${draggingOrder.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
            <span className="ctl-drag-hint">
              {(draggingOrder.side === "BUY" && draggingOrder.price >= currentPrice) ||
              (draggingOrder.side === "SELL" && draggingOrder.price <= currentPrice)
                ? "⚡ Cuts Market Price (Will execute immediately!)"
                : "Release to place"}
            </span>
          </div>
        </div>
      )}

      {/* 3. Alert / Execution Banner Toast */}
      {alertFeedback && (
        <div className="chart-exec-toast" role="alert">
          {alertFeedback}
        </div>
      )}

      {/* 4. TradingView-Style Interactive Context Menu (Double Click / Mobile Long Press) */}
      {menu && menu.visible && (
        <div
          className="chart-ctx-menu"
          style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="chart-ctx-head">
            <span className="ctx-price">
              ${menu.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
            <button
              type="button"
              className="ctx-close"
              onClick={() => setMenu(null)}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <button type="button" className="chart-ctx-item buy" onClick={handleMenuBuy}>
            <span className="ctx-icon">▲</span>
            <span>
              Buy {coin} @ ${menu.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </button>
          <button type="button" className="chart-ctx-item sell" onClick={handleMenuSell}>
            <span className="ctx-icon">▼</span>
            <span>
              Short {coin} @ ${menu.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </button>
          <button type="button" className="chart-ctx-item alert" onClick={handleMenuAlert}>
            <span className="ctx-icon">🔔</span>
            <span>
              Set Alert @ ${menu.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
