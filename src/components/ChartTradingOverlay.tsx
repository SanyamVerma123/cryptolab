/**
 * ChartTradingOverlay — Exact TradingView Replica Chart Trading Overlay
 *
 * Implements pixel-perfect TradingView visuals matching user-provided screenshots:
 * 1. Limit Order Lines (Image 1, 2, 3, 4):
 *    - Thin colored line (blue #2962ff for Buy Limit, red #f23645 for Sell/Stop Limit)
 *    - Attached components:
 *      • [ TP ] dashed box (green text, drag to add/adjust take profit)
 *      • [ SL ] dashed box (orange text, drag to add/adjust stop loss)
 *      • Dashed link connector
 *      • Segmented pill: [ {qty} | {Buy limit / Sell limit} | ✕ ]
 *      • Draggable to adjust price
 *      • Price axis label with exact price in colored chip
 * 2. Open Trade / Position Lines (Image 5):
 *    - Solid colored line (green #089981 for long, red #f23645 for short)
 *    - Attached components:
 *      • [ ⇅ ] Reverse position button
 *      • [ TP ] dashed box (green)
 *      • [ SL ] dashed box (orange)
 *      • [ {+qty / -qty} ] colored quantity badge
 *      • [ {+$0.85 USD} ] real-time unrealized PnL pill
 *      • [ ✕ ] close position button
 *      • Price axis label with exact entry price
 * 3. Price Scale [ ⊕ price ] Button (Image 1, 2, 3, 4, 5):
 *    - Follows cursor Y coordinate on the right price scale
 *    - Black/dark pill: [ ⊕ 84,524.09 ]
 *    - Left-click on desktop or touch long-press opens instant order/alert menu:
 *      • Buy at price
 *      • Sell at price
 *      • Set alert at price
 */
import { useEffect, useRef, useState, useCallback } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import {
  useOrders,
  checkPriceTriggers,
  type Order,
  type TradePosition,
  type OrderSide,
} from "../lib/orderState";
import type { LiveData } from "../lib/useLiveData";

interface Props {
  ws: VelaWorkspace | null;
  coin: string;
  data: LiveData;
}

interface ProjectedOrderLine {
  id: string;
  type: "limit" | "stop";
  side: "BUY" | "SELL";
  price: number;
  amount: number;
  coin: string;
  y: number;
  order: Order;
  tp?: number;
  sl?: number;
}

interface ProjectedPositionLine {
  id: string;
  side: "BUY" | "SELL";
  entryPrice: number;
  amount: number;
  coin: string;
  y: number;
  position: TradePosition;
  pnlStr: string;
  pnlTone: "up" | "down";
  tp?: number;
  sl?: number;
}

interface ProjectedAlertLine {
  id: string;
  price: number;
  y: number;
}

interface CursorScaleState {
  visible: boolean;
  y: number;
  price: number;
}

interface DragTargetState {
  type: "order" | "tp" | "sl";
  id: string;
  initialY: number;
  currentY: number;
  price: number;
  side: "BUY" | "SELL";
  amount?: number;
  coin: string;
}

