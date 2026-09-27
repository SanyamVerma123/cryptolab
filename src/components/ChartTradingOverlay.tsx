/**
 * ChartTradingOverlay — TradingView-style Live Trade, Position, TP & SL Lines on Chart
 *
 * Renders interactive horizontal position lines, Take Profit (TP) lines, and
 * Stop Loss (SL) lines directly on the chart canvas, synchronized with Vela's
 * price-to-pixel coordinate projection in real time.
 */
import { useEffect, useState } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import { useOrders, type Order } from "../lib/orderState";
import type { LiveData } from "../lib/useLiveData";

interface Props {
  ws: VelaWorkspace | null;
  coin: string;
  data: LiveData;
}

interface ProjectedLine {
  id: string;
  type: "position" | "tp" | "sl" | "limit";
  side: "BUY" | "SELL";
  price: number;
  y: number;
  label: string;
  pnl?: string;
  pnlTone?: "up" | "down";
  amount: number;
  coin: string;
  onCancel: () => void;
}

export function ChartTradingOverlay({ ws, coin, data }: Props) {
  const { orders, cancelOrder } = useOrders();
  const [lines, setLines] = useState<ProjectedLine[]>([]);

  const currentPrice = data.ctx?.markPx || data.ctx?.midPx || 0;

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

        const nextLines: ProjectedLine[] = [];

        for (const ord of activeOrders) {
          // Primary order/position line
          const y = r.coords.priceToY(ord.price, pane.scale, pane.bounds);
          if (y >= 0 && y <= dataH) {
            let pnlStr = "";
            let tone: "up" | "down" = "up";
            if (currentPrice > 0) {
              const diff = ord.side === "BUY" ? currentPrice - ord.price : ord.price - currentPrice;
              const pnlVal = diff * ord.amount;
              const pnlPct = (diff / ord.price) * 100;
              tone = pnlVal >= 0 ? "up" : "down";
              pnlStr = `${pnlVal >= 0 ? "+" : ""}$${pnlVal.toFixed(2)} (${pnlPct.toFixed(2)}%)`;
            }

            nextLines.push({
              id: ord.id,
              type: ord.type === "Market" ? "position" : "limit",
              side: ord.side,
              price: ord.price,
              y,
              label: `${ord.side} ${ord.amount} ${ord.coin} @ $${ord.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
              pnl: pnlStr,
              pnlTone: tone,
              amount: ord.amount,
              coin: ord.coin,
              onCancel: () => cancelOrder(ord.id),
            });
          }

          // If Stop-Limit trigger price is present
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
                  label: `Stop Trigger $${trigPx.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
                  amount: ord.amount,
                  coin: ord.coin,
                  onCancel: () => cancelOrder(ord.id),
                });
              }
            }
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
  }, [ws, coin, orders, currentPrice]);

  if (!lines.length) return null;

  return (
    <div className="chart-trading-overlay" aria-hidden="true">
      {lines.map((l) => (
        <div
          key={l.id}
          className={"chart-trade-line " + l.type + " " + l.side.toLowerCase()}
          style={{ top: `${l.y}px` }}
        >
          <div className="ctl-dash" />
          <div className="ctl-badge">
            <span className="ctl-side-tag">{l.type === "tp" ? "TP" : l.type === "sl" ? "SL" : l.side}</span>
            <span className="ctl-desc">{l.label}</span>
            {l.pnl && <span className={"ctl-pnl " + l.pnlTone}>{l.pnl}</span>}
            <button
              type="button"
              className="ctl-cancel-btn"
              title="Cancel / Close"
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
    </div>
  );
}
