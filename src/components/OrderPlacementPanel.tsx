/**
 * OrderPlacementPanel — Pro-tier Trading & Derivatives Order Placement
 *
 * Implements:
 * 1. Dual Mode: In-App Paper Trading (Default) vs Alpaca Paper Trading
 *    - In-App Paper: $50,000 USD wallet, leverage, funding charges, margin calculations
 *    - Alpaca Paper: 100% live Alpaca account buying power, cash, and official order execution
 * 2. Margin Mode & Leverage:
 *    - Cross / Isolated margin selection
 *    - 1x, 2x, 5x, 10x, 20x, 50x leverage slider
 *    - Precise Initial Margin and Liquidation Price calculation
 * 3. Take Profit (TP) & Stop Loss (SL) Brackets:
 *    - Set targets by Price ($), Percentage (%), or Points / PnL ($)
 *    - Live Risk:Reward ratio calculation
 * 4. Full Fee Classification (as per Hyperliquid specifications):
 *    - Maker (0.015%) vs Taker (0.035%) fee classification
 *    - Hyperliquid 1h funding rate & predicted 8h funding charges
 * 5. Educational learning tooltips explaining all derivatives mechanics.
 */
import { useEffect, useState, useCallback, useMemo } from "react";
import {
  useOrders,
  type OrderSide,
  type OrderType,
  type TradingMode,
} from "../lib/orderState";
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

type BracketMode = "price" | "percent" | "points";