export function ChartTradingOverlay({ ws, coin, data }: Props) {
  const {
    tradingMode,
    orders,
    positions,
    alerts,
    cancelOrder,
    placeOrder,
    updateOrderPrice,
    setOrderTP,
    setOrderSL,
    reversePosition,
    closePosition,
    addAlert,
    removeAlert,
  } = useOrders();

  const [orderLines, setOrderLines] = useState<ProjectedOrderLine[]>([]);
  const [positionLines, setPositionLines] = useState<ProjectedPositionLine[]>([]);
  const [alertLines, setAlertLines] = useState<ProjectedAlertLine[]>([]);
  const [cursorScale, setCursorScale] = useState<CursorScaleState | null>(null);
  const [menu, setMenu] = useState<{ visible: boolean; x: number; y: number; price: number } | null>(null);
  const [alertFeedback, setAlertFeedback] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTargetState | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPos = useRef<{ x: number; y: number; time: number } | null>(null);

  const currentPrice = data.ctx?.markPx || data.ctx?.midPx || 0;

  // Run limit order matching engine and TP/SL execution
  useEffect(() => {
    if (currentPrice > 0 && tradingMode === "in_app") {
      const { filledOrders, closedPositions, triggeredAlerts } = checkPriceTriggers(coin, currentPrice);

      if (filledOrders.length > 0) {
        setAlertFeedback(
          `Filled: ${filledOrders[0].side} ${filledOrders[0].amount} ${coin} @ $${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })} (Now Open Position)`
        );
        setTimeout(() => setAlertFeedback(null), 4000);
      }

      if (closedPositions.length > 0) {
        const cp = closedPositions[0];
        setAlertFeedback(
          `${cp.reason} Executed: Closed ${cp.position.side} ${cp.position.amount} ${coin} [PnL: ${cp.pnl >= 0 ? "+" : ""}$${cp.pnl.toFixed(2)}]`
        );
        setTimeout(() => setAlertFeedback(null), 4500);
      }

      if (triggeredAlerts.length > 0) {
        setAlertFeedback(
          `🔔 Alert Triggered: ${coin} reached $${triggeredAlerts[0].price.toLocaleString(undefined, { minimumFractionDigits: 2 })}!`
        );
        setTimeout(() => setAlertFeedback(null), 5000);
      }
    }
  }, [currentPrice, coin, tradingMode]);

  // Project prices to exact pixel Y on chart
  useEffect(() => {
    if (!ws) {
      setOrderLines([]);
      setPositionLines([]);
      setAlertLines([]);
      return;
    }

    let rafId: number;

    const updateProjections = () => {
      try {
        const r = (ws.chart?.renderer as any)?.renderer;
        if (!r?.coords || !r?.scene?.panes) return;

        let pane = r.scene.panes.get("price") || [...r.scene.panes.values()][0];
        if (!pane?.scale || !pane?.bounds) return;

        const dataH = r.coords.height || 400;
        const currentPair = `${coin}/USD`;

        // 1. Open Positions (Active Trades)
        const activePositions = positions.filter(
          (p) => p.pair === currentPair || p.coin === coin
        );
        const nextPositions: ProjectedPositionLine[] = [];

        for (const pos of activePositions) {
          const y = r.coords.priceToY(pos.entryPrice, pane.scale, pane.bounds);
          if (y >= 0 && y <= dataH) {
            let pnlStr = "--";
            let tone: "up" | "down" = "up";
            if (currentPrice > 0) {
              const diff = pos.side === "BUY" ? currentPrice - pos.entryPrice : pos.entryPrice - currentPrice;
              const pnlVal = diff * pos.amount;
              tone = pnlVal >= 0 ? "up" : "down";
              pnlStr = `${pnlVal >= 0 ? "+" : ""}${pnlVal.toFixed(2)} USD`;
            }

            nextPositions.push({
              id: pos.id,
              side: pos.side,
              entryPrice: pos.entryPrice,
              amount: pos.amount,
              coin: pos.coin,
              y,
              position: pos,
              pnlStr,
              pnlTone: tone,
              tp: pos.takeProfit,
              sl: pos.stopLoss,
            });
          }
        }
        setPositionLines(nextPositions);

        // 2. Open Orders (Pending Limit Orders)
        const activeOrders = orders.filter(
          (o) => o.status === "Open" && (o.pair === currentPair || o.coin === coin)
        );
        const nextOrders: ProjectedOrderLine[] = [];

        for (const ord of activeOrders) {
          if (dragTarget && dragTarget.id === ord.id && dragTarget.type === "order") continue;

          const y = r.coords.priceToY(ord.price, pane.scale, pane.bounds);
          if (y >= 0 && y <= dataH) {
            nextOrders.push({
              id: ord.id,
              type: ord.type === "Stop-Limit" ? "stop" : "limit",
              side: ord.side,
              price: ord.price,
              amount: ord.amount,
              coin: ord.coin,
              y,
              order: ord,
              tp: ord.takeProfit,
              sl: ord.stopLoss,
            });
          }
        }
        setOrderLines(nextOrders);

        // 3. Alerts
        const activeAlerts = alerts.filter(
          (a) => a.pair === currentPair || a.coin === coin
        );
        const nextAlerts: ProjectedAlertLine[] = [];
        for (const alt of activeAlerts) {
          const y = r.coords.priceToY(alt.price, pane.scale, pane.bounds);
          if (y >= 0 && y <= dataH) {
            nextAlerts.push({ id: alt.id, price: alt.price, y });
          }
        }
        setAlertLines(nextAlerts);
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
  }, [ws, coin, orders, positions, alerts, currentPrice, dragTarget]);

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

  // Trigger quick context menu at client coordinates
  const triggerMenuAt = useCallback(
    (clientX: number, clientY: number) => {
      const host = containerRef.current?.closest(".chart-host") as HTMLElement | null;
      if (!host) return;
      const rect = host.getBoundingClientRect();

      const price = getPriceAtY(clientY);
      if (!price || price <= 0) return;

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

  // Mouse move on chart: updates cursor [ ⊕ price ] button on price scale
  useEffect(() => {
    const host = containerRef.current?.closest(".chart-host") as HTMLElement | null;
    if (!host) return;

    const handlePointerMove = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest(".tv-trade-line, .tv-scale-plus-btn, .chart-ctx-menu, button")) return;
      const rect = host.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      const price = getPriceAtY(e.clientY);

      if (price && price > 0 && relY >= 0 && relY <= rect.height) {
        setCursorScale({
          visible: true,
          y: relY,
          price: parseFloat(price.toFixed(2)),
        });
      }
    };

    const handlePointerLeave = () => {
      setCursorScale(null);
    };

    host.addEventListener("pointermove", handlePointerMove);
    host.addEventListener("pointerleave", handlePointerLeave);

    return () => {
      host.removeEventListener("pointermove", handlePointerMove);
      host.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, [getPriceAtY]);

  // Double-click on chart or Long-press on mobile touch
  useEffect(() => {
    const host = containerRef.current?.closest(".chart-host") as HTMLElement | null;
    if (!host) return;

    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest(".tv-trade-line, .tv-scale-plus-btn, .chart-ctx-menu, button, .mobile-draw-hud, .mobile-draw-cancel-btn")) return;
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

    const onDblClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(".tv-trade-line, .tv-scale-plus-btn, .chart-ctx-menu, button, .mobile-draw-hud, .mobile-draw-cancel-btn")) return;
      triggerMenuAt(e.clientX, e.clientY);
    };

    const onContextMenu = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(".tv-trade-line, .tv-scale-plus-btn, .chart-ctx-menu, button")) return;
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

  // Dragging Limit Order Pill
  const startDragOrder = (e: React.PointerEvent, ord: Order) => {
    e.preventDefault();
    e.stopPropagation();
    const host = containerRef.current?.closest(".chart-host") as HTMLElement | null;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const handleEl = e.currentTarget;
    try {
      handleEl.setPointerCapture(e.pointerId);
    } catch {}

    const initY = e.clientY - rect.top;
    const initPrice = getPriceAtY(e.clientY) ?? ord.price;

    setDragTarget({
      type: "order",
      id: ord.id,
      initialY: initY,
      currentY: initY,
      price: parseFloat(initPrice.toFixed(2)),
      side: ord.side,
      amount: ord.amount,
      coin: ord.coin,
    });

    const onMove = (ev: PointerEvent) => {
      ev.preventDefault();
      const cy = ev.clientY - rect.top;
      const px = getPriceAtY(ev.clientY);
      setDragTarget((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          currentY: cy,
          price: px && px > 0 ? parseFloat(px.toFixed(2)) : prev.price,
        };
      });
    };

    const onUp = (ev: PointerEvent) => {
      try {
        handleEl.releasePointerCapture(ev.pointerId);
      } catch {}
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);

      const finalPx = getPriceAtY(ev.clientY);
      if (finalPx && finalPx > 0) {
        const newPx = parseFloat(finalPx.toFixed(2));
        const res = updateOrderPrice(ord.id, newPx, currentPrice);
        if (res.ok) {
          if (res.position) {
            setAlertFeedback(`⚡ Order executed into Open Position @ $${newPx.toLocaleString()}!`);
          } else {
            setAlertFeedback(`Moved limit price to $${newPx.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
          }
          setTimeout(() => setAlertFeedback(null), 3500);
        }
      }
      setDragTarget(null);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
  };

  // Dragging TP or SL Badge to set target
  const startDragBracket = (e: React.PointerEvent, targetId: string, bracketType: "tp" | "sl", side: OrderSide, currentVal?: number) => {
    e.preventDefault();
    e.stopPropagation();
    const host = containerRef.current?.closest(".chart-host") as HTMLElement | null;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const handleEl = e.currentTarget;
    try {
      handleEl.setPointerCapture(e.pointerId);
    } catch {}

    const initY = e.clientY - rect.top;
    const initPrice = getPriceAtY(e.clientY) ?? currentPrice;

    setDragTarget({
      type: bracketType,
      id: targetId,
      initialY: initY,
      currentY: initY,
      price: parseFloat(initPrice.toFixed(2)),
      side,
      coin,
    });

    const onMove = (ev: PointerEvent) => {
      ev.preventDefault();
      const cy = ev.clientY - rect.top;
      const px = getPriceAtY(ev.clientY);
      setDragTarget((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          currentY: cy,
          price: px && px > 0 ? parseFloat(px.toFixed(2)) : prev.price,
        };
      });
    };

    const onUp = (ev: PointerEvent) => {
      try {
        handleEl.releasePointerCapture(ev.pointerId);
      } catch {}
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);

      const finalPx = getPriceAtY(ev.clientY);
      if (finalPx && finalPx > 0) {
        const targetPrice = parseFloat(finalPx.toFixed(2));
        if (bracketType === "tp") {
          setOrderTP(targetId, targetPrice);
          setAlertFeedback(`Take Profit set to $${targetPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
        } else {
          setOrderSL(targetId, targetPrice);
          setAlertFeedback(`Stop Loss set to $${targetPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
        }
        setTimeout(() => setAlertFeedback(null), 3500);
      }
      setDragTarget(null);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
  };

  // Context Menu Execution
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
    setTimeout(() => setAlertFeedback(null), 3500);
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
    setTimeout(() => setAlertFeedback(null), 3500);
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
      {/* ====================================================================
          1. OPEN TRADES (POSITIONS) — EXACT TRADINGVIEW REPLICA (IMAGE 5)
          ==================================================================== */}
      {positionLines.map((pos) => {
        const isLong = pos.side === "BUY";
        const toneClass = isLong ? "long" : "short";

        return (
          <div
            key={pos.id}
            className={`tv-trade-line position ${toneClass}`}
            style={{ top: `${pos.y}px` }}
          >
            {/* Solid colored horizontal line across chart */}
            <div className="tv-line-solid" />

            {/* TradingView Position Control Badges */}
            <div className="tv-line-badge-group">
              {/* [ ⇅ ] Reverse Position button */}
              <button
                type="button"
                className="tv-btn-reverse"
                title="Reverse Position"
                onClick={() => {
                  const res = reversePosition(pos.id, currentPrice);
                  if (res.ok) {
                    setAlertFeedback(`Reversed position to ${isLong ? "SHORT" : "LONG"}`);
                    setTimeout(() => setAlertFeedback(null), 3500);
                  }
                }}
              >
                ⇅
              </button>

              {/* [ TP ] Take Profit Badge (Dashed green border, drag to set) */}
              <span
                className={`tv-bracket-badge tp ${pos.tp ? "active" : ""}`}
                title="Drag to add / adjust take profit"
                onPointerDown={(e) => startDragBracket(e, pos.id, "tp", pos.side, pos.tp)}
              >
                TP{pos.tp ? ` $${pos.tp.toLocaleString()}` : ""}
              </span>

              {/* [ SL ] Stop Loss Badge (Dashed orange border, drag to set) */}
              <span
                className={`tv-bracket-badge sl ${pos.sl ? "active" : ""}`}
                title="Drag to add / adjust stop loss"
                onPointerDown={(e) => startDragBracket(e, pos.id, "sl", pos.side, pos.sl)}
              >
                SL{pos.sl ? ` $${pos.sl.toLocaleString()}` : ""}
              </span>

              {/* [ -1 ] or [ +1 ] Position Size colored pill */}
              <span className={`tv-pos-qty-pill ${toneClass}`}>
                {isLong ? `+${pos.amount}` : `-${pos.amount}`}
              </span>

              {/* [ +0.85 USD ] Real-time Unrealized PnL badge */}
              <span className={`tv-pnl-pill ${pos.pnlTone}`}>
                {pos.pnlStr}
              </span>

              {/* [ ✕ ] Close position button */}
              <button
                type="button"
                className="tv-btn-close"
                title="Close position at market price"
                onClick={() => {
                  const res = closePosition(pos.id, currentPrice);
                  if (res.ok) {
                    setAlertFeedback(
                      `Closed ${pos.side} ${pos.amount} ${pos.coin} @ $${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })} [PnL: ${(res.pnl ?? 0) >= 0 ? "+" : ""}$${(res.pnl ?? 0).toFixed(2)}]`
                    );
                    setTimeout(() => setAlertFeedback(null), 4000);
                  }
                }}
              >
                ✕
              </button>
            </div>

            {/* Right Price Scale Entry Price Box (Image 5) */}
            <div className={`tv-scale-price-chip ${toneClass}`}>
              {pos.entryPrice.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
          </div>
        );
      })}

      {/* ====================================================================
          2. OPEN ORDERS (PENDING LIMIT ORDERS) — EXACT TRADINGVIEW (IMAGE 1-4)
          ==================================================================== */}
      {orderLines.map((ord) => {
        const isBuy = ord.side === "BUY";
        const toneClass = isBuy ? "buy" : "sell";

        return (
          <div
            key={ord.id}
            className={`tv-trade-line limit ${toneClass}`}
            style={{ top: `${ord.y}px` }}
          >
            {/* Colored horizontal dashed/dotted line */}
            <div className="tv-line-dashed" />

            {/* TradingView Limit Order Controls */}
            <div className="tv-line-badge-group">
              {/* [ TP ] dashed box */}
              <span
                className={`tv-bracket-badge tp ${ord.tp ? "active" : ""}`}
                title="Drag to add take profit"
                onPointerDown={(e) => startDragBracket(e, ord.id, "tp", ord.side, ord.tp)}
              >
                TP{ord.tp ? ` $${ord.tp.toLocaleString()}` : ""}
              </span>

              {/* [ SL ] dashed box */}
              <span
                className={`tv-bracket-badge sl ${ord.sl ? "active" : ""}`}
                title="Drag to add stop loss"
                onPointerDown={(e) => startDragBracket(e, ord.id, "sl", ord.side, ord.sl)}
              >
                SL{ord.sl ? ` $${ord.sl.toLocaleString()}` : ""}
              </span>

              {/* Dashed connector line */}
              <div className="tv-bracket-connector" />

              {/* Segmented Pill: [ {qty} | {Buy limit} | ✕ ] — Draggable! */}
              <div
                className={`tv-segmented-pill ${toneClass}`}
                title="Drag to move limit price"
                onPointerDown={(e) => startDragOrder(e, ord.order)}
              >
                <span className="tv-seg-qty">{ord.amount}</span>
                <span className="tv-seg-divider" />
                <span className="tv-seg-type">
                  {ord.type === "stop"
                    ? "Stop"
                    : isBuy
                    ? "Buy limit"
                    : "Sell limit"}
                </span>
                <span className="tv-seg-divider" />
                <button
                  type="button"
                  className="tv-seg-cancel"
                  title="Cancel order"
                  onClick={(e) => {
                    e.stopPropagation();
                    cancelOrder(ord.id);
                    setAlertFeedback(`Canceled ${ord.side} order @ $${ord.price.toLocaleString()}`);
                    setTimeout(() => setAlertFeedback(null), 3000);
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Right Price Scale Exact Limit Price Label */}
            <div className={`tv-scale-price-chip ${toneClass}`}>
              {ord.price.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
          </div>
        );
      })}

      {/* ====================================================================
          3. PRICE ALERTS
          ==================================================================== */}
      {alertLines.map((alt) => (
        <div key={alt.id} className="tv-trade-line alert" style={{ top: `${alt.y}px` }}>
          <div className="tv-line-dashed alert" />
          <div className="tv-line-badge-group">
            <div className="tv-alert-pill">
              <span>🔔 Alert</span>
              <button
                type="button"
                className="tv-seg-cancel"
                onClick={() => removeAlert(alt.id)}
              >
                ✕
              </button>
            </div>
          </div>
          <div className="tv-scale-price-chip alert">
            {alt.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>
      ))}

      {/* ====================================================================
          4. DRAGGING GHOST PREVIEW LINE
          ==================================================================== */}
      {dragTarget && (
        <div
          className={`tv-trade-line dragging ${dragTarget.side.toLowerCase()}`}
          style={{ top: `${dragTarget.currentY}px`, zIndex: 100 }}
        >
          <div className="tv-line-dashed active" />
          <div className="tv-line-badge-group">
            <div className="tv-drag-pill">
              <span className="tv-drag-icon">⠿</span>
              <span>
                {dragTarget.type === "tp"
                  ? "Take Profit"
                  : dragTarget.type === "sl"
                  ? "Stop Loss"
                  : `${dragTarget.side} Limit`}:
              </span>
              <span className="bold">${dragTarget.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              <span className="tv-drag-sub">Release to set</span>
            </div>
          </div>
          <div className="tv-scale-price-chip active">
            {dragTarget.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>
      )}

      {/* ====================================================================
          5. PRICE SCALE [ ⊕ price ] BUTTON (TRADINGVIEW SIGNATURE FEATURE)
          (Images 1, 2, 3, 4, 5 — Right click / left click / mobile longpress)
          ==================================================================== */}
      {cursorScale && cursorScale.visible && !dragTarget && (
        <div
          className="tv-scale-plus-btn"
          style={{ top: `${cursorScale.y}px` }}
          onClick={(e) => {
            e.stopPropagation();
            const host = containerRef.current?.closest(".chart-host") as HTMLElement | null;
            if (!host) return;
            const rect = host.getBoundingClientRect();
            triggerMenuAt(rect.width - 150, cursorScale.y + rect.top);
          }}
          title="Click to place order or alert at this price level"
        >
          <span className="tv-spb-icon">⊕</span>
          <span className="tv-spb-price">
            {cursorScale.price.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
      )}

      {/* ====================================================================
          6. ALERT / EXECUTION NOTIFICATION TOAST
          ==================================================================== */}
      {alertFeedback && (
        <div className="tv-toast-banner" role="alert">
          {alertFeedback}
        </div>
      )}

      {/* ====================================================================
          7. TRADINGVIEW QUICK CONTEXT ACTION MENU
          ==================================================================== */}
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
