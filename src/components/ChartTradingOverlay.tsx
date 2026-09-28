/**
 * ChartTradingOverlay — Exact TradingView Replica Chart Trading Overlay
 *
 * Implements:
 * 1. Portaled inside Vela's exact chart plot container (r.plot):
 *    - 1:1 pixel parity with candles and price scale (zero vertical offset at any zoom/aggregate).
 *    - Contained strictly within the chart plot area — NEVER overlaps the left drawing tools bar!
 * 2. Exact visual style for Target (Take Profit) & Stop Loss lines (Matching Image 1):
 *    - Target (TP) Line: Thin green line with [ {qty} │ +{estProfit} USD │ ✕ ] and green price chip.
 *    - Stop Loss (SL) Line: Thin orange line with [ {qty} │ -{estLoss} USD │ ✕ ] and orange price chip.
 *    - Trade Position Line: Solid line with [ ⇅ ] [ TP ] [ SL ] [ {qty} │ {pnl} USD │ ✕ ] (Image 1 & 5).
 *    - Limit Order Line: [ TP ] [ SL ] [ {qty} │ Buy limit │ ✕ ].
 * 3. Dragging vs. Cancel:
 *    - Clicking ✕ immediately cancels/closes without moving.
 *    - Moving requires holding for 400ms or dragging, so tap/clicks always work cleanly.
 * 4. Context Menu:
 *    - Removed the floating cursor plus button from price scale per user request.
 *    - Quick action menu opens cleanly on Double-Click (desktop) or Long-Press (mobile touch).
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import {
  useOrders,
  checkPriceTriggers,
  type Order,
  type TradePosition,
  type OrderSide,
} from "../lib/orderState";
import type { LiveData } from "../lib/useLiveData";
import {
  getLiveMarketPrice,
  getLiveCandleRange,
  subscribeLivePrice,
} from "../lib/marketData";

interface Props {
  ws: VelaWorkspace | null;
  coin: string;
  data: LiveData;
}

interface ProjectedPositionLine {
  id: string;
  side: "BUY" | "SELL";
  entryPrice: number;
  amount: number;
  coin: string;
  y: number;
  entryVisible: boolean;
  position: TradePosition;
  pnlStr: string;
  pnlTone: "up" | "down";
  tp?: number;
  tpY?: number;
  tpProfitStr?: string;
  tpVisible?: boolean;
  sl?: number;
  slY?: number;
  slLossStr?: string;
  slVisible?: boolean;
  slTone?: "up" | "down";
}

interface ProjectedOrderLine {
  id: string;
  type: "limit" | "stop";
  side: "BUY" | "SELL";
  price: number;
  amount: number;
  coin: string;
  y: number;
  entryVisible: boolean;
  order: Order;
  tp?: number;
  tpY?: number;
  tpProfitStr?: string;
  tpVisible?: boolean;
  sl?: number;
  slY?: number;
  slLossStr?: string;
  slVisible?: boolean;
  slTone?: "up" | "down";
}

interface ProjectedAlertLine {
  id: string;
  price: number;
  y: number;
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
  isPosition?: boolean;
}

interface ScaleChipItem {
  id: string;
  price: number;
  y: number;
}

/**
 * Price Scale Overlap Avoidance (TradingView Replica):
 * Detects if a price scale chip collides with the current market price block (~34px tall)
 * or with adjacent price chips on the price scale, and calculates a vertical translateY offset
 * so the chip sits cleanly stacked above or below without overlapping.
 */
