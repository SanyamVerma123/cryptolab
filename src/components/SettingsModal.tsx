/**
 * SettingsModal — Application & Alpaca Trading API Settings
 *
 * Configures Alpaca API Key ID, Secret Key, Paper/Live mode, connection testing,
 * default TP/SL preferences, and paper wallet management.
 */
import { useEffect, useState } from "react";
import {
  getAlpacaConfig,
  saveAlpacaConfig,
  testAlpacaConnection,
  type AlpacaConfig,
} from "../lib/alpaca";
import { useOrders } from "../lib/orderState";

interface Props {
  open: boolean;
  onClose: () => void;
}

type SettingsTab = "alpaca" | "defaults" | "wallet";

export function SettingsModal({ open, onClose }: Props) {
  const { balances, depositAsset } = useOrders();
  const [tab, setTab] = useState<SettingsTab>("alpaca");

  const [cfg, setCfg] = useState<AlpacaConfig>(getAlpacaConfig());
  const [showSecret, setShowSecret] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);

  // Default trading preferences
  const [defaultTp, setDefaultTp] = useState("5.0");
  const [defaultSl, setDefaultSl] = useState("2.5");

  useEffect(() => {
    if (open) {
      setCfg(getAlpacaConfig());
      setTestResult(null);
    }
  }, [open]);

  if (!open) return null;

  const handleSaveAlpaca = () => {
    saveAlpacaConfig(cfg);
    setTestResult({ ok: true, msg: "Alpaca API configuration saved." });
    setTimeout(() => setTestResult(null), 3000);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    saveAlpacaConfig(cfg);

    const res = await testAlpacaConnection();
    setTesting(false);
    if (res.ok && res.account) {
      const acc = res.account;
      const portVal = parseFloat(acc.portfolio_value || "0").toLocaleString(undefined, {
        minimumFractionDigits: 2,
      });
      setTestResult({
        ok: true,
        msg: `Connected successfully! Status: ${acc.status} | Portfolio: $${portVal} ${acc.currency}`,
      });
    } else {
      setTestResult({
        ok: false,
        msg: res.error || "Connection failed. Please check your Key ID and Secret.",
      });
    }
  };

  return (
    <div className="settings-modal-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sm-header">
          <div className="sm-title-row">
            <span className="sm-icon">⚙</span>
            <span className="sm-title">Trading Settings</span>
          </div>
          <button type="button" className="sm-close-btn" onClick={onClose} title="Close settings">
            ✕
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="sm-tabs">
          <button
            type="button"
            className={"sm-tab" + (tab === "alpaca" ? " active" : "")}
            onClick={() => setTab("alpaca")}
          >
            Alpaca API
          </button>
          <button
            type="button"
            className={"sm-tab" + (tab === "defaults" ? " active" : "")}
            onClick={() => setTab("defaults")}
          >
            TP / SL Defaults
          </button>
          <button
            type="button"
            className={"sm-tab" + (tab === "wallet" ? " active" : "")}
            onClick={() => setTab("wallet")}
          >
            Paper Wallet
          </button>
        </div>

        {/* Content Body */}
        <div className="sm-body">
          {tab === "alpaca" && (
            <div className="sm-sec">
              <div className="sm-field-group">
                <label className="sm-label">Trading Environment</label>
                <div className="sm-radio-group">
                  <label className={"sm-radio-pill" + (cfg.isPaper ? " active" : "")}>
                    <input
                      type="radio"
                      name="env"
                      checked={cfg.isPaper}
                      onChange={() => {
                        const updated = { ...cfg, isPaper: true };
                        setCfg(updated);
                        saveAlpacaConfig(updated);
                      }}
                    />
                    <span>Paper Trading (Recommended)</span>
                  </label>
                  <label className={"sm-radio-pill" + (!cfg.isPaper ? " active" : "")}>
                    <input
                      type="radio"
                      name="env"
                      checked={!cfg.isPaper}
                      onChange={() => {
                        const updated = { ...cfg, isPaper: false };
                        setCfg(updated);
                        saveAlpacaConfig(updated);
                      }}
                    />
                    <span>Live Trading</span>
                  </label>
                </div>
                <span className="sm-hint">
                  {cfg.isPaper
                    ? "Paper Trading (Zero risk). Alpaca credentials are used for both Live Orders & Market Data API."
                    : "Live Trading (Real capital). Alpaca credentials are used for both Live Orders & Market Data API."}
                </span>
              </div>

              <div className="sm-field-group">
                <label className="sm-label">APCA-API-KEY-ID</label>
                <input
                  type="text"
                  className="sm-input"
                  placeholder="PK..."
                  value={cfg.keyId}
                  onChange={(e) => {
                    const updated = { ...cfg, keyId: e.target.value };
                    setCfg(updated);
                    saveAlpacaConfig(updated);
                  }}
                />
              </div>

              <div className="sm-field-group">
                <label className="sm-label">APCA-API-SECRET-KEY</label>
                <div className="sm-input-row">
                  <input
                    type={showSecret ? "text" : "password"}
                    className="sm-input"
                    placeholder="Enter secret key..."
                    value={cfg.secretKey}
                    onChange={(e) => {
                      const updated = { ...cfg, secretKey: e.target.value };
                      setCfg(updated);
                      saveAlpacaConfig(updated);
                    }}
                  />
                  <button
                    type="button"
                    className="sm-toggle-secret"
                    onClick={() => setShowSecret((v) => !v)}
                  >
                    {showSecret ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              {testResult && (
                <div className={"sm-alert " + (testResult.ok ? "success" : "error")}>
                  {testResult.msg}
                </div>
              )}

              <div className="sm-actions">
                <button
                  type="button"
                  className="sm-btn secondary"
                  onClick={handleTestConnection}
                  disabled={testing || !cfg.keyId || !cfg.secretKey}
                >
                  {testing ? "Testing..." : "Test Connection"}
                </button>
                <button
                  type="button"
                  className="sm-btn primary"
                  onClick={handleSaveAlpaca}
                >
                  Save API Keys
                </button>
              </div>

              <div className="sm-doc-box">
                <b>Where to get Alpaca keys:</b>
                <p>
                  1. Create a free account at{" "}
                  <a href="https://alpaca.markets" target="_blank" rel="noreferrer">
                    alpaca.markets
                  </a>
                  .<br />
                  2. Go to <b>Paper Trading</b> on the dashboard & click <b>Generate New Key</b>.
                  <br />
                  3. Paste your <b>Key ID</b> and <b>Secret Key</b> above.
                </p>
              </div>
            </div>
          )}

          {tab === "defaults" && (
            <div className="sm-sec">
              <div className="sm-field-group">
                <label className="sm-label">Default Take Profit (TP %)</label>
                <div className="sm-input-unit">
                  <input
                    type="number"
                    step="0.1"
                    className="sm-input"
                    value={defaultTp}
                    onChange={(e) => setDefaultTp(e.target.value)}
                  />
                  <span className="sm-unit">%</span>
                </div>
                <span className="sm-hint">Pre-populates the bracket order TP price above entry.</span>
              </div>

              <div className="sm-field-group">
                <label className="sm-label">Default Stop Loss (SL %)</label>
                <div className="sm-input-unit">
                  <input
                    type="number"
                    step="0.1"
                    className="sm-input"
                    value={defaultSl}
                    onChange={(e) => setDefaultSl(e.target.value)}
                  />
                  <span className="sm-unit">%</span>
                </div>
                <span className="sm-hint">Pre-populates the bracket order SL price below entry.</span>
              </div>
            </div>
          )}

          {tab === "wallet" && (
            <div className="sm-sec">
              <div className="sm-wallet-list">
                <div className="sm-wallet-row">
                  <span className="sm-w-coin">USD Cash</span>
                  <span className="sm-w-val">${balances.USD?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  <button
                    type="button"
                    className="sm-w-btn"
                    onClick={() => depositAsset("USD", 10000)}
                  >
                    +$10,000
                  </button>
                </div>
                {Object.entries(balances)
                  .filter(([k]) => k !== "USD")
                  .map(([c, val]) => (
                    <div key={c} className="sm-wallet-row">
                      <span className="sm-w-coin">{c}</span>
                      <span className="sm-w-val">{val.toFixed(4)}</span>
                      <button
                        type="button"
                        className="sm-w-btn"
                        onClick={() => depositAsset(c, 1)}
                      >
                        +1 {c}
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
