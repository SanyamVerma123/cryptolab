/**
 * OrderPlacementPanel — Binance-style Pro Order Placement Panel
 *
 * Fully integrated with Alpaca Trading & Market Data APIs, featuring:
 * - Limit, Market, Stop-Limit order types
 * - Quick Lot Size chips & step increments (+ / -)
 * - Automatic fee calculation (Maker 0.15% / Taker 0.25%, net cost)
 * - Take Profit (TP) & Stop Loss (SL) brackets with estimated PnL & R:R ratio
 * - Live Alpaca account buying power, cash, and Alpaca crypto quote integration
 * - Paper simulator wallet fallback with instant deposit
 */
import { useEffect, useState, useCallback } from "react";
import { useOrders, type OrderSide, type OrderType } from "../lib/orderState";
import {
  getAlpacaConfig,
  submitAlpacaOrder,
  testAlpacaConnection,
  getAlpacaLatestQuote,
  type AlpacaQuote,
  type AlpacaAccount,
} from "../lib/alpaca";
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

  // Alpaca API connection state & live account data
  const [alpacaConfig, setAlpacaConfig] = useState(getAlpacaConfig());
  const [alpacaAccount, setAlpacaAccount] = useState<AlpacaAccount | null>(null);
  const [alpacaQuote, setAlpacaQuote] = useState<AlpacaQuote | null>(null);
  const [loadingAlpaca, setLoadingAlpaca] = useState(false);

  const hasAlpaca = Boolean(alpacaConfig.keyId && alpacaConfig.secretKey);

  // Refresh Alpaca live account details
  const refreshAlpaca = useCallback(async () => {
    if (!hasAlpaca) {
      setAlpacaAccount(null);
      return;
    }
    setLoadingAlpaca(true);
    const res = await testAlpacaConnection();
    if (res.ok && res.account) {
      setAlpacaAccount(res.account);
    }
    // Also fetch latest quote from Alpaca Data API
    const qRes = await getAlpacaLatestQuote(coin);
    if (qRes.ok && qRes.quote) {
      setAlpacaQuote(qRes.quote);
    }
    setLoadingAlpaca(false);
  }, [hasAlpaca, coin]);

  // Listen to configuration updates from SettingsModal
  useEffect(() => {
    const handleCfgChange = () => {
      const next = getAlpacaConfig();
      setAlpacaConfig(next);
    };
    window.addEventListener("alpaca-config-changed", handleCfgChange);
    return () => window.removeEventListener("alpaca-config-changed", handleCfgChange);
  }, []);

  useEffect(() => {
    if (hasAlpaca) {
      void refreshAlpaca();
    }
  }, [hasAlpaca, coin, refreshAlpaca]);

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
  const effectivePrice = type === "Market" ? currentPrice : priceNum;
  const total = effectivePrice * amountNum;

  // Fee calculation (Maker: 0.15% if limit + postOnly, Taker: 0.25% standard)
  const isMaker = type === "Limit" && postOnly;
  const feeRate = isMaker ? 0.0015 : 0.0025;
  const estFee = total * feeRate;
  const netTotal = side === "BUY" ? total + estFee : Math.max(0, total - estFee);

  // Balances
  const availableUsd = balances.USD ?? 0;
  const availableCoin = balances[coin] ?? 0;

  // Lot size presets depending on coin price
  const lotPresets = currentPrice > 10000
    ? [0.001, 0.01, 0.05, 0.1, 0.5, 1.0]
    : currentPrice > 500
    ? [0.05, 0.1, 0.5, 1.0, 5.0, 10.0]
    : [1, 5, 10, 50, 100, 500];

  const handleLotSelect = (lot: number) => {
    setAmountInput(String(lot));
    setPercent(null);
  };

  const handleStepAmount = (delta: number) => {
    const next = Math.max(0, parseFloat((amountNum + delta).toFixed(4)));
    setAmountInput(next > 0 ? String(next) : "");
    setPercent(null);
  };

  const handleStepPrice = (deltaPct: number) => {
    const next = Math.max(0, parseFloat((priceNum * (1 + deltaPct)).toFixed(2)));
    setPriceInput(String(next));
    setPercent(null);
  };

  // Percentage allocation button (25%, 50%, 75%, 100%)
  const handlePercentSelect = (pct: number) => {
    setPercent(pct);
    if (side === "BUY") {
      const budget = (hasAlpaca && alpacaAccount ? parseFloat(alpacaAccount.buying_power || "0") : availableUsd) * (pct / 100);
      if (effectivePrice > 0) {
        const amt = budget / effectivePrice;
        setAmountInput(amt < 1 ? amt.toFixed(4) : amt.toFixed(2));
      }
    } else {
      const amt = availableCoin * (pct / 100);
      setAmountInput(amt < 1 ? amt.toFixed(4) : amt.toFixed(2));
    }
  };

  // TP / SL Calculations
  const tpNum = parseFloat(tpInput) || 0;
  const slNum = parseFloat(slInput) || 0;

  let tpProfit = 0;
  let tpPct = 0;
  if (tpEnabled && tpNum > 0 && effectivePrice > 0) {
    tpProfit = Math.abs(tpNum - effectivePrice) * amountNum;
    tpPct = ((tpNum - effectivePrice) / effectivePrice) * 100 * (side === "BUY" ? 1 : -1);
  }

  let slLoss = 0;
  let slPct = 0;
  if (slEnabled && slNum > 0 && effectivePrice > 0) {
    slLoss = Math.abs(effectivePrice - slNum) * amountNum;
    slPct = ((effectivePrice - slNum) / effectivePrice) * 100 * (side === "BUY" ? 1 : -1);
  }

  const riskReward = slLoss > 0 && tpProfit > 0 ? (tpProfit / slLoss).toFixed(2) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (amountNum <= 0) {
      setMessage({ text: "Please enter a valid amount", tone: "down" });
      return;
    }

    const tpPrice = tpEnabled && tpNum > 0 ? tpNum : undefined;
    const slPrice = slEnabled && slNum > 0 ? slNum : undefined;

    // If Alpaca keys configured, submit to Alpaca API
    if (hasAlpaca) {
      const alpacaType = type === "Limit" ? "limit" : type === "Market" ? "market" : "stop_limit";
      const alpacaRes = await submitAlpacaOrder({
        symbol: `${coin}/USD`,
        qty: amountNum,
        side: side === "BUY" ? "buy" : "sell",
        type: alpacaType,
        limitPrice: type === "Limit" ? effectivePrice : undefined,
        takeProfitPrice: tpPrice,
        stopLossPrice: slPrice,
        timeInForce: tif.toLowerCase() as any,
      });

      if (!alpacaRes.ok) {
        console.warn("[trade-pro] Alpaca order fallback to local simulation:", alpacaRes.error);
        setMessage({
          text: `Alpaca: ${alpacaRes.error || "Order rejected"} (simulated locally)`,
          tone: "down",
        });
      } else {
        setMessage({
          text: `Alpaca: ${side} ${amountNum} ${coin} placed! Status: ${alpacaRes.order?.status || "accepted"}`,
          tone: "up",
        });
        void refreshAlpaca();
      }
    }

    // Always register in local order store for chart visual lines & bottom drawer
    const res = placeOrder({
      coin,
      pair: `${coin}/USD`,
      type,
      side,
      price: effectivePrice,
      amount: amountNum,
      trigger: slPrice ? `SL $${slPrice}` : tpPrice ? `TP $${tpPrice}` : "-",
      takeProfit: tpPrice,
      stopLoss: slPrice,
      currentPrice,
    });

    if (!res.ok && !hasAlpaca) {
      setMessage({ text: res.error || "Order failed", tone: "down" });
    } else if (!hasAlpaca) {
      setMessage({
        text: `${side} ${amountNum} ${coin} placed @ $${effectivePrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}${tpPrice ? ` [TP: $${tpPrice}]` : ""}${slPrice ? ` [SL: $${slPrice}]` : ""}`,
        tone: "up",
      });
      setAmountInput("");
      setPercent(null);
      onOrderPlaced?.();
      setTimeout(() => setMessage(null), 4500);
    } else {
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
          <span className="op-vip">{hasAlpaca ? "Alpaca API" : "Sim Mode"}</span>
        </div>
      </div>

      {/* Alpaca Live Quote Banner (if Alpaca configured) */}
      {hasAlpaca && alpacaQuote && (
        <div className="op-alpaca-quote-banner">
          <span className="op-aqb-title">Alpaca BBO:</span>
          <span className="op-aqb-bid">Bid ${alpacaQuote.bp?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          <span className="op-aqb-ask">Ask ${alpacaQuote.ap?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
        </div>
      )}

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

      {/* Available Balance Row */}
      <div className="op-balance-row">
        <span className="op-bal-icon">💼</span>
        <span className="op-bal-label">
          {hasAlpaca && alpacaAccount ? "Alpaca Power:" : "Available:"}
        </span>
        <span className="op-bal-val">
          {hasAlpaca && alpacaAccount
            ? `$${parseFloat(alpacaAccount.buying_power || "0").toLocaleString(undefined, { minimumFractionDigits: 2 })}`
            : side === "BUY"
            ? `${availableUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })} USD`
            : `${availableCoin.toFixed(4)} ${coin}`}
        </span>
        {hasAlpaca && (
          <button
            type="button"
            className="op-bal-refresh-btn"
            title="Refresh Alpaca Balance"
            onClick={() => void refreshAlpaca()}
          >
            {loadingAlpaca ? "…" : "↻"}
          </button>
        )}
      </div>

      {/* Inputs Form */}
      <form className="op-form" onSubmit={handleSubmit}>
        {/* Price Input with +/- micro steppers */}
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
            <>
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
              <div className="op-field-steppers">
                <button type="button" onClick={() => handleStepPrice(-0.005)} title="-0.5%">-</button>
                <button type="button" onClick={() => handleStepPrice(0.005)} title="+0.5%">+</button>
              </div>
            </>
          )}
          <span className="op-unit">USD</span>
        </div>

        {/* Amount Input with +/- steppers */}
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
          <div className="op-field-steppers">
            <button type="button" onClick={() => handleStepAmount(-0.01)} title="-0.01">-</button>
            <button type="button" onClick={() => handleStepAmount(0.01)} title="+0.01">+</button>
          </div>
          <span className="op-unit">{coin}</span>
        </div>

        {/* Quick Lot Size Selector Chips */}
        <div className="op-lot-presets">
          <span className="op-lot-label">Lot Size:</span>
          {lotPresets.map((l) => (
            <button
              key={l}
              type="button"
              className={"op-lot-chip" + (amountNum === l ? " active" : "")}
              onClick={() => handleLotSelect(l)}
            >
              {l}
            </button>
          ))}
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
            {tpEnabled && tpProfit > 0 && (
              <span className="op-bracket-metric up">
                +${tpProfit.toFixed(2)} (+{tpPct.toFixed(1)}%)
              </span>
            )}
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
            {slEnabled && slLoss > 0 && (
              <span className="op-bracket-metric down">
                -${slLoss.toFixed(2)} (-{slPct.toFixed(1)}%)
              </span>
            )}
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

        {/* Risk / Reward Ratio Badge (when both TP and SL are active) */}
        {riskReward && (
          <div className="op-rr-badge">
            <span className="op-rr-label">Risk/Reward Ratio:</span>
            <span className="op-rr-val">1 : {riskReward}</span>
          </div>
        )}

        {/* Fee & Order Breakdown Card */}
        <div className="op-order-summary">
          <div className="op-summary-row">
            <span>Order Value:</span>
            <span className="val">${total > 0 ? total.toFixed(2) : "0.00"} USD</span>
          </div>
          <div className="op-summary-row">
            <span>Est. Fee ({isMaker ? "0.15% Maker" : "0.25% Taker"}):</span>
            <span className="val">${estFee > 0 ? estFee.toFixed(2) : "0.00"} USD</span>
          </div>
          <div className="op-summary-row total">
            <span>Est. Net Total:</span>
            <span className="val">${netTotal > 0 ? netTotal.toFixed(2) : "0.00"} USD</span>
          </div>
        </div>

        {/* Options Row */}
        <div className="op-options-row">
          <label className="op-checkbox-label">
            <input
              type="checkbox"
              checked={postOnly}
              onChange={(e) => setPostOnly(e.target.checked)}
            />
            <span>Post Only (Maker)</span>
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

        {/* Submit Action Button */}
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
          <span className="op-assets-title">Paper Wallet Assets</span>
          <div className="op-assets-actions">
            <button
              type="button"
              className="op-asset-action-btn"
              onClick={() => depositAsset("USD", 10000)}
              title="Add paper funds ($10,000 USD)"
            >
              +$10k USD
            </button>
            <button
              type="button"
              className="op-asset-action-btn"
              onClick={() => depositAsset(coin, 1)}
              title={`Add 1 ${coin}`}
            >
              +1 {coin}
            </button>
          </div>
        </div>
        <div className="op-asset-row">
          <span className="op-asset-name">{coin} Balance:</span>
          <span className="op-asset-val">{availableCoin.toFixed(4)}</span>
        </div>
        <div className="op-asset-row">
          <span className="op-asset-name">USD Balance:</span>
          <span className="op-asset-val">${availableUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
        </div>
      </div>
    </div>
  );
}