function computeScaleChipOffsets(
  items: ScaleChipItem[],
  currentPrice: number,
  currentPriceY: number | null
): Record<string, number> {
  const offsets: Record<string, number> = {};
  if (!items.length) return offsets;

  const CHIP_H = 20;
  const HALF_CHIP = CHIP_H / 2; // 10px
  const CP_HALF_H = 17; // half-height of current price block with countdown
  const minDist = CHIP_H + 1; // 21px minimum clearance

  const resolved = new Map<string, number>();

  if (currentPriceY !== null) {
    const topObstacle = currentPriceY - CP_HALF_H - HALF_CHIP; // e.g. currentPriceY - 27
    const bottomObstacle = currentPriceY + CP_HALF_H + HALF_CHIP; // e.g. currentPriceY + 27

    // Above market: price >= currentPrice, screen Y is smaller (closer to 0)
    const aboveItems = items
      .filter((it) => it.price >= currentPrice)
      .sort((a, b) => a.price - b.price); // closest to current price first

    let currentTopLimit = topObstacle;
    for (const it of aboveItems) {
      if (it.y > topObstacle) {
        // Collides with or sits inside current price block -> stack above
        resolved.set(it.id, currentTopLimit);
        currentTopLimit -= minDist;
      } else if (it.y > currentTopLimit) {
        // Collides with previously stacked chip
        resolved.set(it.id, currentTopLimit);
        currentTopLimit -= minDist;
      } else {
        resolved.set(it.id, it.y);
        currentTopLimit = it.y - minDist;
      }
    }

    // Below market: price < currentPrice, screen Y is larger
    const belowItems = items
      .filter((it) => it.price < currentPrice)
      .sort((a, b) => b.price - a.price); // closest to current price first

    let currentBottomLimit = bottomObstacle;
    for (const it of belowItems) {
      if (it.y < bottomObstacle) {
        // Collides with or sits inside current price block -> stack below
        resolved.set(it.id, currentBottomLimit);
        currentBottomLimit += minDist;
      } else if (it.y < currentBottomLimit) {
        // Collides with previously stacked chip
        resolved.set(it.id, currentBottomLimit);
        currentBottomLimit += minDist;
      } else {
        resolved.set(it.id, it.y);
        currentBottomLimit = it.y + minDist;
      }
    }
  } else {
    for (const it of items) {
      resolved.set(it.id, it.y);
    }
  }

  for (const it of items) {
    const targetY = resolved.get(it.id) ?? it.y;
    const diff = targetY - it.y;
    if (Math.abs(diff) >= 1) {
      offsets[it.id] = Math.round(diff);
    }
  }

  return offsets;
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

  const [plotEl, setPlotEl] = useState<HTMLElement | null>(null);
  const [paneBounds, setPaneBounds] = useState<{ top: number; height: number; left: number; width: number }>({ top: 0, height: 400, left: 0, width: 0 });
  const [orderLines, setOrderLines] = useState<ProjectedOrderLine[]>([]);
  const [positionLines, setPositionLines] = useState<ProjectedPositionLine[]>([]);
  const [alertLines, setAlertLines] = useState<ProjectedAlertLine[]>([]);
  const [menu, setMenu] = useState<{ visible: boolean; x: number; y: number; price: number } | null>(null);
  const [alertFeedback, setAlertFeedback] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTargetState | null>(null);
  const [chipOffsets, setChipOffsets] = useState<Record<string, number>>({});

  const containerRef = useRef<HTMLDivElement | null>(null);
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdDragTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPos = useRef<{ x: number; y: number; time: number } | null>(null);

  const [fastLivePrice, setFastLivePrice] = useState<number>(() => getLiveMarketPrice());

  const currentPrice =
    fastLivePrice > 0
      ? fastLivePrice
      : getLiveMarketPrice() > 0
      ? getLiveMarketPrice()
      : data.trades?.[0]?.price || data.book?.mid || data.ctx?.markPx || data.ctx?.midPx || 0;

  // Find Vela's exact plot area container (r.plot gives 1:1 pixel parity)
  useEffect(() => {
    if (!ws) return;
    const findPlot = () => {
      try {
        const r = (ws.chart?.renderer as any)?.renderer;
        if (r?.plot && r.plot instanceof HTMLElement) {
          if (r.plot !== plotEl) setPlotEl(r.plot);
          return;
        }
        // Fallback strictly to candle container in vela-cell (never chart-host!)
        const cellCanvas = document.querySelector(".vela-cell canvas") as HTMLCanvasElement | null;
        if (cellCanvas?.parentElement && cellCanvas.parentElement instanceof HTMLElement) {
          if (cellCanvas.parentElement !== plotEl) setPlotEl(cellCanvas.parentElement);
          return;
        }
      } catch {}
    };
    findPlot();
    const interval = setInterval(findPlot, 300);
    return () => clearInterval(interval);
  }, [ws, plotEl]);

  // Run limit order matching engine and TP/SL execution continuously with 0ms latency
  useEffect(() => {
    if (tradingMode !== "in_app") return;

    const checkTriggers = (px: number) => {
      if (!px || px <= 0) return;
      const { filledOrders, closedPositions, triggeredAlerts } = checkPriceTriggers(coin, px);

      if (filledOrders.length > 0) {
        setAlertFeedback(
          `Filled: ${filledOrders[0].side} ${filledOrders[0].amount} ${coin} @ $${px.toLocaleString(undefined, { minimumFractionDigits: 2 })} (Now Open Position)`
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
    };

    // 1. Initial check with current market price
    const initPx = getLiveMarketPrice() || (currentPrice > 0 ? currentPrice : 0);
    if (initPx > 0) {
      checkTriggers(initPx);
    }

    // 2. Direct real-time WebSocket candle updates
    const unsub = subscribeLivePrice((px) => {
      setFastLivePrice(px);
      checkTriggers(px);
    });

    // 3. Fast 50ms continuous check safety net
    const interval = setInterval(() => {
      const p = getLiveMarketPrice() || data.livePrice || data.trades?.[0]?.price || fastLivePrice;
      if (p > 0) {
        checkTriggers(p);
      }
    }, 50);

    return () => {
      unsub();
      clearInterval(interval);
    };
  }, [coin, tradingMode]);

  // Real-time execution for direct trade tape ticks from WebSocket
  useEffect(() => {
    if (tradingMode !== "in_app") return;
    const px = data.livePrice || data.trades?.[0]?.price;
    if (px && px > 0) {
      const { filledOrders, closedPositions } = checkPriceTriggers(coin, px);
      if (filledOrders.length > 0) {
        setAlertFeedback(
          `Filled: ${filledOrders[0].side} ${filledOrders[0].amount} ${coin} @ $${px.toLocaleString(undefined, { minimumFractionDigits: 2 })} (Now Open Position)`
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
    }
  }, [coin, tradingMode, data.livePrice, data.trades]);

  // Project prices to exact pixel Y inside r.plot
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

        const paneTop = pane.bounds.top ?? 0;
        const paneH = pane.bounds.height ?? 400;
        const paneBottom = paneTop + paneH;
        const paneLeft = pane.bounds.left ?? 0;
        const paneW = pane.bounds.width ?? 0;

        setPaneBounds((prev) =>
          prev.top === paneTop && prev.height === paneH && prev.left === paneLeft && prev.width === paneW
            ? prev
            : { top: paneTop, height: paneH, left: paneLeft, width: paneW }
        );

        const normCoin = coin.toUpperCase().replace(/[^A-Z0-9]/g, "");

        // 1. Open Positions (Active Trades) - normalize symbol matching
        const activePositions = positions.filter((p) => {
          const pCoin = (p.coin || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
          const pPair = (p.pair || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
          return pCoin === normCoin || pPair.includes(normCoin);
        });
        const nextPositions: ProjectedPositionLine[] = [];

        for (const pos of activePositions) {
          const rawY = r.coords.priceToY(pos.entryPrice, pane.scale, pane.bounds);
          const y = rawY - paneTop;
          const entryVisible = rawY >= paneTop && rawY <= paneBottom;

          let pnlStr = "--";
          let tone: "up" | "down" = "up";
          if (currentPrice > 0) {
            const diff = pos.side === "BUY" ? currentPrice - pos.entryPrice : pos.entryPrice - currentPrice;
            const pnlVal = diff * pos.amount;
            tone = pnlVal >= 0 ? "up" : "down";
            pnlStr = `${pnlVal >= 0 ? "+" : ""}${pnlVal.toFixed(2)} USD`;
          }

          // Take Profit Line
          let tpY: number | undefined;
          let tpProfitStr: string | undefined;
          let tpVisible = false;
          if (pos.takeProfit && pos.takeProfit > 0) {
            const rawTpY = r.coords.priceToY(pos.takeProfit, pane.scale, pane.bounds);
            tpY = rawTpY - paneTop;
            tpVisible = rawTpY >= paneTop && rawTpY <= paneBottom;
            const tpDiff = Math.abs(pos.takeProfit - pos.entryPrice);
            tpProfitStr = `+ ${(tpDiff * pos.amount).toFixed(2)} USD`;
          }

          // Stop Loss Line (with Trailing Stop Loss in profit support)
          let slY: number | undefined;
          let slLossStr: string | undefined;
          let slVisible = false;
          let slTone: "up" | "down" = "down";
          if (pos.stopLoss && pos.stopLoss > 0) {
            const rawSlY = r.coords.priceToY(pos.stopLoss, pane.scale, pane.bounds);
            slY = rawSlY - paneTop;
            slVisible = rawSlY >= paneTop && rawSlY <= paneBottom;
            const slDiff = pos.side === "BUY" ? pos.stopLoss - pos.entryPrice : pos.entryPrice - pos.stopLoss;
            const slVal = slDiff * pos.amount;
            if (slVal >= 0) {
              slTone = "up";
              slLossStr = `+ ${slVal.toFixed(2)} USD`;
            } else {
              slTone = "down";
              slLossStr = `- ${Math.abs(slVal).toFixed(2)} USD`;
            }
          }

          // Only skip if entry, TP, and SL are all outside the visible price pane
          if (entryVisible || tpVisible || slVisible) {
            nextPositions.push({
              id: pos.id,
              side: pos.side,
              entryPrice: pos.entryPrice,
              amount: pos.amount,
              coin: pos.coin,
              y,
              entryVisible,
              position: pos,
              pnlStr,
              pnlTone: tone,
              tp: pos.takeProfit,
              tpY,
              tpProfitStr,
              tpVisible,
              sl: pos.stopLoss,
              slY,
              slLossStr,
              slVisible,
              slTone,
            });
          }
        }
        setPositionLines(nextPositions);

        // 2. Open Orders (Pending Limit Orders) - normalize symbol matching
        const activeOrders = orders.filter((o) => {
          if (o.status !== "Open") return false;
          const oCoin = (o.coin || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
          const oPair = (o.pair || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
          return oCoin === normCoin || oPair.includes(normCoin);
        });
        const nextOrders: ProjectedOrderLine[] = [];

        for (const ord of activeOrders) {
          if (dragTarget && dragTarget.id === ord.id && dragTarget.type === "order") continue;

          const rawY = r.coords.priceToY(ord.price, pane.scale, pane.bounds);
          const y = rawY - paneTop;
          const entryVisible = rawY >= paneTop && rawY <= paneBottom;

          let tpY: number | undefined;
          let tpProfitStr: string | undefined;
          let tpVisible = false;
          if (ord.takeProfit && ord.takeProfit > 0) {
            const rawTpY = r.coords.priceToY(ord.takeProfit, pane.scale, pane.bounds);
            tpY = rawTpY - paneTop;
            tpVisible = rawTpY >= paneTop && rawTpY <= paneBottom;
            const tpDiff = Math.abs(ord.takeProfit - ord.price);
            tpProfitStr = `+ ${(tpDiff * ord.amount).toFixed(2)} USD`;
          }

          let slY: number | undefined;
          let slLossStr: string | undefined;
          let slVisible = false;
          let slTone: "up" | "down" = "down";
          if (ord.stopLoss && ord.stopLoss > 0) {
            const rawSlY = r.coords.priceToY(ord.stopLoss, pane.scale, pane.bounds);
            slY = rawSlY - paneTop;
            slVisible = rawSlY >= paneTop && rawSlY <= paneBottom;
            const slDiff = ord.side === "BUY" ? ord.stopLoss - ord.price : ord.price - ord.stopLoss;
            const slVal = slDiff * ord.amount;
            if (slVal >= 0) {
              slTone = "up";
              slLossStr = `+ ${slVal.toFixed(2)} USD`;
            } else {
              slTone = "down";
              slLossStr = `- ${Math.abs(slVal).toFixed(2)} USD`;
            }
          }

          if (entryVisible || tpVisible || slVisible) {
            nextOrders.push({
              id: ord.id,
              type: ord.type === "Stop-Limit" ? "stop" : "limit",
              side: ord.side,
              price: ord.price,
              amount: ord.amount,
              coin: ord.coin,
              y,
              entryVisible,
              order: ord,
              tp: ord.takeProfit,
              tpY,
              tpProfitStr,
              tpVisible,
              sl: ord.stopLoss,
              slY,
              slLossStr,
              slVisible,
              slTone,
            });
          }
        }
        setOrderLines(nextOrders);

        // 3. Price Alerts
        const activeAlerts = alerts.filter((a) => {
          const aCoin = (a.coin || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
          const aPair = (a.pair || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
          return aCoin === normCoin || aPair.includes(normCoin);
        });
        const nextAlerts: ProjectedAlertLine[] = [];
        for (const alt of activeAlerts) {
          const rawY = r.coords.priceToY(alt.price, pane.scale, pane.bounds);
          if (rawY >= paneTop && rawY <= paneBottom) {
            nextAlerts.push({ id: alt.id, price: alt.price, y: rawY - paneTop });
          }
        }
        setAlertLines(nextAlerts);

        // 4. Calculate Price Scale Overlap Offsets (Avoid colliding with Current Price Block)
        const livePx = fastLivePrice || getLiveMarketPrice() || currentPrice;
        const rawCurrentPriceY = livePx > 0 ? r.coords.priceToY(livePx, pane.scale, pane.bounds) : null;
        const currentPriceY = rawCurrentPriceY !== null ? rawCurrentPriceY - paneTop : null;
        const chipsToResolve: ScaleChipItem[] = [];

        for (const pos of nextPositions) {
          if (pos.entryVisible) chipsToResolve.push({ id: `pos_${pos.id}`, price: pos.entryPrice, y: pos.y });
          if (pos.tp && pos.tpY !== undefined && pos.tpVisible) {
            chipsToResolve.push({ id: `pos_tp_${pos.id}`, price: pos.tp, y: pos.tpY });
          }
          if (pos.sl && pos.slY !== undefined && pos.slVisible) {
            chipsToResolve.push({ id: `pos_sl_${pos.id}`, price: pos.sl, y: pos.slY });
          }
        }

        for (const ord of nextOrders) {
          if (ord.entryVisible) chipsToResolve.push({ id: `ord_${ord.id}`, price: ord.price, y: ord.y });
          if (ord.tp && ord.tpY !== undefined && ord.tpVisible) {
            chipsToResolve.push({ id: `ord_tp_${ord.id}`, price: ord.tp, y: ord.tpY });
          }
          if (ord.sl && ord.slY !== undefined && ord.slVisible) {
            chipsToResolve.push({ id: `ord_sl_${ord.id}`, price: ord.sl, y: ord.slY });
          }
        }

        for (const alt of nextAlerts) {
          chipsToResolve.push({ id: `alt_${alt.id}`, price: alt.price, y: alt.y });
        }

        if (dragTarget) {
          chipsToResolve.push({ id: "drag_target", price: dragTarget.price, y: dragTarget.currentY });
        }

        const computedOffsets = computeScaleChipOffsets(chipsToResolve, livePx, currentPriceY);
        setChipOffsets((prev) => {
          const prevKeys = Object.keys(prev);
          const nextKeys = Object.keys(computedOffsets);
          if (prevKeys.length !== nextKeys.length) return computedOffsets;
          for (const k of nextKeys) {
            if (prev[k] !== computedOffsets[k]) return computedOffsets;
          }
          return prev;
        });
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

  // Convert client Y to Price using r.plot exact coordinates
  const getPriceAtY = useCallback(
    (clientY: number): number | null => {
      if (!ws) return null;
      try {
        const r = (ws.chart?.renderer as any)?.renderer;
        if (!r?.coords || !r?.scene?.panes) return null;
        let pane = r.scene.panes.get("price") || [...r.scene.panes.values()][0];
        if (!pane?.scale || !pane?.bounds) return null;

        const targetEl =
          plotEl ||
          r?.plot ||
          (document.querySelector(".vela-cell canvas")?.parentElement as HTMLElement | null);
        if (!targetEl) return null;
        const rect = targetEl.getBoundingClientRect();
        const relY = clientY - rect.top;

        return r.coords.yToPrice(relY, pane.scale, pane.bounds);
      } catch {
        return null;
      }
    },
    [ws, plotEl]
  );

  // Trigger quick context menu at client coordinates
  const triggerMenuAt = useCallback(
    (clientX: number, clientY: number) => {
      const host =
        plotEl ||
        (ws?.chart?.renderer as any)?.renderer?.plot ||
        (document.querySelector(".vela-cell canvas")?.parentElement as HTMLElement | null);
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
    [getPriceAtY, plotEl, ws]
  );

  // Double-click on chart or Long-press on mobile touch opens context menu
  useEffect(() => {
    const host =
      plotEl ||
      (ws?.chart?.renderer as any)?.renderer?.plot ||
      (document.querySelector(".vela-cell canvas")?.parentElement as HTMLElement | null);
    if (!host) return;

    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest(".tv-trade-line, .chart-ctx-menu, button, .mobile-draw-hud, .mobile-draw-cancel-btn")) return;
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
        }, 450);
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
      if ((e.target as HTMLElement).closest(".tv-trade-line, .chart-ctx-menu, button, .mobile-draw-hud, .mobile-draw-cancel-btn")) return;
      triggerMenuAt(e.clientX, e.clientY);
    };

    const onContextMenu = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(".tv-trade-line, .chart-ctx-menu, button")) return;
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
  }, [triggerMenuAt, plotEl, ws]);

  // DRAG LIMIT ORDER: Requires 850ms hold delay (near 1 sec) so taps on ✕ never accidentally move
  const handleOrderPointerDown = (e: React.PointerEvent, ord: Order) => {
    // If clicked on cross/cancel or button, do NOT initiate drag!
    if ((e.target as HTMLElement).closest("button, .tv-seg-cancel, .tv-btn-close")) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const targetEl = plotEl || containerRef.current;
    if (!targetEl) return;
    const rect = targetEl.getBoundingClientRect();
    const handleEl = e.currentTarget as HTMLElement;

    const startX = e.clientX;
    const startY = e.clientY;
    let dragActive = false;

    const startDrag = () => {
      dragActive = true;
      try {
        handleEl.setPointerCapture(e.pointerId);
        if (navigator.vibrate) navigator.vibrate(25);
      } catch {}

      const initY = (startY - rect.top) - paneBounds.top;
      const initPrice = getPriceAtY(startY) ?? ord.price;

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
    };

    // Hold 100ms to activate drag quickly (user request: 100ms out of 1000ms)
    holdDragTimer.current = setTimeout(startDrag, 100);

    const onMove = (ev: PointerEvent) => {
      if (!dragActive) {
        const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
        if (dist > 4) {
          if (holdDragTimer.current) {
            clearTimeout(holdDragTimer.current);
            holdDragTimer.current = null;
          }
          startDrag();
        }
        return;
      }

      ev.preventDefault();
      const cy = (ev.clientY - rect.top) - paneBounds.top;
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
      if (holdDragTimer.current) {
        clearTimeout(holdDragTimer.current);
        holdDragTimer.current = null;
      }
      try {
        handleEl.releasePointerCapture(e.pointerId);
      } catch {}
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);

      if (dragActive) {
        const finalPx = getPriceAtY(ev.clientY);
        if (finalPx && finalPx > 0) {
          const newPx = parseFloat(finalPx.toFixed(2));
          const res = updateOrderPrice(ord.id, newPx, currentPrice);
          if (res.ok) {
            setAlertFeedback(`Moved limit price to $${newPx.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
            setTimeout(() => setAlertFeedback(null), 3500);
          }
        }
        setDragTarget(null);
      }
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
  };

  // DRAG TP OR SL BADGE: Quick 100ms hold delay so taps on ✕ never accidentally move
  const handleBracketPointerDown = (
    e: React.PointerEvent,
    targetId: string,
    bracketType: "tp" | "sl",
    side: OrderSide,
    isPos = false
  ) => {
    if ((e.target as HTMLElement).closest("button, .tv-seg-cancel, .tv-btn-close")) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const targetEl = plotEl || containerRef.current;
    if (!targetEl) return;
    const rect = targetEl.getBoundingClientRect();
    const handleEl = e.currentTarget as HTMLElement;

    const startX = e.clientX;
    const startY = e.clientY;
    let dragActive = false;

    const startDrag = () => {
      dragActive = true;
      try {
        handleEl.setPointerCapture(e.pointerId);
        if (navigator.vibrate) navigator.vibrate(25);
      } catch {}

      const initY = (startY - rect.top) - paneBounds.top;
      const initPrice = getPriceAtY(startY) ?? currentPrice;

      setDragTarget({
        type: bracketType,
        id: targetId,
        initialY: initY,
        currentY: initY,
        price: parseFloat(initPrice.toFixed(2)),
        side,
        coin,
        isPosition: isPos,
      });
    };

    // Hold 100ms to activate bracket drag quickly without interfering with tap/cut
    holdDragTimer.current = setTimeout(startDrag, 100);

    const onMove = (ev: PointerEvent) => {
      if (!dragActive) {
        const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
        if (dist > 4) {
          if (holdDragTimer.current) {
            clearTimeout(holdDragTimer.current);
            holdDragTimer.current = null;
          }
          startDrag();
        }
        return;
      }

      ev.preventDefault();
      const cy = (ev.clientY - rect.top) - paneBounds.top;
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
      if (holdDragTimer.current) {
        clearTimeout(holdDragTimer.current);
        holdDragTimer.current = null;
      }
      try {
        handleEl.releasePointerCapture(e.pointerId);
      } catch {}
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);

      if (dragActive) {
        const finalPx = getPriceAtY(ev.clientY);
        if (finalPx && finalPx > 0) {
          const rawTarget = parseFloat(finalPx.toFixed(2));
          let entryPrice = 0;
          if (isPos) {
            const p = positions.find((pos) => pos.id === targetId);
            if (p) entryPrice = p.entryPrice;
          } else {
            const o = orders.find((ord) => ord.id === targetId);
            if (o) entryPrice = o.price;
          }

          if (bracketType === "tp") {
            // Trailing / Target Physics: TP cannot go below entry for BUY, or above entry for SELL
            let clampedTarget = rawTarget;
            if (entryPrice > 0) {
              if (side === "BUY") {
                clampedTarget = Math.max(entryPrice, rawTarget);
              } else {
                clampedTarget = Math.min(entryPrice, rawTarget);
              }
            }
            setOrderTP(targetId, clampedTarget);
            setAlertFeedback(`Take Profit set to $${clampedTarget.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
          } else {
            // Stop Loss can move past entry price into profit (Trailing Stop Loss)
            setOrderSL(targetId, rawTarget);
            const isProfit = entryPrice > 0 ? (side === "BUY" ? rawTarget > entryPrice : rawTarget < entryPrice) : false;
            setAlertFeedback(`Stop Loss ${isProfit ? "(Trailing Profit) " : ""}set to $${rawTarget.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
          }
          setTimeout(() => setAlertFeedback(null), 3500);
        }
        setDragTarget(null);
      }
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
  };

  // Context Menu Actions
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

  const overlayContent = (
    <div
      ref={containerRef}
      className="chart-trading-overlay inside-plot"
      style={{
        top: `${paneBounds.top}px`,
        height: `${paneBounds.height}px`,
        left: paneBounds.left > 0 ? `${paneBounds.left}px` : '0',
        right: '0',
        width: paneBounds.width > 0 ? `${paneBounds.width}px` : undefined,
        overflow: "hidden",
      }}
    >
      {/* ====================================================================
          1. OPEN TRADES (POSITIONS) — EXACT TRADINGVIEW (IMAGES 1 & 5)
          ==================================================================== */}
      {positionLines.map((pos) => {
        const isLong = pos.side === "BUY";
        const toneClass = isLong ? "long" : "short";

        return (
          <div key={pos.id}>
            {/* Position Entry Line - conditionally visible independently */}
            {pos.entryVisible && (
              <div
                className={`tv-trade-line position ${toneClass}`}
                style={{ top: `${pos.y}px` }}
              >
                <div className="tv-line-solid" />

                <div className="tv-line-badge-group">
                  {/* [ ⇅ ] Reverse Position Button */}
                  <button
                    type="button"
                    className="tv-btn-reverse"
                    title="Reverse Position"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      const res = reversePosition(pos.id, currentPrice);
                      if (res.ok) {
                        setAlertFeedback(`Reversed position to ${isLong ? "SHORT" : "LONG"}`);
                        setTimeout(() => setAlertFeedback(null), 3500);
                      }
                    }}
                  >
                    ⇅
                  </button>

                  {/* [ TP ] Badge */}
                  <span
                    className={`tv-bracket-badge tp ${pos.tp ? "active" : ""}`}
                    title="Drag to add / adjust take profit"
                    onPointerDown={(e) => handleBracketPointerDown(e, pos.id, "tp", pos.side, true)}
                  >
                    TP
                  </span>

                  {/* [ SL ] Badge */}
                  <span
                    className={`tv-bracket-badge sl ${pos.sl ? "active" : ""}`}
                    title="Drag to add / adjust stop loss"
                    onPointerDown={(e) => handleBracketPointerDown(e, pos.id, "sl", pos.side, true)}
                  >
                    SL
                  </span>

                  {/* [ 1 │ + 19.88 USD │ ✕ ] Main Position Pill (Image 2 Replica) */}
                  <div className={`tv-segmented-pill position ${toneClass}`}>
                    <span className="tv-seg-qty">{pos.amount}</span>
                    <span className="tv-seg-divider" />
                    <span className={`tv-seg-pnl ${pos.pnlTone}`}>{pos.pnlStr}</span>
                    <span className="tv-seg-divider" />
                    <button
                      type="button"
                      className="tv-seg-cancel"
                      title="Close position"
                      onPointerDown={(e) => e.stopPropagation()}
                      onPointerUp={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const res = closePosition(pos.id, currentPrice);
                        if (res.ok) {
                          setAlertFeedback(`Closed position @ $${currentPrice.toLocaleString()}`);
                          setTimeout(() => setAlertFeedback(null), 3500);
                        }
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Price Axis Entry Label (Image 2) */}
                <div
                  className={`tv-scale-price-chip ${toneClass}`}
                  style={
                    chipOffsets[`pos_${pos.id}`]
                      ? { transform: `translateY(${chipOffsets[`pos_${pos.id}`]}px)` }
                      : undefined
                  }
                >
                  {pos.entryPrice.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              </div>
            )}

            {/* Separate Take Profit (Target) Line - independent visibility */}
            {pos.tp && pos.tpY !== undefined && pos.tpVisible && (
              <div
                className="tv-trade-line tp-target"
                style={{ top: `${pos.tpY}px` }}
              >
                <div className="tv-line-solid tp" />
                <div className="tv-line-badge-group">
                  <div
                    className="tv-segmented-pill tp"
                    title="Drag to move Take Profit"
                    onPointerDown={(e) => handleBracketPointerDown(e, pos.id, "tp", pos.side, true)}
                  >
                    <span className="tv-seg-qty">{pos.amount}</span>
                    <span className="tv-seg-divider" />
                    <span className="tv-seg-target-pnl tp">{pos.tpProfitStr || `TP $${pos.tp}`}</span>
                    <span className="tv-seg-divider" />
                    <button
                      type="button"
                      className="tv-seg-cancel"
                      title="Remove Take Profit"
                      onPointerDown={(e) => e.stopPropagation()}
                      onPointerUp={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setOrderTP(pos.id, 0);
                        setAlertFeedback("Take Profit removed");
                        setTimeout(() => setAlertFeedback(null), 3000);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div
                  className="tv-scale-price-chip tp"
                  style={
                    chipOffsets[`pos_tp_${pos.id}`]
                      ? { transform: `translateY(${chipOffsets[`pos_tp_${pos.id}`]}px)` }
                      : undefined
                  }
                >
                  {pos.tp.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              </div>
            )}

            {/* Separate Stop Loss Line - independent visibility & trailing profit style */}
            {pos.sl && pos.slY !== undefined && pos.slVisible && (
              <div
                className={`tv-trade-line sl-stop ${pos.slTone === "up" ? "trailing-profit" : ""}`}
                style={{ top: `${pos.slY}px` }}
              >
                <div className="tv-line-solid sl" />
                <div className="tv-line-badge-group">
                  <div
                    className="tv-segmented-pill sl"
                    title="Drag to move Stop Loss"
                    onPointerDown={(e) => handleBracketPointerDown(e, pos.id, "sl", pos.side, true)}
                  >
                    <span className="tv-seg-qty">{pos.amount}</span>
                    <span className="tv-seg-divider" />
                    <span className="tv-seg-target-pnl sl">{pos.slLossStr || `SL $${pos.sl}`}</span>
                    <span className="tv-seg-divider" />
                    <button
                      type="button"
                      className="tv-seg-cancel"
                      title="Remove Stop Loss"
                      onPointerDown={(e) => e.stopPropagation()}
                      onPointerUp={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setOrderSL(pos.id, 0);
                        setAlertFeedback("Stop Loss removed");
                        setTimeout(() => setAlertFeedback(null), 3000);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div
                  className="tv-scale-price-chip sl"
                  style={
                    chipOffsets[`pos_sl_${pos.id}`]
                      ? { transform: `translateY(${chipOffsets[`pos_sl_${pos.id}`]}px)` }
                      : undefined
                  }
                >
                  {pos.sl.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* ====================================================================
          2. OPEN ORDERS (PENDING LIMIT ORDERS) (IMAGES 1–4)
          ==================================================================== */}
      {orderLines.map((ord) => {
        const isBuy = ord.side === "BUY";
        const toneClass = isBuy ? "buy" : "sell";

        return (
          <div key={ord.id}>
            {/* Limit Order Line - independent visibility */}
            {ord.entryVisible && (
              <div
                className={`tv-trade-line limit ${toneClass}`}
                style={{ top: `${ord.y}px` }}
              >
                <div className="tv-line-dashed" />

                <div className="tv-line-badge-group">
                  {/* [ TP ] dashed box */}
                  <span
                    className={`tv-bracket-badge tp ${ord.tp ? "active" : ""}`}
                    title="Drag to add take profit"
                    onPointerDown={(e) => handleBracketPointerDown(e, ord.id, "tp", ord.side, false)}
                  >
                    TP
                  </span>

                  {/* [ SL ] dashed box */}
                  <span
                    className={`tv-bracket-badge sl ${ord.sl ? "active" : ""}`}
                    title="Drag to add stop loss"
                    onPointerDown={(e) => handleBracketPointerDown(e, ord.id, "sl", ord.side, false)}
                  >
                    SL
                  </span>

                  <div className="tv-bracket-connector" />

                  {/* Segmented Pill: [ {qty} │ {Buy limit} │ ✕ ] — Move requires hold or drag */}
                  <div
                    className={`tv-segmented-pill ${toneClass}`}
                    title="Hold to move limit price"
                    onPointerDown={(e) => handleOrderPointerDown(e, ord.order)}
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
                      onPointerDown={(e) => e.stopPropagation()}
                      onPointerUp={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        cancelOrder(ord.id);
                        setAlertFeedback(`Canceled ${ord.side} order @ $${ord.price.toLocaleString()}`);
                        setTimeout(() => setAlertFeedback(null), 3000);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Exact Limit Price on Axis */}
                <div
                  className={`tv-scale-price-chip ${toneClass}`}
                  style={
                    chipOffsets[`ord_${ord.id}`]
                      ? { transform: `translateY(${chipOffsets[`ord_${ord.id}`]}px)` }
                      : undefined
                  }
                >
                  {ord.price.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              </div>
            )}

            {/* Separate Limit TP Line if set - independent visibility */}
            {ord.tp && ord.tpY !== undefined && ord.tpVisible && (
              <div className="tv-trade-line tp-target" style={{ top: `${ord.tpY}px` }}>
                <div className="tv-line-solid tp" />
                <div className="tv-line-badge-group">
                  <div
                    className="tv-segmented-pill tp"
                    onPointerDown={(e) => handleBracketPointerDown(e, ord.id, "tp", ord.side, false)}
                  >
                    <span className="tv-seg-qty">{ord.amount}</span>
                    <span className="tv-seg-divider" />
                    <span className="tv-seg-target-pnl tp">{ord.tpProfitStr || `TP $${ord.tp}`}</span>
                    <span className="tv-seg-divider" />
                    <button
                      type="button"
                      className="tv-seg-cancel"
                      onPointerDown={(e) => e.stopPropagation()}
                      onPointerUp={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setOrderTP(ord.id, 0);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div
                  className="tv-scale-price-chip tp"
                  style={
                    chipOffsets[`ord_tp_${ord.id}`]
                      ? { transform: `translateY(${chipOffsets[`ord_tp_${ord.id}`]}px)` }
                      : undefined
                  }
                >
                  {ord.tp.toFixed(2)}
                </div>
              </div>
            )}

            {/* Separate Limit SL Line if set - independent visibility & trailing profit style */}
            {ord.sl && ord.slY !== undefined && ord.slVisible && (
              <div
                className={`tv-trade-line sl-stop ${ord.slTone === "up" ? "trailing-profit" : ""}`}
                style={{ top: `${ord.slY}px` }}
              >
                <div className="tv-line-solid sl" />
                <div className="tv-line-badge-group">
                  <div
                    className="tv-segmented-pill sl"
                    onPointerDown={(e) => handleBracketPointerDown(e, ord.id, "sl", ord.side, false)}
                  >
                    <span className="tv-seg-qty">{ord.amount}</span>
                    <span className="tv-seg-divider" />
                    <span className="tv-seg-target-pnl sl">{ord.slLossStr || `SL $${ord.sl}`}</span>
                    <span className="tv-seg-divider" />
                    <button
                      type="button"
                      className="tv-seg-cancel"
                      onPointerDown={(e) => e.stopPropagation()}
                      onPointerUp={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setOrderSL(ord.id, 0);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div
                  className="tv-scale-price-chip sl"
                  style={
                    chipOffsets[`ord_sl_${ord.id}`]
                      ? { transform: `translateY(${chipOffsets[`ord_sl_${ord.id}`]}px)` }
                      : undefined
                  }
                >
                  {ord.sl.toFixed(2)}
                </div>
              </div>
            )}
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
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  removeAlert(alt.id);
                }}
              >
                ✕
              </button>
            </div>
          </div>
          <div
            className="tv-scale-price-chip alert"
            style={
              chipOffsets[`alt_${alt.id}`]
                ? { transform: `translateY(${chipOffsets[`alt_${alt.id}`]}px)` }
                : undefined
            }
          >
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
          <div
            className="tv-scale-price-chip active"
            style={
              chipOffsets["drag_target"]
                ? { transform: `translateY(${chipOffsets["drag_target"]}px)` }
                : undefined
            }
          >
            {dragTarget.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>
      )}

      {/* ====================================================================
          5. TOAST NOTIFICATION
          ==================================================================== */}
      {alertFeedback && (
        <div className="tv-toast-banner" role="alert">
          {alertFeedback}
        </div>
      )}

      {/* ====================================================================
          6. QUICK CONTEXT MENU (ONLY VISIBLE ON DOUBLE-CLICK / LONG-PRESS)
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

  // Only mount directly into the chart's exact plot area (r.plot inside vela-cell)
  if (plotEl) {
    return createPortal(overlayContent, plotEl);
  }

  return null;
}
