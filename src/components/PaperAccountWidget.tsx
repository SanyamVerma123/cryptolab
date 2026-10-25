import { useState, useEffect, useRef } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import { getSafeActiveChart } from "../lib/workspaceSafe";
import { placeOrder, useOrders, type Balances } from "../lib/orderState";
import { getLiveMarketPrice } from "../lib/marketData";

interface Props {
  ws: VelaWorkspace | null;
  coin: string;
}

const AMOUNTS = [250, 500, 1000, 2500, 5000, 10000];

export function PaperAccountWidget({ ws, coin }: Props) {
  const { balances } = useOrders();
  const [usdAmount, setUsdAmount] = useState<number>(1000);
  const [amountMenuOpen, setAmountMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setAmountMenuOpen(false);
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const getPrice = (): number => {
    try {
      const chart = getSafeActiveChart(ws) as any;
      if (chart?.market?.price && chart.market.price > 0) return chart.market.price;
      const readout = chart?.renderer?.dataWindowReadout?.();
      if (readout?.ohlc?.close) return readout.ohlc.close;
    } catch {}
    return getLiveMarketPrice() || (coin === "BTC" ? 80600 : coin === "ETH" ? 2600 : 180);
  };

  const handleExecute = (side: "BUY" | "SELL") => {
    const p = getPrice();
    if (p <= 0) {
      setToastMsg("Price not available");
      setTimeout(() => setToastMsg(null), 2000);
      return;
    }

    const baseAmount = Math.max(0.0001, usdAmount / p);
    const res = placeOrder({
      coin,
      pair: `${coin}/USD`,
      type: "Market",
      side,
      price: p,
      amount: Math.round(baseAmount * 10000) / 10000,
      currentPrice: p,
    });

    if (res.ok) {
      setToastMsg(
        `${side === "BUY" ? "▲ Bought" : "▼ Sold"} ${baseAmount.toFixed(4)} ${coin} @ $${p.toLocaleString()}`
      );
    } else {
      setToastMsg(res.error || "Order failed");
    }
    setTimeout(() => setToastMsg(null), 2500);
  };

  const usdBalance = balances.USD ?? 50000;

  return (
    <div className="paper-account-widget" ref={menuRef}>
      {/* Account Info Pill */}
      <div className="paw-header" onClick={() => setAccountMenuOpen((v) => !v)}>
        <span className="paw-dot" />
        <span className="paw-label">Paper account · Simulated</span>
        <svg
          className={`paw-chevron${accountMenuOpen ? " open" : ""}`}
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M2 3.5L5 6.5L8 3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Execution Buttons & Value Selector */}
      <div className="paw-buttons">
        <button
          type="button"
          className="paw-btn paw-sell"
          onClick={() => handleExecute("SELL")}
          title={`Sell Market $${usdAmount.toLocaleString()} of ${coin}`}
        >
          Sell Market
        </button>

        <div className="paw-amount-wrap">
          <button
            type="button"
            className="paw-amount-trigger"
            onClick={() => setAmountMenuOpen((v) => !v)}
            title="Select order value"
          >
            <span>{usdAmount.toLocaleString()} USD</span>
            <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 3.5L5 6.5L8 3.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {amountMenuOpen && (
            <div className="paw-amount-dropdown">
              <div className="paw-amount-title">Order Amount</div>
              {AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  className={`paw-amount-option${usdAmount === amt ? " on" : ""}`}
                  onClick={() => {
                    setUsdAmount(amt);
                    setAmountMenuOpen(false);
                    setCustomAmount(false);
                  }}
                >
                  ${amt.toLocaleString()} USD
                </button>
              ))}
              <div className="paw-amount-custom">
                <input
                  type="number"
                  placeholder="Custom USD"
                  min="10"
                  step="50"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const val = parseFloat((e.target as HTMLInputElement).value);
                      if (val > 0) {
                        setUsdAmount(val);
                        setAmountMenuOpen(false);
                      }
                    }
                  }}
                />
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className="paw-btn paw-buy"
          onClick={() => handleExecute("BUY")}
          title={`Buy Market $${usdAmount.toLocaleString()} of ${coin}`}
        >
          Buy Market
        </button>
      </div>

      {/* Account Info Dropdown */}
      {accountMenuOpen && (
        <div className="paw-account-dropdown">
          <div className="paw-ad-head">
            <span className="paw-ad-title">Simulated Trading Account</span>
            <span className="paw-ad-badge">100% Free</span>
          </div>
          <div className="paw-ad-row">
            <span className="paw-ad-label">Cash Balance:</span>
            <span className="paw-ad-val">${Math.round(usdBalance).toLocaleString()} USD</span>
          </div>
          <div className="paw-ad-row">
            <span className="paw-ad-label">Current Coin:</span>
            <span className="paw-ad-val">{coin} (${getPrice().toLocaleString()})</span>
          </div>
          <div className="paw-ad-row">
            <span className="paw-ad-label">Max Leverage:</span>
            <span className="paw-ad-val">10x</span>
          </div>
          <div className="paw-ad-footer">
            <button
              type="button"
              className="paw-ad-orders-btn"
              onClick={() => {
                setAccountMenuOpen(false);
                window.dispatchEvent(new CustomEvent("tradepro:toggle-trading"));
              }}
            >
              View Open Orders & Positions
            </button>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMsg && (
        <div className="paw-toast" role="status">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
