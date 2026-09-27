/**
 * ChartTradingOverlay — TradingView-style Chart Trading Lines & Context Menu
 *
 * Features:
 * 1. Clean line badges: shows ONLY "BUY", "SELL", "TP", "SL", or "ALERT" (no cluttered sentences)
 * 2. Left-click / Mobile Long-press Context Menu:
 *    - Click with mouse or long-press on touch (mobile/tablet) to open menu at that price coordinate
 *    - Options: "Buy @ $price", "Short @ $price", "Set Alert @ $price"
 *    - Places the order or alert and renders that specific line on the chart
 * 3. Real-time limit order matching:
 *    - Limit orders stay open until the live market price reaches/cuts them, then fills automatically!
 */
import { useEffect, useRef, useState, useCallback } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import { useOrders, checkPriceTriggers, type OrderSide } from "../lib/orderState";
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
  y: number;
  badgeText: string;
  pnl?: string;
  pnlTone?: "up" | "down";
  onCancel: () => void;
}

interface MenuState {
  visible: boolean;
  x: number;
  y: number;
  price: number;
}

export function ChartTradingOverlay({ ws, coin, data }: Props) {
  const { orders, alerts, cancelOrder, placeOrder, addAlert, removeAlert } = useOrders();
  const [lines, setLines] = useState<ProjectedLine[]>([]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [alertFeedback, setAlertFeedback] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPos = useRef<{ x: number; y: number; time: number } | null>(null);

  const currentPrice = data.ctx?.markPx || data.ctx?.midPx || 0;

  // Run limit order matching engine whenever current price updates
  useEffect(() => {
    if (currentPrice > 0) {
      const { filledOrders, triggeredAlerts } = checkPriceTriggers(coin, currentPrice);
      if (filledOrders.length > 0) {
        setAlertFeedback(
          `Filled: ${filledOrders[0].side} ${filledOrders[0].amount} ${coin} @ $${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
        );
        setTimeout(() => setAlertFeedback(null), 4000);
      }
      if (triggeredAlerts.length > 0) {
        setAlertFeedback(
          `🔔 Alert Triggered: ${coin} reached $${triggeredAlerts[0].price.toLocaleString(undefined, { minimumFractionDigits: 2 })}!`
        );
        setTimeout(() => setAlertFeedback(null), 5000);
      }
    }
  }, [currentPrice, coin]);

  // Project price coordinates to pixel Y
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
        const activeOrders = orders.filter(
          (o) => o.status === "Open" && (o.pair === currentPair || o.coin === coin)
        );
        const activeAlerts = alerts.filter(
          (a) => a.pair === currentPair || a.coin === coin
        );

        const nextLines: ProjectedLine[] = [];

        // 1. Order Lines (BUY / SELL)
        for (const ord of activeOrders) {
          const y = r.coords.priceToY(ord.price, pane.scale, pane.bounds);
          if (y >= 0 && y <= dataH) {
            let pnlStr = "";
            let tone: "up" | "down" = "up";
            if (currentPrice > 0 && ord.type === "Market") {
              const diff = ord.side === "BUY" ? currentPrice - ord.price : ord.price - currentPrice;
              const pnlVal = diff * ord.amount;
              const pnlPct = (diff / ord.price) * 100;
              tone = pnlVal >= 0 ? "up" : "down";
              pnlStr = `${pnlVal >= 0 ? "+" : ""}$${pnlVal.toFixed(2)} (${pnlPct.toFixed(1)}%)`;
            }

            // User requested: ONLY show BUY (or SELL) written rather than full information
            nextLines.push({
              id: ord.id,
              type: ord.type === "Market" ? "position" : "limit",
              side: ord.side,
              price: ord.price,
              y,
              badgeText: ord.side, // Only "BUY" or "SELL"
              pnl: pnlStr || undefined,
              pnlTone: tone,
              onCancel: () => cancelOrder(ord.id),
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

        // 2. Alert Lines (ALERT)
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
  }, [ws, coin, orders, alerts, currentPrice, cancelOrder, removeAlert]);

  // Convert pixel Y inside container to Price
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

  // Open context menu at coordinates
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

  // Capture left-click on desktop and long-press on mobile touch
  useEffect(() => {
    const host = containerRef.current?.closest(".chart-host") as HTMLElement | null;
    if (!host) return;

    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest(".ctl-badge, .chart-ctx-menu, button, .mobile-draw-hud, .mobile-draw-cancel-btn")) return;
      const startX = e.clientX;
      const startY = e.clientY;
      touchStartPos.current = { x: startX, y: startY, time: performance.now() };

      // Long-press on mobile / tablet touch (420ms)
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

    const onPointerUp = (e: PointerEvent) => {
      if (touchTimer.current) {
        clearTimeout(touchTimer.current);
        touchTimer.current = null;
      }
      if (!touchStartPos.current) return;
      const dist = Math.hypot(e.clientX - touchStartPos.current.x, e.clientY - touchStartPos.current.y);
      const duration = performance.now() - touchStartPos.current.time;
      touchStartPos.current = null;

      if ((e.target as HTMLElement).closest(".ctl-badge, .chart-ctx-menu, button, .mobile-draw-hud")) return;

      // Desktop left-click tap (<260ms, minimal movement)
      if (e.pointerType === "mouse" && e.button === 0 && dist < 5 && duration < 260) {
        triggerMenuAt(e.clientX, e.clientY);
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(".ctl-badge, .chart-ctx-menu, button")) return;
      e.preventDefault();
      triggerMenuAt(e.clientX, e.clientY);
    };

    host.addEventListener("pointerdown", onPointerDown, { capture: true });
    window.addEventListener("pointermove", onPointerMove, { capture: true });
    window.addEventListener("pointerup", onPointerUp, { capture: true });
    host.addEventListener("contextmenu", onContextMenu, { capture: true });

    return () => {
      host.removeEventListener("pointerdown", onPointerDown, { capture: true });
      window.removeEventListener("pointermove", onPointerMove, { capture: true });
      window.removeEventListener("pointerup", onPointerUp, { capture: true });
      host.removeEventListener("contextmenu", onContextMenu, { capture: true });
    };
  }, [getPriceAtY, triggerMenuAt]);

  // Menu action executions
  const handleMenuBuy = () => {
    if (!menu) return;
    const defaultAmount = currentPrice > 10000 ? 0.05 : currentPrice > 100 ? 1 : 10;
    placeOrder({
      coin,
      pair: `${coin}/USD`,
      type: "Limit",
      side: "BUY",
      price: menu.price,
      amount: defaultAmount,
      currentPrice,
    });
    setAlertFeedback(`Limit BUY @ $${menu.price.toLocaleString(undefined, { minimumFractionDigits: 2 })} placed`);
    setTimeout(() => setAlertFeedback(null), 3000);
    setMenu(null);
  };

  const handleMenuSell = () => {
    if (!menu) return;
    const defaultAmount = currentPrice > 10000 ? 0.05 : currentPrice > 100 ? 1 : 10;
    placeOrder({
      coin,
      pair: `${coin}/USD`,
      type: "Limit",
      side: "SELL",
      price: menu.price,
      amount: defaultAmount,
      currentPrice,
    });
    setAlertFeedback(`Limit SHORT @ $${menu.price.toLocaleString(undefined, { minimumFractionDigits: 2 })} placed`);
    setTimeout(() => setAlertFeedback(null), 3000);
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
    <div
      ref={containerRef}
      className="chart-trading-overlay"
    >
      {/* Visual Order & Alert Lines */}
      {lines.map((l) => (
        <div
          key={l.id}
          className={"chart-trade-line " + l.type + " " + l.side.toLowerCase()}
          style={{ top: `${l.y}px` }}
        >
          <div className="ctl-dash" />
          <div className="ctl-badge">
            {/* Show only BUY (or SELL, TP, SL, ALERT) without long verbose sentences */}
            <span className="ctl-side-tag">{l.badgeText}</span>
            {l.pnl && <span className={"ctl-pnl " + l.pnlTone}>{l.pnl}</span>}
            <button
              type="button"
              className="ctl-cancel-btn"
              title="Cancel / Remove"
              onClick={(e) => {
                e.stopPropagation();
                l.onCancel();
              }}
            >
              ✕
            </button>
          </div>
        </div>
      ))}

      {/* Alert / Execution Banner Feedback */}
      {alertFeedback && (
        <div className="chart-exec-toast" role="alert">
          {alertFeedback}
        </div>
      )}

      {/* TradingView-Style Interactive Context Action Menu */}
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
            <span>Buy {coin} @ ${menu.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </button>
          <button type="button" className="chart-ctx-item sell" onClick={handleMenuSell}>
            <span className="ctx-icon">▼</span>
            <span>Short {coin} @ ${menu.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </button>
          <button type="button" className="chart-ctx-item alert" onClick={handleMenuAlert}>
            <span className="ctx-icon">🔔</span>
            <span>Set Alert @ ${menu.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </button>
        </div>
      )}
    </div>
  );
}
