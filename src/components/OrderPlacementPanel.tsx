/**
 * OrderPlacementPanel — Binance-style Order Placement Panel with Alpaca Bracket Orders (TP/SL)
 *
 * Implements spot/perp order execution with Limit, Market, and Stop-Limit orders,
 * Take Profit & Stop Loss brackets, Alpaca API integration, and real-time balance calculations.
 */
import { useEffect, useState } from "react";
import { useOrders, type OrderSide, type OrderType } from "../lib/orderState";
import { getAlpacaConfig, submitAlpacaOrder } from "../lib/alpaca";
import type { LiveData } from "../lib/useLiveData";

interface Props {
  coin: string;
  data: LiveData;
  onOrderPlaced?: () => void;
  onOpenSettings?: () => void;
}

export function OrderPlacementPanel({ coin, data, onOrderPlaced, onOpenSettings }: Props) {
  const { balances, placeOrder, depositAsset } = useOrders();
  const [side, setSide] = useState<OrderSide>("BUY");
  const [type, setType] = useState<OrderType>("Limit");

  const currentPrice = data.ctx?.markPx || data.ctx?.midPx || 65000;

  const [priceInput, setPriceInput] = useState<string>("");
  const [amountInput, setAmountInput] = useState<string>("");
  const [percent, setPercent] = useState<number | null>(null);

  // Take Profit & Stop Loss toggles
  const [tpEnabled, setTpEnabled] = useState(false);
  const [tpInput, setTpInput] = useState<string>("");
  const [slEnabled, setSlEnabled] = useState(false);
  const [slInput, setSlInput] = useState<string>("");

  const [postOnly, setPostOnly] = useState(false);
  const [tif, setTif] = useState<"GTC" | "IOC" | "FOK">("GTC");
  const [message, setMessage] = useState<{ text: string; tone: "up" | "down" } | null>(null);

  const alpacaConfig = getAlpacaConfig();
  const hasAlpaca = Boolean(alpacaConfig.keyId && alpacaConfig.secretKey);

  // Sync initial price input when coin or mark price changes
  useEffect(() => {
    if (currentPrice && (!priceInput || type === "Market")) {
      setPriceInput(currentPrice.toFixed(2));
    }
  }, [coin, currentPrice, type]);

  // Auto-calculate default TP & SL targets when price changes
  useEffect(() => {
    if (currentPrice > 0) {
      if (side === "BUY") {
        setTpInput((currentPrice * 1.05).toFixed(2));
        setSlInput((currentPrice * 0.96).toFixed(2));
      } else {
        setTpInput((currentPrice * 0.95).toFixed(2));
        setSlInput((currentPrice * 1.04).toFixed(2));
      }
    }
  }, [currentPrice, side]);

  const priceNum = parseFloat(priceInput) || currentPrice || 0;
  const amountNum = parseFloat(amountInput) || 0;
  const total = type === "Market" ? currentPrice * amountNum : priceNum * amountNum;

  const availableUsd = balances.USD ?? 0;
  const availableCoin = balances[coin] ?? 0;

  // Percentage allocation button (25%, 50%, 75%, 100%)
  const handlePercentSelect = (pct: number) => {
    setPercent(pct);
    if (side === "BUY") {
      const budget = availableUsd * (pct / 100);
      const effectivePrice = type === "Market" ? currentPrice : priceNum;
      if (effectivePrice > 0) {
        const amt = budget / effectivePrice;
        setAmountInput(amt < 1 ? amt.toFixed(4) : amt.toFixed(2));
      }
    } else {
      const amt = availableCoin * (pct / 100);
      setAmountInput(amt < 1 ? amt.toFixed(4) : amt.toFixed(2));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    const effPrice = type === "Market" ? currentPrice : priceNum;
    if (amountNum <= 0) {
      setMessage({ text: "Please enter a valid amount", tone: "down" });
      return;
    }

    const tpPrice = tpEnabled ? parseFloat(tpInput) : undefined;
    const slPrice = slEnabled ? parseFloat(slInput) : undefined;

    // If Alpaca keys configured, submit to Alpaca API
    if (hasAlpaca) {
      const alpacaType = type === "Limit" ? "limit" : type === "Market" ? "market" : "stop_limit";
      const alpacaRes = await submitAlpacaOrder({
        symbol: `${coin}/USD`,
        qty: amountNum,
        side: side === "BUY" ? "buy" : "sell",
        type: alpacaType,
        limitPrice: type === "Limit" ? effPrice : undefined,
        takeProfitPrice: tpPrice,
        stopLossPrice: slPrice,
        timeInForce: tif.toLowerCase() as any,
      });

      if (!alpacaRes.ok) {
        console.warn("[trade-pro] Alpaca order fallback to local simulation:", alpacaRes.error);
        // Inform user and also record locally
        setMessage({
          text: `Alpaca: ${alpacaRes.error || "Order rejected"} (simulated locally)`,
          tone: "down",
        });
      }
    }

    // Always register in local order store for chart visual lines & bottom drawer
    const res = placeOrder({
      coin,
      pair: `${coin}/USD`,
      type,
      side,
      price: effPrice,
      amount: amountNum,
      trigger: slPrice ? `SL $${slPrice}` : tpPrice ? `TP $${tpPrice}` : "-",
    });

    if (!res.ok) {
      setMessage({ text: res.error || "Order failed", tone: "down" });
    } else {
      setMessage({
        text: `${side} ${amountNum} ${coin} placed @ $${effPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}${tpPrice ? ` [TP: $${tpPrice}]` : ""}${slPrice ? ` [SL: $${slPrice}]` : ""}`,
        tone: "up",
      });
      setAmountInput("");
      setPercent(null);
      onOrderPlaced?.();
      setTimeout(() => setMessage(null), 4500);
    }
  };

  return (
    <div className="order-placement-panel" aria-label="Place order">
      {/* Header title & API status */}
      <div className="op-head">
        <div className="op-title-wrap">
          <span className="op-title">Place Order</span>
          <button
            type="button"
            className={"op-api-badge" + (hasAlpaca ? " connected" : "")}
            onClick={onOpenSettings}
            title={hasAlpaca ? `Connected to Alpaca (${alpacaConfig.isPaper ? "Paper" : "Live"}). Click to configure.` : "Alpaca API not configured. Click to add API keys."}
          >
            <span className="op-badge-dot">●</span>
            {hasAlpaca ? (alpacaConfig.isPaper ? "Alpaca Paper" : "Alpaca Live") : "Simulator"}
          </button>
        </div>
        <div className="op-badges">
          <span className="op-vip">VIP 0</span>
        </div>
      </div>

      {/* Buy / Sell toggle switch */}
      <div className="op-side-switch">
        <button
          type="button"
          className={"op-side-btn buy" + (side === "BUY" ? " active" : "")}
          onClick={() => {
            setSide("BUY");
            setAmountInput("");
            setPercent(null);
          }}
        >
          BUY
        </button>
        <button
          type="button"
          className={"op-side-btn sell" + (side === "SELL" ? " active" : "")}
          onClick={() => {
            setSide("SELL");
            setAmountInput("");
            setPercent(null);
          }}
        >
          SELL
        </button>
      </div>

      {/* Order Type Tabs */}
      <div className="op-type-tabs">
        {(["Limit", "Market", "Stop-Limit"] as OrderType[]).map((t) => (
          <button
            key={t}
            type="button"
            className={"op-type-btn" + (type === t ? " active" : "")}
            onClick={() => setType(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Available Balance */}
      <div className="op-balance-row">
        <span className="op-bal-icon">💼</span>
        <span className="op-bal-val">
          {side === "BUY"
            ? `${availableUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`
            : `${availableCoin.toFixed(4)} ${coin}`}
        </span>
      </div>

      {/* Inputs Form */}
      <form className="op-form" onSubmit={handleSubmit}>
        {/* Price Input */}
        <div className="op-field">
          <span className="op-field-label">Price</span>
          {type === "Market" ? (
            <input
              type="text"
              className="op-input disabled"
              value="Market Price"
              disabled
            />
          ) : (
            <input
              type="number"
              step="any"
              className="op-input"
              value={priceInput}
              onChange={(e) => {
                setPriceInput(e.target.value);
                setPercent(null);
              }}
              placeholder="0.00"
              required
            />
          )}
          <span className="op-unit">USD</span>
        </div>

        {/* Amount Input */}
        <div className="op-field">
          <span className="op-field-label">Amount</span>
          <input
            type="number"
            step="any"
            className="op-input"
            value={amountInput}
            onChange={(e) => {
              setAmountInput(e.target.value);
              setPercent(null);
            }}
            placeholder="0.00"
            required
          />
          <span className="op-unit">{coin}</span>
        </div>

        {/* Percentage Selector */}
        <div className="op-slider-row">
          {[25, 50, 75, 100].map((p) => (
            <button
              key={p}
              type="button"
              className={"op-pct-pill" + (percent === p ? " active" : "")}
              onClick={() => handlePercentSelect(p)}
            >
              {p}%
            </button>
          ))}
        </div>

        {/* Take Profit (TP) Bracket Input */}
        <div className="op-bracket-box">
          <label className="op-bracket-toggle">
            <input
              type="checkbox"
              checked={tpEnabled}
              onChange={(e) => setTpEnabled(e.target.checked)}
            />
            <span className="op-bracket-tag tp">Take Profit (TP)</span>
          </label>
          {tpEnabled && (
            <div className="op-field mini">
              <span className="op-field-label">TP Px</span>
              <input
                type="number"
                step="any"
                className="op-input"
                value={tpInput}
                onChange={(e) => setTpInput(e.target.value)}
                placeholder="Target Price"
                required
              />
              <span className="op-unit">USD</span>
            </div>
          )}
        </div>

        {/* Stop Loss (SL) Bracket Input */}
        <div className="op-bracket-box">
          <label className="op-bracket-toggle">
            <input
              type="checkbox"
              checked={slEnabled}
              onChange={(e) => setSlEnabled(e.target.checked)}
            />
            <span className="op-bracket-tag sl">Stop Loss (SL)</span>
          </label>
          {slEnabled && (
            <div className="op-field mini">
              <span className="op-field-label">SL Px</span>
              <input
                type="number"
                step="any"
                className="op-input"
                value={slInput}
                onChange={(e) => setSlInput(e.target.value)}
                placeholder="Stop Price"
                required
              />
              <span className="op-unit">USD</span>
            </div>
          )}
        </div>

        {/* Total Input */}
        <div className="op-field">
          <span className="op-field-label">Total</span>
          <input
            type="text"
            className="op-input"
            value={total > 0 ? total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""}
            readOnly
            placeholder="0.00"
          />
          <span className="op-unit">USD</span>
        </div>

        {/* Options Row */}
        <div className="op-options-row">
          <label className="op-checkbox-label">
            <input
              type="checkbox"
              checked={postOnly}
              onChange={(e) => setPostOnly(e.target.checked)}
            />
            <span>Post Only</span>
          </label>
          <div className="op-tif-select">
            <span>TIF</span>
            <select value={tif} onChange={(e) => setTif(e.target.value as any)}>
              <option value="GTC">GTC</option>
              <option value="IOC">IOC</option>
              <option value="FOK">FOK</option>
            </select>
          </div>
        </div>

        {/* Action Button */}
        <button
          type="submit"
          className={"op-submit-btn " + (side === "BUY" ? "buy" : "sell")}
        >
          {side === "BUY" ? `Buy ${coin}` : `Sell ${coin}`}
        </button>

        {/* Feedback message */}
        {message && (
          <div className={"op-feedback " + message.tone}>
            {message.text}
          </div>
        )}
      </form>

      {/* Assets Section */}
      <div className="op-assets-sec">
        <div className="op-assets-head">
          <span className="op-assets-title">Assets</span>
          <div className="op-assets-actions">
            <button
              type="button"
              className="op-asset-action-btn"
              onClick={() => depositAsset("USD", 10000)}
              title="Add paper funds ($10,000 USD)"
            >
              + Deposit
            </button>
            <button
              type="button"
              className="op-asset-action-btn"
              onClick={() => depositAsset(coin, 1)}
              title={`Add 1 ${coin}`}
            >
              + {coin}
            </button>
          </div>
        </div>
        <div className="op-asset-row">
          <span className="op-asset-name">{coin} Available:</span>
          <span className="op-asset-val">{availableCoin.toFixed(4)}</span>
        </div>
        <div className="op-asset-row">
          <span className="op-asset-name">USD Available:</span>
          <span className="op-asset-val">${availableUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
        </div>
      </div>
    </div>
  );
}