export function OrderPlacementPanel({
  coin,
  data,
  onOrderPlaced,
  onOpenSettings,
}: Props) {
  const {
    tradingMode,
    setTradingMode,
    balances,
    placeOrder,
    depositAsset,
    syncAlpaca,
  } = useOrders();

  const [side, setSide] = useState<OrderSide>("BUY");
  const [type, setType] = useState<OrderType>("Limit");

  const currentPrice = data.ctx?.markPx || data.ctx?.midPx || 65000;

  // Form inputs
  const [priceInput, setPriceInput] = useState<string>("");
  const [amountInput, setAmountInput] = useState<string>("");
  const [percent, setPercent] = useState<number | null>(null);

  // Margin & Leverage
  const [marginMode, setMarginMode] = useState<"cross" | "isolated">("cross");
  const [leverage, setLeverage] = useState<number>(10);

  // Take Profit & Stop Loss
  const [tpEnabled, setTpEnabled] = useState(false);
  const [tpMode, setTpMode] = useState<BracketMode>("percent");
  const [tpPercentInput, setTpPercentInput] = useState("5.0");
  const [tpPriceInput, setTpPriceInput] = useState("");
  const [tpPointsInput, setTpPointsInput] = useState("");

  const [slEnabled, setSlEnabled] = useState(false);
  const [slMode, setSlMode] = useState<BracketMode>("percent");
  const [slPercentInput, setSlPercentInput] = useState("2.5");
  const [slPriceInput, setSlPriceInput] = useState("");
  const [slPointsInput, setSlPointsInput] = useState("");

  const [postOnly, setPostOnly] = useState(false);
  const [tif, setTif] = useState<"GTC" | "IOC" | "FOK">("GTC");
  const [message, setMessage] = useState<{ text: string; tone: "up" | "down" } | null>(null);

  // Alpaca API state
  const [alpacaConfig, setAlpacaConfig] = useState(getAlpacaConfig());
  const [alpacaAccount, setAlpacaAccount] = useState<AlpacaAccount | null>(null);
  const [alpacaQuote, setAlpacaQuote] = useState<AlpacaQuote | null>(null);
  const [loadingAlpaca, setLoadingAlpaca] = useState(false);

  const hasAlpacaKeys = Boolean(alpacaConfig.keyId && alpacaConfig.secretKey);

  // Refresh Alpaca live account details
  const refreshAlpaca = useCallback(async () => {
    if (!hasAlpacaKeys) {
      setAlpacaAccount(null);
      return;
    }
    setLoadingAlpaca(true);
    const res = await testAlpacaConnection();
    if (res.ok && res.account) {
      setAlpacaAccount(res.account);
    }
    const qRes = await getAlpacaLatestQuote(coin);
    if (qRes.ok && qRes.quote) {
      setAlpacaQuote(qRes.quote);
    }
    setLoadingAlpaca(false);
  }, [hasAlpacaKeys, coin]);

  useEffect(() => {
    const handleCfgChange = () => {
      setAlpacaConfig(getAlpacaConfig());
    };
    window.addEventListener("alpaca-config-changed", handleCfgChange);
    return () => window.removeEventListener("alpaca-config-changed", handleCfgChange);
  }, []);

  useEffect(() => {
    if (tradingMode === "alpaca" && hasAlpacaKeys) {
      void refreshAlpaca();
    }
  }, [tradingMode, hasAlpacaKeys, coin, refreshAlpaca]);

  // Sync initial price input
  useEffect(() => {
    if (currentPrice && (!priceInput || type === "Market")) {
      setPriceInput(currentPrice.toFixed(2));
    }
  }, [coin, currentPrice, type]);

  const priceNum = parseFloat(priceInput) || currentPrice || 0;
  const effectiveLeverage = tradingMode === "alpaca" ? 1 : leverage;
  const amountNum = parseFloat(amountInput) || 0;
  const effectivePrice = type === "Market" ? currentPrice : priceNum;
  const notionalValue = effectivePrice * amountNum;
  const initialMargin = notionalValue / effectiveLeverage;

  // Auto calculate TP & SL prices based on mode
  const calculatedTpPrice = useMemo(() => {
    if (!tpEnabled || effectivePrice <= 0) return null;
    if (tpMode === "price") {
      return parseFloat(tpPriceInput) || null;
    }
    if (tpMode === "percent") {
      const pct = parseFloat(tpPercentInput) || 0;
      if (pct <= 0) return null;
      return side === "BUY"
        ? effectivePrice * (1 + pct / 100)
        : effectivePrice * (1 - pct / 100);
    }
    if (tpMode === "points") {
      const pts = parseFloat(tpPointsInput) || 0;
      if (pts <= 0) return null;
      return side === "BUY" ? effectivePrice + pts : effectivePrice - pts;
    }
    return null;
  }, [tpEnabled, tpMode, tpPriceInput, tpPercentInput, tpPointsInput, effectivePrice, side]);

  const calculatedSlPrice = useMemo(() => {
    if (!slEnabled || effectivePrice <= 0) return null;
    if (slMode === "price") {
      return parseFloat(slPriceInput) || null;
    }
    if (slMode === "percent") {
      const pct = parseFloat(slPercentInput) || 0;
      if (pct <= 0) return null;
      return side === "BUY"
        ? effectivePrice * (1 - pct / 100)
        : effectivePrice * (1 + pct / 100);
    }
    if (slMode === "points") {
      const pts = parseFloat(slPointsInput) || 0;
      if (pts <= 0) return null;
      return side === "BUY" ? effectivePrice - pts : effectivePrice + pts;
    }
    return null;
  }, [slEnabled, slMode, slPriceInput, slPercentInput, slPointsInput, effectivePrice, side]);

  // Risk : Reward ratio
  const riskRewardRatio = useMemo(() => {
    if (!calculatedTpPrice || !calculatedSlPrice || effectivePrice <= 0) return null;
    const tpDist = Math.abs(calculatedTpPrice - effectivePrice);
    const slDist = Math.abs(calculatedSlPrice - effectivePrice);
    if (slDist <= 0) return null;
    return (tpDist / slDist).toFixed(2);
  }, [calculatedTpPrice, calculatedSlPrice, effectivePrice]);

  // Estimated Liquidation Price (N/A for Spot trading)
  const estimatedLiqPrice = useMemo(() => {
    if (tradingMode === "alpaca" || effectivePrice <= 0 || effectiveLeverage <= 1) return null;
    const maintenanceMargin = 0.005; // 0.5% standard maintenance margin
    if (side === "BUY") {
      return Math.max(0, effectivePrice * (1 - 1 / effectiveLeverage + maintenanceMargin));
    } else {
      return effectivePrice * (1 + 1 / effectiveLeverage - maintenanceMargin);
    }
  }, [effectivePrice, effectiveLeverage, side, tradingMode]);

  // Fee Calculation as per Hyperliquid specs
  // Maker: 0.015% (0.00015), Taker: 0.035% (0.00035)
  const isMaker = type === "Limit" && postOnly;
  const feeRate = isMaker ? 0.00015 : 0.00035;
  const estFee = notionalValue * feeRate;

  // Hyperliquid Funding rate: 1h funding rate (e.g. +0.0012% / 1h)
  const fundingRate1h = (data.ctx?.funding || 0.000012);
  const estFunding8h = notionalValue * (fundingRate1h * 8);

  // Available Balance
  const availableUsd =
    tradingMode === "alpaca" && alpacaAccount
      ? parseFloat(alpacaAccount.buying_power || "0")
      : balances.USD ?? 0;

  // Preset lot sizes
  const lotPresets =
    currentPrice > 10000
      ? [0.001, 0.01, 0.05, 0.1, 0.5, 1.0]
      : currentPrice > 500
      ? [0.05, 0.1, 0.5, 1.0, 5.0, 10.0]
      : [1, 5, 10, 50, 100, 500];

  const handlePercentSelect = (pct: number) => {
    setPercent(pct);
    if (effectivePrice > 0) {
      const budget = availableUsd * (pct / 100) * leverage;
      const amt = budget / effectivePrice;
      const rounded =
        effectivePrice > 1000 ? parseFloat(amt.toFixed(4)) : parseFloat(amt.toFixed(2));
      setAmountInput(rounded > 0 ? String(rounded) : "");
    }
  };

  // Submit Order
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amountNum <= 0) {
      setMessage({ text: "Please enter an amount > 0", tone: "down" });
      return;
    }
    if (type !== "Market" && priceNum <= 0) {
      setMessage({ text: "Please enter a valid price", tone: "down" });
      return;
    }

    const tpFinal = calculatedTpPrice ? parseFloat(calculatedTpPrice.toFixed(2)) : undefined;
    const slFinal = calculatedSlPrice ? parseFloat(calculatedSlPrice.toFixed(2)) : undefined;

    if (tradingMode === "alpaca") {
      if (!hasAlpacaKeys) {
        setMessage({
          text: "Alpaca API keys missing. Please configure in Settings.",
          tone: "down",
        });
        return;
      }

      const alpacaType = type === "Limit" ? "limit" : type === "Market" ? "market" : "stop_limit";
      const alpacaRes = await submitAlpacaOrder({
        symbol: `${coin}/USD`,
        qty: amountNum,
        side: side === "BUY" ? "buy" : "sell",
        type: alpacaType,
        limitPrice: type === "Limit" ? effectivePrice : undefined,
        takeProfitPrice: tpFinal,
        stopLossPrice: slFinal,
        timeInForce: tif.toLowerCase() as any,
      });

      if (!alpacaRes.ok) {
        setMessage({ text: `Alpaca: ${alpacaRes.error || "Order rejected"}`, tone: "down" });
      } else {
        setMessage({
          text: `Alpaca: ${side} ${amountNum} ${coin} placed! Status: ${alpacaRes.order?.status || "accepted"}`,
          tone: "up",
        });
        void refreshAlpaca();
        void syncAlpaca();
        setAmountInput("");
        setPercent(null);
        onOrderPlaced?.();
        setTimeout(() => setMessage(null), 4000);
      }
      return;
    }

    // In-App Paper Trading Engine
    const res = placeOrder({
      coin,
      pair: `${coin}/USD`,
      type,
      side,
      price: effectivePrice,
      amount: amountNum,
      trigger: slFinal ? `SL $${slFinal}` : tpFinal ? `TP $${tpFinal}` : "-",
      takeProfit: tpFinal,
      stopLoss: slFinal,
      currentPrice,
      leverage,
    });

    if (!res.ok) {
      setMessage({ text: res.error || "Order placement failed", tone: "down" });
    } else {
      const modeLabel = type === "Market" ? "Open Trade" : "Open Limit Order";
      setMessage({
        text: `${side} ${amountNum} ${coin} placed @ $${effectivePrice.toLocaleString(undefined, { minimumFractionDigits: 2 })} (${modeLabel})`,
        tone: "up",
      });
      setAmountInput("");
      setPercent(null);
      onOrderPlaced?.();
      setTimeout(() => setMessage(null), 4000);
    }
  };

  return (
    <div className="order-placement-panel" aria-label="Place order">
      {/* 1. Header: Dual Trading Environment Selector (In-App vs Alpaca) */}
      <div className="op-head">
        <div className="op-mode-toggle">
          <button
            type="button"
            className={"op-mode-tab" + (tradingMode === "in_app" ? " active" : "")}
            onClick={() => setTradingMode("in_app")}
            title="In-App Paper Trading Simulator ($50,000 USD wallet)"
          >
            In-App Paper
          </button>
          <button
            type="button"
            className={"op-mode-tab" + (tradingMode === "alpaca" ? " active" : "")}
            onClick={() => {
              setTradingMode("alpaca");
              if (!hasAlpacaKeys) onOpenSettings?.();
            }}
            title="Alpaca Paper Trading API (Live Broker Account)"
          >
            Alpaca Paper
          </button>
        </div>
        <button
          type="button"
          className="op-settings-gear-btn"
          onClick={onOpenSettings}
          title="Configure API Keys & Trading Settings"
        >
          ⚙ Settings
        </button>
      </div>

      {/* Alpaca Live Account Status Bar */}
      {tradingMode === "alpaca" && (
        <div className="op-alpaca-stat-bar">
          {hasAlpacaKeys && alpacaAccount ? (
            <div className="op-asb-info">
              <span>Alpaca Cash: <b>${parseFloat(alpacaAccount.cash || "0").toLocaleString(undefined, { minimumFractionDigits: 2 })}</b></span>
              <span>BP: <b>${parseFloat(alpacaAccount.buying_power || "0").toLocaleString(undefined, { minimumFractionDigits: 2 })}</b></span>
            </div>
          ) : (
            <div className="op-asb-warn" onClick={onOpenSettings}>
              <span>⚠️ Alpaca API Keys not configured. Click to connect.</span>
            </div>
          )}
        </div>
      )}

      {/* 2. Margin Mode & Leverage Selector */}
      {tradingMode === "alpaca" ? (
        <div className="op-leverage-bar alpaca-spot">
          <div className="op-alpaca-spot-badge">
            <span className="op-spot-dot">●</span>
            <b>1x Spot</b>
            <span className="op-spot-sub">Alpaca Crypto Spot (No Margin)</span>
          </div>
        </div>
      ) : (
        <div className="op-leverage-bar">
          <div className="op-margin-switch">
            <button
              type="button"
              className={"op-ms-btn" + (marginMode === "cross" ? " active" : "")}
              onClick={() => setMarginMode("cross")}
              title="Cross Margin: Shared margin pool across all positions"
            >
              Cross
            </button>
            <button
              type="button"
              className={"op-ms-btn" + (marginMode === "isolated" ? " active" : "")}
              onClick={() => setMarginMode("isolated")}
              title="Isolated Margin: Risk strictly limited to this position's margin"
            >
              Isolated
            </button>
          </div>

          <div className="op-leverage-chips">
            {[1, 2, 5, 10, 20, 50].map((lev) => (
              <button
                key={lev}
                type="button"
                className={"op-lev-chip" + (leverage === lev ? " active" : "")}
                onClick={() => setLeverage(lev)}
              >
                {lev}x
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 3. Buy (Long) / Sell (Short) Switch */}
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
          Buy / Long
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
          Sell / Short
        </button>
      </div>

      {/* 4. Order Type Tabs */}
      <div className="op-type-tabs">
        <button
          type="button"
          className={"op-type-tab" + (type === "Limit" ? " active" : "")}
          onClick={() => setType("Limit")}
        >
          Limit
        </button>
        <button
          type="button"
          className={"op-type-tab" + (type === "Market" ? " active" : "")}
          onClick={() => setType("Market")}
        >
          Market
        </button>
        <button
          type="button"
          className={"op-type-tab" + (type === "Stop-Limit" ? " active" : "")}
          onClick={() => setType("Stop-Limit")}
        >
          Stop Limit
        </button>
      </div>

      {/* 5. Order Form Inputs */}
      <form onSubmit={handleSubmit} className="op-form">
        {/* Price Input (Disabled for Market) */}
        {type !== "Market" && (
          <div className="op-field-group">
            <div className="op-field-label">
              <span>Price</span>
              <span className="op-mark-quick" onClick={() => setPriceInput(currentPrice.toFixed(2))}>
                Mid ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="op-input-wrap">
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
              />
              <span className="op-unit">USD</span>
            </div>
          </div>
        )}

        {/* Amount Input */}
        <div className="op-field-group">
          <div className="op-field-label">
            <span>Size / Quantity</span>
            <span className="op-sub-info">
              Avail: ${availableUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="op-input-wrap">
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
            />
            <span className="op-unit">{coin}</span>
          </div>
        </div>

        {/* Lot Presets & Percent Sliders */}
        <div className="op-lot-presets">
          {lotPresets.map((lot) => (
            <button
              key={lot}
              type="button"
              className={"op-lot-chip" + (amountInput === String(lot) ? " active" : "")}
              onClick={() => {
                setAmountInput(String(lot));
                setPercent(null);
              }}
            >
              {lot}
            </button>
          ))}
        </div>

        <div className="op-percent-bar">
          {[25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              type="button"
              className={"op-pct-btn" + (percent === pct ? " active" : "")}
              onClick={() => handlePercentSelect(pct)}
            >
              {pct}%
            </button>
          ))}
        </div>

        {/* 6. Take Profit (TP) & Stop Loss (SL) Brackets with % and Points Toggle */}
        <div className="op-brackets-section">
          {/* Take Profit Toggle */}
          <div className="op-bracket-card">
            <div className="op-bracket-header">
              <label className="op-checkbox-label">
                <input
                  type="checkbox"
                  checked={tpEnabled}
                  onChange={(e) => setTpEnabled(e.target.checked)}
                />
                <span className="bold text-buy">Take Profit (TP)</span>
              </label>

              {tpEnabled && (
                <div className="op-bracket-mode-toggle">
                  <button
                    type="button"
                    className={"op-bmt-btn" + (tpMode === "percent" ? " active" : "")}
                    onClick={() => setTpMode("percent")}
                  >
                    %
                  </button>
                  <button
                    type="button"
                    className={"op-bmt-btn" + (tpMode === "points" ? " active" : "")}
                    onClick={() => setTpMode("points")}
                  >
                    Pts
                  </button>
                  <button
                    type="button"
                    className={"op-bmt-btn" + (tpMode === "price" ? " active" : "")}
                    onClick={() => setTpMode("price")}
                  >
                    Price
                  </button>
                </div>
              )}
            </div>

            {tpEnabled && (
              <div className="op-bracket-inputs">
                {tpMode === "percent" && (
                  <div className="op-input-wrap small">
                    <input
                      type="number"
                      step="any"
                      className="op-input small"
                      value={tpPercentInput}
                      onChange={(e) => setTpPercentInput(e.target.value)}
                      placeholder="e.g. 5.0"
                    />
                    <span className="op-unit small">% Gain</span>
                  </div>
                )}
                {tpMode === "points" && (
                  <div className="op-input-wrap small">
                    <input
                      type="number"
                      step="any"
                      className="op-input small"
                      value={tpPointsInput}
                      onChange={(e) => setTpPointsInput(e.target.value)}
                      placeholder="e.g. 500"
                    />
                    <span className="op-unit small">USD Pts</span>
                  </div>
                )}
                {tpMode === "price" && (
                  <div className="op-input-wrap small">
                    <input
                      type="number"
                      step="any"
                      className="op-input small"
                      value={tpPriceInput}
                      onChange={(e) => setTpPriceInput(e.target.value)}
                      placeholder={effectivePrice ? (effectivePrice * 1.05).toFixed(2) : "0.00"}
                    />
                    <span className="op-unit small">Price ($)</span>
                  </div>
                )}

                {calculatedTpPrice && (
                  <div className="op-bracket-target-label text-buy">
                    Target: ${calculatedTpPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Stop Loss Toggle */}
          <div className="op-bracket-card">
            <div className="op-bracket-header">
              <label className="op-checkbox-label">
                <input
                  type="checkbox"
                  checked={slEnabled}
                  onChange={(e) => setSlEnabled(e.target.checked)}
                />
                <span className="bold text-sell">Stop Loss (SL)</span>
              </label>

              {slEnabled && (
                <div className="op-bracket-mode-toggle">
                  <button
                    type="button"
                    className={"op-bmt-btn" + (slMode === "percent" ? " active" : "")}
                    onClick={() => setSlMode("percent")}
                  >
                    %
                  </button>
                  <button
                    type="button"
                    className={"op-bmt-btn" + (slMode === "points" ? " active" : "")}
                    onClick={() => setSlMode("points")}
                  >
                    Pts
                  </button>
                  <button
                    type="button"
                    className={"op-bmt-btn" + (slMode === "price" ? " active" : "")}
                    onClick={() => setSlMode("price")}
                  >
                    Price
                  </button>
                </div>
              )}
            </div>

            {slEnabled && (
              <div className="op-bracket-inputs">
                {slMode === "percent" && (
                  <div className="op-input-wrap small">
                    <input
                      type="number"
                      step="any"
                      className="op-input small"
                      value={slPercentInput}
                      onChange={(e) => setSlPercentInput(e.target.value)}
                      placeholder="e.g. 2.5"
                    />
                    <span className="op-unit small">% Loss</span>
                  </div>
                )}
                {slMode === "points" && (
                  <div className="op-input-wrap small">
                    <input
                      type="number"
                      step="any"
                      className="op-input small"
                      value={slPointsInput}
                      onChange={(e) => setSlPointsInput(e.target.value)}
                      placeholder="e.g. 250"
                    />
                    <span className="op-unit small">USD Pts</span>
                  </div>
                )}
                {slMode === "price" && (
                  <div className="op-input-wrap small">
                    <input
                      type="number"
                      step="any"
                      className="op-input small"
                      value={slPriceInput}
                      onChange={(e) => setSlPriceInput(e.target.value)}
                      placeholder={effectivePrice ? (effectivePrice * 0.96).toFixed(2) : "0.00"}
                    />
                    <span className="op-unit small">Price ($)</span>
                  </div>
                )}

                {calculatedSlPrice && (
                  <div className="op-bracket-target-label text-sell">
                    Stop: ${calculatedSlPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Risk:Reward ratio pill */}
          {riskRewardRatio && (
            <div className="op-rr-pill">
              <span>Risk : Reward</span>
              <b>1 : {riskRewardRatio}</b>
            </div>
          )}
        </div>

        {/* 7. Fee & Derivative Charges Breakdown (as per Hyperliquid specs) */}
        <div className="op-charges-card">
          <div className="op-charge-row">
            <span className="k">
              Order Value (Notional)
              <span className="op-info-icon" title="Contract size multiplied by effective price">ℹ</span>
            </span>
            <span className="v">${notionalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>

          <div className="op-charge-row">
            <span className="k">
              Initial Margin ({effectiveLeverage}x)
              <span className="op-info-icon" title="Required collateral locked for this position">ℹ</span>
            </span>
            <span className="v bold text-accent">${initialMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>

          {estimatedLiqPrice && (
            <div className="op-charge-row">
              <span className="k">
                Est. Liquidation Price
                <span className="op-info-icon" title="Estimated price level where margin falls below maintenance threshold">ℹ</span>
              </span>
              <span className="v bold text-sell">${estimatedLiqPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          )}

          <div className="op-charge-row">
            <span className="k">
              Fee ({isMaker ? "Maker 0.015%" : "Taker 0.035%"})
              <span className="op-info-icon" title="Hyperliquid standard fee: 0.015% Maker (Post-Only limit) / 0.035% Taker (Market or taking liquidity)">ℹ</span>
            </span>
            <span className="v">${estFee.toFixed(3)}</span>
          </div>

          <div className="op-charge-row">
            <span className="k">
              1h Funding (Hyperliquid)
              <span className="op-info-icon" title="Periodic payment between longs and shorts to tether perpetual price to spot. Longs pay shorts when positive.">ℹ</span>
            </span>
            <span className="v text-muted">
              {(fundingRate1h * 100).toFixed(4)}% (~${estFunding8h.toFixed(3)}/8h)
            </span>
          </div>
        </div>

        {/* Feedback message */}
        {message && (
          <div className={"op-msg " + message.tone} role="alert">
            {message.text}
          </div>
        )}

        {/* Action Button */}
        <button
          type="submit"
          className={"op-submit-btn " + (side === "BUY" ? "buy" : "sell")}
          disabled={loadingAlpaca}
        >
          {loadingAlpaca ? "Submitting..." : `${side === "BUY" ? "Buy / Long" : "Sell / Short"} ${coin}`}
        </button>
      </form>
    </div>
  );
}
