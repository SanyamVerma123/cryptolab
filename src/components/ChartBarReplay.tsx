import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import { getSafeActiveChart } from "../lib/workspaceSafe";
import { getReplayDockPosition, setReplayDockPosition } from "../lib/replayDockPersistence";
import { addJournalEntry } from "../lib/journalState";
import { getLiveMarketPrice } from "../lib/marketData";
import "../styles/replay_practice.css";

interface Props {
  ws: VelaWorkspace | null;
  coin: string;
  timeframe: string;
  active: boolean;
  onClose: () => void;
}

const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 3, 5, 8];
const formatSpeed = (n: number) => `${n}x`;

interface PracticePosition {
  side: "BUY" | "SELL";
  entryPrice: number;
  amount: number;
  entryTime: number;
  mae: number;
  mfe: number;
}

interface PracticeTradeSummary {
  id: string;
  side: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  amount: number;
  pnl: number;
  pnlPercent: number;
  mae: number;
  mfe: number;
  time: string;
}

interface DockPosition { left: number; top: number }
interface SavedDockPosition { leftRatio: number; topRatio: number }

function formatTime(ms: number | null): string {
  if (ms == null) return "Choose a bar";
  return new Date(ms).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export function ChartBarReplay({ ws, coin, timeframe, active, onClose }: Props) {
  const dockRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const positionRef = useRef<DockPosition | null>(null);
  const lastCursorRef = useRef<number | null>(null);
  const scrubbingRef = useRef(false);
  const cutStartRef = useRef<number | null>(null);
  const [cutStartTime, setCutStartTime] = useState<number | null>(null);
  const [cutMode, setCutMode] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  // Practice Trading in Replay State
  const [practicePos, setPracticePos] = useState<PracticePosition | null>(null);
  const practicePosRef = useRef<PracticePosition | null>(null);
  practicePosRef.current = practicePos;
  const [sessionTrades, setSessionTrades] = useState<PracticeTradeSummary[]>([]);
  const [showSummary, setShowSummary] = useState(false);
  const [curBarPrice, setCurBarPrice] = useState<number>(0);

  const getCurrentReplayPrice = useCallback((): number => {
    if (curBarPrice > 0) return curBarPrice;
    if (!ws) return getLiveMarketPrice() || (coin === "BTC" ? 80600 : coin === "ETH" ? 2600 : 180);
    try {
      const chart = getSafeActiveChart(ws);
      if (!chart) return getLiveMarketPrice() || (coin === "BTC" ? 80600 : coin === "ETH" ? 2600 : 180);
      const readout = (chart.renderer as any)?.dataWindowReadout?.();
      if (readout?.ohlc?.close != null && readout.ohlc.close > 0) return readout.ohlc.close;
      if (chart.market?.price != null && chart.market.price > 0) return chart.market.price;
    } catch {}
    return getLiveMarketPrice() || (coin === "BTC" ? 80600 : coin === "ETH" ? 2600 : 180);
  }, [ws, curBarPrice, coin]);

  const [cursorTime, setCursorTime] = useState<number | null>(null);
  const [hoverBarTime, setHoverBarTime] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [scrubValue, setScrubValue] = useState(0);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [cursorX, setCursorX] = useState<number | null>(null);
  const [cursorY, setCursorY] = useState<number | null>(null);
  const [dockPosition, setDockPosition] = useState<DockPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth <= 768 || window.matchMedia("(pointer: coarse)").matches;
  });

  useEffect(() => {
    const check = () => {
      setIsMobile(window.innerWidth <= 768 || window.matchMedia("(pointer: coarse)").matches);
    };
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const setPosition = useCallback((next: DockPosition | null) => {
    positionRef.current = next;
    setDockPosition(next);
  }, []);

  const replay = ws?.replay;
  const bounds = replay?.bounds ?? null;
  const state = replay?.state;
  const sessionStart = cutStartTime ?? bounds?.first ?? null;
  const range = useMemo(() => {
    if (!bounds || sessionStart == null || bounds.last <= sessionStart) return null;
    return bounds.last - sessionStart;
  }, [bounds?.last, sessionStart]);

  const sync = useCallback(() => {
    const s = replay?.state;
    if (!s) return;
    setPlaying(s.playing);
    if (s.cursorTime != null) {
      lastCursorRef.current = s.cursorTime;
      setCursorTime(s.cursorTime);
    } else if (!s.active) {
      lastCursorRef.current = null;
      setCursorTime(null);
    }
    setRemaining(s.remaining ?? 0);
    const p = getCurrentReplayPrice();
    if (p > 0) {
      setCurBarPrice(p);
      const curPos = practicePosRef.current;
      if (curPos) {
        const diff = curPos.side === "BUY" ? p - curPos.entryPrice : curPos.entryPrice - p;
        const curPnl = diff * curPos.amount;
        if (curPnl < curPos.mae) curPos.mae = curPnl;
        if (curPnl > curPos.mfe) curPos.mfe = curPnl;
      }
    }
    if (!scrubbingRef.current && s.cursorTime != null && bounds) {
      const start = cutStartRef.current ?? bounds.first;
      const r = bounds.last - start;
      if (r > 0) {
        setScrubValue(Math.max(0, Math.min(1000, ((s.cursorTime - start) / r) * 1000)));
      }
    }
  }, [replay, bounds]);

  useEffect(() => {
    if (!active) return;
    if (replay?.state.active) {
      setCutMode(false);
      sync();
    } else {
      setCutMode(true);
    }
  }, [active, replay, sync]);

  useEffect(() => {
    if (!active || !replay) return;
    sync();
    const off: Array<() => void> = [];
    for (const event of ["replay:start", "replay:step", "replay:tick", "replay:play", "replay:pause", "replay:end"] as const) {
      try { off.push(replay.on(event, sync as never)); } catch { /* Vela version compatibility */ }
    }
    try {
      off.push(replay.on("replay:end", () => {
        sync();
        setPlaying(false);
        setCutMode(false);
        setCursorTime(null);
        onClose();
      }));
    } catch { /* Vela version compatibility */ }
    // Vela keeps the session clock through market changes. Poll during the short
    // timeframe reload so the toolbar does not mistake the temporary null cursor
    // for a return to live mode.
    const timer = window.setInterval(sync, 250);
    return () => { off.forEach((fn) => fn()); window.clearInterval(timer); };
  }, [active, replay, sync, onClose]);

  // Keep a user-moved dock inside the chart and remember its relative position
  // so it remains usable after a resize or reload.
  useEffect(() => {
    if (!active) return;
    const dock = dockRef.current;
    const root = dock?.closest<HTMLElement>(".vela-chart-container");
    if (!dock || !root) return;

    const maxPosition = () => ({
      left: Math.max(8, root.clientWidth - dock.offsetWidth - 8),
      top: Math.max(8, root.clientHeight - dock.offsetHeight - 8),
    });
    const saved = getReplayDockPosition();
    if (saved && !positionRef.current) {
      const max = maxPosition();
      setPosition({ left: 8 + saved.leftRatio * Math.max(0, max.left - 8), top: 8 + saved.topRatio * Math.max(0, max.top - 8) });
    }

    const observer = new ResizeObserver(() => {
      const current = positionRef.current;
      if (!current) return;
      const max = maxPosition();
      const next = { left: Math.max(8, Math.min(max.left, current.left)), top: Math.max(8, Math.min(max.top, current.top)) };
      if (next.left !== current.left || next.top !== current.top) setPosition(next);
    });
    observer.observe(root);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [active, setPosition]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const startAt = useCallback(async (from: number, isNewCut: boolean = true) => {
    if (!replay || !Number.isFinite(from)) return false;
    const min = replay.bounds?.first;
    const max = replay.bounds?.last;
    if (min == null || max == null) return false;
    const wasPlaying = replay.state.playing;
    try {
      replay.pause();
      const clamped = Math.max(min, Math.min(max, from));
      if (isNewCut) {
        cutStartRef.current = clamped;
        setCutStartTime(clamped);
      }
      await replay.start({ from: clamped });
      setCutMode(false);
      sync();
      if (wasPlaying) replay.play(Math.max(50, Math.round(1000 / speed)));
      return true;
    } catch (e) {
      console.warn("[trade-pro replay] seek failed:", e);
      return false;
    }
  }, [replay, speed, sync]);

  useEffect(() => {
    if (!active || !cutMode || !ws) return;
    let offClick: (() => void) | undefined;
    let offCrosshair: (() => void) | undefined;
    const bind = () => {
      try {
        const chart = getSafeActiveChart(ws);
        offClick?.();
        offCrosshair?.();
        offClick = chart?.renderer?.onClick?.(({ time }: { time?: number | null }) => {
          if (typeof time === "number" && Number.isFinite(time)) void startAt(time);
        });
        offCrosshair = chart?.renderer?.onCrosshairMove?.(({ time }: { time?: number | null }) => {
          if (typeof time === "number" && Number.isFinite(time)) setHoverBarTime(time);
        });
      } catch { /* chart can be rebuilding during a layout or market switch */ }
    };
    bind();
    const offActive = ws.on("cell:active", bind);
    return () => { offClick?.(); offCrosshair?.(); offActive?.(); };
  }, [active, cutMode, ws, startAt]);

  useEffect(() => {
    if (!active || !cutMode) return;
    const chart = dockRef.current?.closest<HTMLElement>(".vela-chart-container")
      ?? document.querySelector<HTMLElement>(".vela-chart-container");
    if (!chart) return;
    const move = (e: PointerEvent) => {
      const rect = chart.getBoundingClientRect();
      setCursorX(e.clientX - rect.left);
      setCursorY(e.clientY - rect.top);
    };
    chart.addEventListener("pointermove", move);
    return () => chart.removeEventListener("pointermove", move);
  }, [active, cutMode]);

  const executePracticeTrade = (side: "BUY" | "SELL") => {
    const p = getCurrentReplayPrice();
    if (p <= 0) return;
    const amount = coin === "BTC" ? 0.5 : coin === "ETH" ? 2.5 : 10;
    const newPos: PracticePosition = {
      side,
      entryPrice: p,
      amount,
      entryTime: cursorTime || Date.now(),
      mae: 0,
      mfe: 0,
    };
    practicePosRef.current = newPos;
    setPracticePos(newPos);
  };

  const closePracticeTrade = () => {
    const pos = practicePosRef.current;
    if (!pos) return;
    const exitPrice = getCurrentReplayPrice() || pos.entryPrice;
    const diff = pos.side === "BUY" ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice;
    const pnl = diff * pos.amount;
    const pnlPercent = ((exitPrice - pos.entryPrice) / pos.entryPrice) * (pos.side === "BUY" ? 1 : -1) * 100;

    const summary: PracticeTradeSummary = {
      id: `rpt_${Date.now()}`,
      side: pos.side,
      entryPrice: pos.entryPrice,
      exitPrice,
      amount: pos.amount,
      pnl: Math.round(pnl * 100) / 100,
      pnlPercent: Math.round(pnlPercent * 100) / 100,
      mae: Math.round(pos.mae * 100) / 100,
      mfe: Math.round(pos.mfe * 100) / 100,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setSessionTrades((prev) => [summary, ...prev]);

    // Automatically record to Journal
    try {
      addJournalEntry({
        symbol: `${coin}/USD`,
        side: pos.side === "BUY" ? "LONG" : "SHORT",
        entryPrice: pos.entryPrice,
        exitPrice,
        amount: pos.amount,
        pnl: Math.round(pnl * 100) / 100,
        pnlPercent: Math.round(pnlPercent * 100) / 100,
        strategy: "Replay Practice Session",
        tags: ["Replay", coin, timeframe],
        notes: `Practice trade closed at ${exitPrice}. MAE: ${Math.round(pos.mae)}, MFE: +${Math.round(pos.mfe)}`,
        mae: Math.round(pos.mae * 100) / 100,
        mfe: Math.round(pos.mfe * 100) / 100,
        source: "replay",
      });
    } catch (err) {
      console.warn("[replay] could not log practice trade to journal:", err);
    }

    practicePosRef.current = null;
    setPracticePos(null);
  };

  const exitReplay = useCallback(() => {
    if (practicePosRef.current) {
      closePracticeTrade();
    }
    try {
      replay?.stop();
    } catch (e) {
      console.warn("[trade-pro replay] stop failed:", e);
    }
    try {
      ws?.replay?.stop();
    } catch {}
    setPlaying(false);
    setCutMode(false);
    setCursorTime(null);
    cutStartRef.current = null;
    setCutStartTime(null);
    onClose();
  }, [replay, ws, onClose]);

  const enterCutMode = () => {
    if (!replay?.bounds) return;
    replay.pause();
    setCutMode(true);
  };

  const saveDockPosition = (position: DockPosition) => {
    const dock = dockRef.current;
    const root = dock?.closest<HTMLElement>(".vela-chart-container");
    if (!dock || !root) return;
    const maxLeft = Math.max(1, root.clientWidth - dock.offsetWidth - 16);
    const maxTop = Math.max(1, root.clientHeight - dock.offsetHeight - 16);
    const saved: SavedDockPosition = {
      leftRatio: Math.max(0, Math.min(1, (position.left - 8) / maxLeft)),
      topRatio: Math.max(0, Math.min(1, (position.top - 8) / maxTop)),
    };
    setReplayDockPosition(saved);
    try { ws?.context().stateChanged(); } catch { /* workspace may be shutting down */ }
  };

  const beginDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const dock = dockRef.current;
    const root = dock?.closest<HTMLElement>(".vela-chart-container");
    if (!dock || !root) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rootRect = root.getBoundingClientRect();
    const dockRect = dock.getBoundingClientRect();
    const initial = positionRef.current ?? { left: dockRect.left - rootRect.left, top: dockRect.top - rootRect.top };
    const origin = { x: event.clientX, y: event.clientY };

    const move = (e: PointerEvent) => {
      const left = Math.max(8, Math.min(root.clientWidth - dock.offsetWidth - 8, initial.left + e.clientX - origin.x));
      const top = Math.max(8, Math.min(root.clientHeight - dock.offsetHeight - 8, initial.top + e.clientY - origin.y));
      setPosition({ left, top });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      dragCleanupRef.current = null;
      setDragging(false);
      if (positionRef.current) saveDockPosition(positionRef.current);
    };
    dragCleanupRef.current?.();
    setDragging(true);
    dragCleanupRef.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  };

  const moveDockByKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const delta = event.shiftKey ? 40 : 12;
    const direction: Record<string, DockPosition> = {
      ArrowLeft: { left: -delta, top: 0 }, ArrowRight: { left: delta, top: 0 },
      ArrowUp: { left: 0, top: -delta }, ArrowDown: { left: 0, top: delta },
    };
    const vector = direction[event.key];
    if (!vector) return;
    event.preventDefault();
    const dock = dockRef.current;
    const root = dock?.closest<HTMLElement>(".vela-chart-container");
    if (!dock || !root) return;
    const dockRect = dock.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const current = positionRef.current ?? { left: dockRect.left - rootRect.left, top: dockRect.top - rootRect.top };
    const next = {
      left: Math.max(8, Math.min(root.clientWidth - dock.offsetWidth - 8, current.left + vector.left)),
      top: Math.max(8, Math.min(root.clientHeight - dock.offsetHeight - 8, current.top + vector.top)),
    };
    setPosition(next);
    saveDockPosition(next);
  };

  const togglePlayback = async () => {
    if (!replay) return;
    if (replay.state.playing) replay.pause();
    else if (replay.state.active) replay.play(Math.max(50, Math.round(1000 / speed)));
    else {
      const b = replay.bounds;
      if (!b) return;
      if (await startAt(b.first + (b.last - b.first) * 0.75)) {
        replay.play(Math.max(50, Math.round(1000 / speed)));
      }
    }
    sync();
  };

  const steppingBackRef = useRef(false);
  const stepBack = useCallback(() => {
    if (steppingBackRef.current) return;
    const start = cutStartRef.current ?? bounds?.first;
    if (cursorTime == null || !bounds || (start != null && cursorTime <= start)) return;
    steppingBackRef.current = true;
    void startAt(cursorTime - 1, false).finally(() => {
      setTimeout(() => { steppingBackRef.current = false; }, 80);
    });
  }, [bounds, cursorTime, startAt]);

  const beginScrub = () => {
    scrubbingRef.current = true;
    // A playing replay was updating the controlled range input every tick,
    // which pulled the thumb away from the pointer and made scrubbing feel
    // broken. Pause as soon as the user takes control of the timeline.
    if (replay?.state.playing) replay.pause();
    setPlaying(false);
  };

  const commitScrub = (value = scrubValue) => {
    scrubbingRef.current = false;
    if (!bounds) return;
    const start = cutStartRef.current ?? bounds.first;
    const r = bounds.last - start;
    if (r <= 0) return;
    const next = Math.max(0, Math.min(1000, value));
    setScrubValue(next);
    void startAt(start + (next / 1000) * r, false);
  };

  useEffect(() => {
    if (!active || !speedMenuOpen) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".replay-interval-wrap")) setSpeedMenuOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [active, speedMenuOpen]);

  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        if (target.getAttribute("contenteditable") === "true") return;
      }

      if (event.key === "Escape") {
        if (speedMenuOpen) { setSpeedMenuOpen(false); return; }
        exitReplay();
        return;
      }

      // Space: Toggle Play / Pause
      if (event.code === "Space" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        void togglePlayback();
        return;
      }

      // ArrowRight / KeyL: Step 1 bar forward
      if (event.key === "ArrowRight" || event.code === "KeyL") {
        event.preventDefault();
        event.stopPropagation();
        if (replay?.step()) sync();
        return;
      }

      // ArrowLeft / KeyJ: Step 1 bar backward
      if (event.key === "ArrowLeft" || event.code === "KeyJ") {
        event.preventDefault();
        event.stopPropagation();
        stepBack();
        return;
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active, cutMode, onClose, replay, speedMenuOpen, togglePlayback, sync, stepBack]);

  if (!active) return null;

  return (
    <>
      {cutMode && (
        <div className="replay-cut-layer" aria-live="polite">
          {cursorX != null && (
            <div className="replay-cut-indicator" style={{ left: cursorX }}>
              <span className="replay-cut-line" />
              <div
                className="replay-cut-scissors"
                style={{
                  top:
                    cursorY != null
                      ? Math.max(30, Math.min(cursorY - (isMobile ? 65 : 14), (window.innerHeight || 600) - 150))
                      : 80,
                }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M9.64 7.64c.23-.5.36-1.05.36-1.64 0-2.21-1.79-4-4-4S2 3.79 2 6s1.79 4 4 4c.59 0 1.14-.13 1.64-.36L10 12l-2.36 2.36C7.14 14.13 6.59 14 6 14c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4c0-.59-.13-1.14-.36-1.64L12 14l7 7h3v-1L9.64 7.64zM6 8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm0 12c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm9.64-7.64L22 4V3h-3l-7.36 7.36 4 4z"/>
                </svg>
                <span className="replay-cut-badge">
                  {hoverBarTime ? formatTime(hoverBarTime) : "Click candle to cut"}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
      {!cutMode && state?.active && (
        <div className="replay-hud-badge" aria-label="Replay status">
          <span className="replay-hud-dot" />
          <span className="replay-hud-title">REPLAY</span>
          <span className="replay-hud-sep">·</span>
          <span className="replay-hud-time">{formatTime(cursorTime)}</span>
          <span className="replay-hud-sep">·</span>
          <span className="replay-hud-remaining">{remaining.toLocaleString()} bars left</span>
        </div>
      )}
      {speedMenuOpen && (
        <div className="replay-menu-backdrop" onClick={() => setSpeedMenuOpen(false)} />
      )}
      <div
        ref={dockRef}
        className={`replay-toolbar${dragging ? " is-dragging" : ""}${cutMode ? " is-selecting" : ""}`}
        role="toolbar"
        aria-label="Bar replay controls"
        style={dockPosition ? { left: dockPosition.left, top: dockPosition.top, bottom: "auto" } : undefined}
      >
        <button className="replay-icon drag-handle" onPointerDown={beginDrag} onKeyDown={moveDockByKeyboard} title="Drag to move · use arrow keys to position" aria-label="Move replay toolbar">
          <img src="/replay-icons/drag-handle.svg" alt="" />
        </button>
        {/** Simulated Practice Trading HUD on Replay Bar */}
        {state?.active && !cutMode && (
          <div className={`replay-practice-bar ${practicePos ? "rpb-active" : ""}`}>
            {!practicePos ? (
              <>
                <span className="rpb-label">PRACTICE:</span>
                <button
                  type="button"
                  className="rpb-btn rpb-buy"
                  onClick={() => executePracticeTrade("BUY")}
                  title="Buy Market at current replay candle"
                >
                  ▲ Buy Mkt
                </button>
                <button
                  type="button"
                  className="rpb-btn rpb-sell"
                  onClick={() => executePracticeTrade("SELL")}
                  title="Sell Market at current replay candle"
                >
                  ▼ Sell Mkt
                </button>
                {sessionTrades.length > 0 && (
                  <button
                    type="button"
                    className="rpb-btn rpb-summary"
                    onClick={() => setShowSummary(true)}
                    title="View Replay Performance Summary"
                  >
                    📊 {sessionTrades.length} {sessionTrades.length === 1 ? "Trade" : "Trades"}
                  </button>
                )}
              </>
            ) : (
              <>
                <span className={`rpb-badge ${practicePos.side === "BUY" ? "rpb-long" : "rpb-short"}`}>
                  {practicePos.side === "BUY" ? "LONG" : "SHORT"} {practicePos.amount} {coin}
                </span>
                <span className="rpb-price">@{practicePos.entryPrice.toLocaleString()}</span>
                {(() => {
                  const p = curBarPrice || practicePos.entryPrice;
                  const diff = practicePos.side === "BUY" ? p - practicePos.entryPrice : practicePos.entryPrice - p;
                  const curPnl = diff * practicePos.amount;
                  const curPnlPct = ((p - practicePos.entryPrice) / practicePos.entryPrice) * (practicePos.side === "BUY" ? 1 : -1) * 100;
                  return (
                    <>
                      <span className={`rpb-pnl ${curPnl >= 0 ? "up" : "down"}`}>
                        {curPnl >= 0 ? "+" : ""}${Math.round(curPnl)} ({curPnlPct >= 0 ? "+" : ""}{curPnlPct.toFixed(2)}%)
                      </span>
                      <span className="rpb-excursion" title="Maximum Adverse / Favorable Excursion">
                        <span className="down">MAE: ${Math.round(practicePos.mae)}</span>
                        <span className="up">MFE: +${Math.round(practicePos.mfe)}</span>
                      </span>
                    </>
                  );
                })()}
                <button
                  type="button"
                  className="rpb-btn rpb-close"
                  onClick={closePracticeTrade}
                  title="Close practice trade and record to journal"
                >
                  ✕ Close
                </button>
              </>
            )}
          </div>
        )}
        <button
          type="button"
          className={`replay-icon start-point${cutMode ? " on" : ""}`}
          onClick={() => {
            if (cutMode) {
              if (state?.active) {
                setCutMode(false);
              } else {
                exitReplay();
              }
            } else {
              enterCutMode();
            }
          }}
          title={cutMode ? "Cancel cut mode" : "Select replay starting point"}
          aria-label={cutMode ? "Cancel cut mode" : "Select replay starting point"}
        >
          <img src="/replay-icons/start-point.svg" alt="" />
        </button>
        <div
          className="replay-progress-control"
          title={`Replay Cut: ${formatTime(cutStartRef.current ?? bounds?.first ?? null)} → Live: ${formatTime(bounds?.last ?? null)} | Cursor: ${formatTime(cursorTime)} (${remaining.toLocaleString()} bars left)`}
        >
          <img src="/replay-icons/progress-track.svg" alt="" />
          <span className="progress-fill" style={{ width: `${5 + (scrubValue / 1000) * 76}px` }} />
          <span className="progress-thumb" style={{ left: `${(scrubValue / 1000) * 76}px` }} />
          <input aria-label="Replay progress" type="range" min="0" max="1000" value={scrubValue}
            disabled={!bounds || (bounds.last <= (cutStartRef.current ?? bounds.first))} onChange={(event) => setScrubValue(Number(event.target.value))}
            onPointerDown={beginScrub}
            onPointerUp={(event) => commitScrub(Number(event.currentTarget.value))}
            onPointerCancel={(event) => commitScrub(Number(event.currentTarget.value))}
            onKeyDown={beginScrub}
            onKeyUp={(event) => commitScrub(Number(event.currentTarget.value))} />
        </div>
        <button className="replay-icon previous" onClick={stepBack} disabled={!state?.active || !cursorTime || !bounds || cursorTime <= bounds.first} title="Previous bar" aria-label="Previous bar">
          <img src="/replay-icons/previous-bar.svg" alt="" />
        </button>
        <button className="replay-icon play" onClick={() => void togglePlayback()} title={playing ? "Pause replay" : "Play replay"} aria-label={playing ? "Pause replay" : "Play replay"}>
          {playing ? <span className="pause-icon" /> : <img src="/replay-icons/play.svg" alt="" />}
        </button>
        <div className="replay-interval-wrap">
          <button className="replay-icon interval" aria-label={`Replay speed: ${formatSpeed(speed)}`} aria-expanded={speedMenuOpen} onClick={() => setSpeedMenuOpen((open) => !open)}>
            <span>{formatSpeed(speed)}</span><img src="/replay-icons/speed-chevron.svg" alt="" />
          </button>
          {speedMenuOpen && (
            <div className="replay-interval-menu" role="menu" aria-label="Choose replay speed">
              {SPEEDS.map((value) => (
                <button
                  key={value}
                  role="menuitemradio"
                  aria-checked={speed === value}
                  onClick={() => {
                    setSpeed(value);
                    if (replay?.state.playing) replay.play(Math.max(50, Math.round(1000 / value)));
                    setSpeedMenuOpen(false);
                  }}
                >
                  {formatSpeed(value)}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="replay-icon next" onClick={() => { if (replay?.step()) sync(); }} disabled={!state?.active || remaining === 0} title="Next bar" aria-label="Next bar">
          <img src="/replay-icons/next-bar.svg" alt="" />
        </button>
        <button
          type="button"
          className="replay-icon replay-close-btn"
          aria-label="Exit replay"
          title="Exit replay (Esc)"
          onClick={exitReplay}
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="2" y1="2" x2="12" y2="12" />
            <line x1="12" y1="2" x2="2" y2="12" />
          </svg>
        </button>
      </div>
    {/* Replay Performance Summary Modal */}
      {showSummary && (
        <div className="replay-summary-modal-overlay" onClick={() => setShowSummary(false)}>
          <div className="replay-summary-card" onClick={(e) => e.stopPropagation()}>
            <div className="rsc-head">
              <h3>📊 Replay Practice Performance Summary</h3>
              <button className="jp-btn-icon" onClick={() => setShowSummary(false)}>
                ✕
              </button>
            </div>
            <div className="rsc-body">
              <div className="rsc-stats-grid">
                <div className="rsc-stat-card">
                  <span className="rsc-stat-label">Total Trades</span>
                  <span className="rsc-stat-val">{sessionTrades.length}</span>
                </div>
                <div className="rsc-stat-card">
                  <span className="rsc-stat-label">Win Rate</span>
                  <span className="rsc-stat-val">
                    {sessionTrades.length > 0
                      ? Math.round(
                          (sessionTrades.filter((t) => t.pnl > 0).length /
                            sessionTrades.length) *
                            100
                        )
                      : 0}
                    %
                  </span>
                </div>
                <div className="rsc-stat-card">
                  <span className="rsc-stat-label">Net PnL</span>
                  {(() => {
                    const totalPnl = sessionTrades.reduce((acc, t) => acc + t.pnl, 0);
                    return (
                      <span
                        className={`rsc-stat-val ${
                          totalPnl >= 0 ? "jp-val-up" : "jp-val-down"
                        }`}
                      >
                        {totalPnl >= 0 ? "+" : ""}${Math.round(totalPnl * 100) / 100}
                      </span>
                    );
                  })()}
                </div>
              </div>

              <div>
                <span className="rsc-stat-label">Session Trades Log</span>
                <div className="rsc-trades-list">
                  <table className="rsc-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Side</th>
                        <th>Entry → Exit</th>
                        <th style={{ textAlign: "right" }}>Net PnL</th>
                        <th style={{ textAlign: "right" }}>MAE / MFE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessionTrades.map((t) => (
                        <tr key={t.id}>
                          <td>{t.time}</td>
                          <td>
                            <span
                              className={`jp-side-badge ${
                                t.side === "BUY" ? "jp-side-long" : "jp-side-short"
                              }`}
                            >
                              {t.side === "BUY" ? "LONG" : "SHORT"}
                            </span>
                          </td>
                          <td>
                            ${t.entryPrice} → ${t.exitPrice}
                          </td>
                          <td
                            style={{ textAlign: "right", fontWeight: 700 }}
                            className={t.pnl >= 0 ? "jp-val-up" : "jp-val-down"}
                          >
                            {t.pnl >= 0 ? "+" : ""}${t.pnl} ({t.pnlPercent}%)
                          </td>
                          <td style={{ textAlign: "right", fontSize: 10 }}>
                            ${t.mae} / +${t.mfe}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div className="rsc-actions">
              <button
                type="button"
                className="jp-btn jp-btn-secondary"
                onClick={() => {
                  setShowSummary(false);
                  try { replay?.stop(); } catch {}
                  setPlaying(false);
                  setCursorTime(null);
                  onClose();
                }}
              >
                Exit Replay
              </button>
              <button
                type="button"
                className="jp-btn jp-btn-primary"
                onClick={() => {
                  setShowSummary(false);
                  window.dispatchEvent(new CustomEvent("tradepro:open-journal"));
                }}
              >
                Open in Journal 📓
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
