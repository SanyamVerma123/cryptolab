import { useEffect, useState, useMemo } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import { getSafeActiveChart } from "../lib/workspaceSafe";

interface Props {
  ws?: VelaWorkspace | null;
  coin?: string;
  currentPrice?: number;
}

interface SignalItem {
  name: string;
  value: number | string;
  action: "BUY" | "SELL" | "NEUTRAL";
}

export function TechnicalReading({ ws, coin = "BTC", currentPrice = 0 }: Props) {
  const [oscBuy, setOscBuy] = useState(2);
  const [oscNeutral, setOscNeutral] = useState(8);
  const [oscSell, setOscSell] = useState(1);

  const [maBuy, setMaBuy] = useState(11);
  const [maNeutral, setMaNeutral] = useState(1);
  const [maSell, setMaSell] = useState(3);

  // Compute live signals from available chart bars
  useEffect(() => {
    if (!ws) return;
    try {
      const chart = getSafeActiveChart(ws);
      if (!chart) return;
      const bars = chart.renderer?.visibleBars?.() || chart.bars?.() || [];
      if (bars.length < 30) return;

      const closes = bars.map((b: any) => b.close);
      const cur = currentPrice || closes[closes.length - 1];

      // Calculate simple EMAs/SMAs
      const calculateSMA = (period: number) => {
        if (closes.length < period) return cur;
        const slice = closes.slice(closes.length - period);
        return slice.reduce((a: number, b: number) => a + b, 0) / period;
      };

      const sma20 = calculateSMA(20);
      const sma50 = calculateSMA(50);
      const sma200 = calculateSMA(Math.min(200, closes.length));

      let mB = 0;
      let mN = 0;
      let mS = 0;

      [sma20, sma50, sma200].forEach((ma) => {
        if (cur > ma * 1.002) mB += 4;
        else if (cur < ma * 0.998) mS += 4;
        else mN += 4;
      });

      // Simple RSI approximation
      let gains = 0;
      let losses = 0;
      for (let i = closes.length - 14; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
      }
      const rs = losses === 0 ? 100 : gains / losses;
      const rsi = 100 - 100 / (1 + rs);

      let oB = 0;
      let oN = 0;
      let oS = 0;

      if (rsi < 35) oB += 3;
      else if (rsi > 65) oS += 3;
      else oN += 3;

      if (cur > sma20) oB += 2;
      else oS += 2;

      setMaBuy(Math.max(1, mB));
      setMaNeutral(Math.max(1, mN));
      setMaSell(Math.max(1, mS));

      setOscBuy(Math.max(1, oB));
      setOscNeutral(Math.max(1, oN));
      setOscSell(Math.max(1, oS));
    } catch {}
  }, [ws, currentPrice]);

  const totalBuy = oscBuy + maBuy;
  const totalSell = oscSell + maSell;
  const totalNeutral = oscNeutral + maNeutral;
  const total = totalBuy + totalSell + totalNeutral;

  const sentiment = useMemo(() => {
    if (totalBuy >= totalSell * 2 && totalBuy > 12) return { text: "Strong Buy", color: "#089981" };
    if (totalBuy > totalSell) return { text: "Buy", color: "#089981" };
    if (totalSell >= totalBuy * 2 && totalSell > 12) return { text: "Strong Sell", color: "#f23645" };
    if (totalSell > totalBuy) return { text: "Sell", color: "#f23645" };
    return { text: "Neutral", color: "#f7a600" };
  }, [totalBuy, totalSell]);

  // Gauge pointer angle from -90 to +90 deg
  const gaugeAngle = useMemo(() => {
    const net = totalBuy - totalSell;
    const maxSpan = 15;
    const ratio = Math.max(-1, Math.min(1, net / maxSpan));
    return ratio * 75; // -75 to +75 deg
  }, [totalBuy, totalSell]);

  return (
    <div className="tech-reading-panel">
      <div className="tr-header">
        <span className="tr-title">Technical Reading</span>
        <span className="tr-coin">{coin}</span>
      </div>

      {/* Main Gauge Widget */}
      <div className="tr-gauge-card">
        <div className="tr-verdict" style={{ color: sentiment.color }}>
          {sentiment.text}
        </div>
        <div className="tr-gauge-wrap">
          <svg className="tr-gauge-svg" viewBox="0 0 160 90">
            {/* Background Arc */}
            <path
              d="M 15 80 A 65 65 0 0 1 145 80"
              fill="none"
              stroke="#2a2e39"
              strokeWidth="12"
              strokeLinecap="round"
            />
            {/* Sell Arc */}
            <path
              d="M 15 80 A 65 65 0 0 1 50 35"
              fill="none"
              stroke="#f23645"
              strokeWidth="12"
              strokeLinecap="round"
            />
            {/* Neutral Arc */}
            <path
              d="M 55 31 A 65 65 0 0 1 105 31"
              fill="none"
              stroke="#f7a600"
              strokeWidth="12"
            />
            {/* Buy Arc */}
            <path
              d="M 110 35 A 65 65 0 0 1 145 80"
              fill="none"
              stroke="#089981"
              strokeWidth="12"
              strokeLinecap="round"
            />
            {/* Center Pivot */}
            <circle cx="80" cy="80" r="5" fill="#f0f3fa" />
            {/* Needle */}
            <line
              x1="80"
              y1="80"
              x2="80"
              y2="28"
              stroke="#f0f3fa"
              strokeWidth="3"
              strokeLinecap="round"
              style={{
                transformOrigin: "80px 80px",
                transform: `rotate(${gaugeAngle}deg)`,
                transition: "transform 0.5s ease-out",
              }}
            />
          </svg>
        </div>

        <div className="tr-summary-counts">
          <div className="tr-count-col sell">
            <span className="tr-count-num">{totalSell}</span>
            <span className="tr-count-lbl">Sell</span>
          </div>
          <div className="tr-count-col neutral">
            <span className="tr-count-num">{totalNeutral}</span>
            <span className="tr-count-lbl">Neutral</span>
          </div>
          <div className="tr-count-col buy">
            <span className="tr-count-num">{totalBuy}</span>
            <span className="tr-count-lbl">Buy</span>
          </div>
        </div>
      </div>

      {/* Sub-breakdown rows */}
      <div className="tr-breakdown-row">
        <div className="tr-group">
          <div className="tr-group-title">Oscillators</div>
          <div className="tr-group-mini-summary">
            <span className="tr-badge sell">{oscSell} Sell</span>
            <span className="tr-badge neutral">{oscNeutral} Neutral</span>
            <span className="tr-badge buy">{oscBuy} Buy</span>
          </div>
        </div>

        <div className="tr-group">
          <div className="tr-group-title">Moving Averages</div>
          <div className="tr-group-mini-summary">
            <span className="tr-badge sell">{maSell} Sell</span>
            <span className="tr-badge neutral">{maNeutral} Neutral</span>
            <span className="tr-badge buy">{maBuy} Buy</span>
          </div>
        </div>
      </div>
    </div>
  );
}
