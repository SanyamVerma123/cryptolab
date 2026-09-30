import React, { useState, useEffect, useRef, useCallback } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import type { OHLCV } from "@luxalgo/vela";
import { liveBars } from "../lib/marketData";

interface Props {
  ws: VelaWorkspace | null;
  coin: string;
  timeframe: string;
  active: boolean;
  onClose: () => void;
}

export function ChartBarReplay({ ws, coin, timeframe, active, onClose }: Props) {
  const [fullBars, setFullBars] = useState<OHLCV[]>([]);
  const [cutIndex, setCutIndex] = useState<number>(-1);
  const [initialCutIndex, setInitialCutIndex] = useState<number>(-1);
  const [cutMode, setCutMode] = useState<boolean>(true);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [speed, setSpeed] = useState<number>(1000); // ms per bar
  const [cursorX, setCursorX] = useState<number | null>(null);
  const [isPinned, setIsPinned] = useState<boolean>(false);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number } | null>(null);
  const playerRef = useRef<HTMLDivElement | null>(null);
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initialize bars when active opens
  useEffect(() => {
    if (!active || !ws) {
      setIsPlaying(false);
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      return;
    }

    const chartRaw = ((ws.chart as unknown as { orchestrator?: { rawBars?: OHLCV[] } })?.orchestrator?.rawBars) || [];
    const sourceBars = chartRaw.length > 20 ? [...chartRaw] : [...liveBars()];

    if (sourceBars.length > 10) {
      setFullBars(sourceBars);
      setCutMode(true);
      const initCut = Math.max(15, Math.floor(sourceBars.length * 0.8));
      setCutIndex(initCut);
      setInitialCutIndex(initCut);
    } else {
      console.warn("[trade-pro replay] waiting for bars to load");
    }
  }, [active, ws]);

  // Handle cut selection click on the chart
  const applyCutAtTime = useCallback((timeMs: number) => {
    if (!ws || fullBars.length === 0) return;

    let targetIdx = fullBars.findIndex((b) => b.time >= timeMs);
    if (targetIdx === -1) targetIdx = fullBars.length - 1;
    targetIdx = Math.max(15, Math.min(targetIdx, fullBars.length - 1));

    setCutIndex(targetIdx);
    setInitialCutIndex(targetIdx);
    const sliced = fullBars.slice(0, targetIdx + 1);

    try {
      ws.chart.setMarket({ symbol: coin, timeframe, data: sliced });
    } catch (e) {
      console.error("[trade-pro replay] failed to setMarket sliced:", e);
    }

    setCutMode(false);
  }, [ws, fullBars, coin, timeframe]);

  // Handle Esc key
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (cutMode) {
          setCutMode(false);
        } else {
          handleExit();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, cutMode]);

  // Mouse move and click listener on chart for Cut mode
  useEffect(() => {
    if (!active || !cutMode || !ws) return;

    const rootEl = ws.root;
    if (!rootEl) return;

    const onPointerMove = (e: PointerEvent) => {
      const rect = rootEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setCursorX(x);
    };

    const onPointerDown = (e: MouseEvent) => {
      if (playerRef.current && playerRef.current.contains(e.target as Node)) {
        return;
      }

      const target = e.target as HTMLElement;
      if (target?.closest?.(".vela-axis") || target?.closest?.(".vela-bottombar")) {
        return;
      }

      const crossTime = ws.active?.lastCrossTime;
      if (crossTime && crossTime > 0) {
        e.preventDefault();
        e.stopPropagation();
        applyCutAtTime(crossTime);
      } else {
        try {
          const coords = (ws.chart as unknown as { renderer?: { coords?: { xToLogical: (x: number) => number; logicalToTime: (l: number) => number } } })?.renderer?.coords;
          if (coords) {
            const rect = rootEl.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const logical = coords.xToLogical(x);
            const time = coords.logicalToTime(logical);
            if (time > 0) {
              e.preventDefault();
              e.stopPropagation();
              applyCutAtTime(time);
            }
          }
        } catch {}
      }
    };

    rootEl.addEventListener("pointermove", onPointerMove);
    rootEl.addEventListener("click", onPointerDown, true);

    return () => {
      rootEl.removeEventListener("pointermove", onPointerMove);
      rootEl.removeEventListener("click", onPointerDown, true);
    };
  }, [active, cutMode, ws, fullBars, applyCutAtTime]);

  // Step 1 bar forward
  const stepForward = useCallback(() => {
    if (!ws || fullBars.length === 0 || cutIndex >= fullBars.length - 1) {
      setIsPlaying(false);
      return;
    }
    const nextIdx = cutIndex + 1;
    setCutIndex(nextIdx);
    const sliced = fullBars.slice(0, nextIdx + 1);
    try {
      ws.chart.setMarket({ symbol: coin, timeframe, data: sliced });
    } catch (e) {
      console.error("[trade-pro replay] stepForward error:", e);
    }
  }, [ws, fullBars, cutIndex, coin, timeframe]);

  // Jump to start cut bar
  const jumpToStartBar = useCallback(() => {
    if (!ws || fullBars.length === 0) return;
    const targetIdx = initialCutIndex >= 0 ? initialCutIndex : 15;
    setCutIndex(targetIdx);
    const sliced = fullBars.slice(0, targetIdx + 1);
    try {
      ws.chart.setMarket({ symbol: coin, timeframe, data: sliced });
    } catch (e) {
      console.error("[trade-pro replay] jumpToStartBar error:", e);
    }
  }, [ws, fullBars, initialCutIndex, coin, timeframe]);

  // Auto-play interval effect
  useEffect(() => {
    if (!isPlaying) {
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
      return;
    }

    playTimerRef.current = setInterval(() => {
      stepForward();
    }, speed);

    return () => {
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
    };
  }, [isPlaying, speed, stepForward]);

  // Exit replay and restore real-time market
  const handleExit = () => {
    setIsPlaying(false);
    if (playTimerRef.current) clearInterval(playTimerRef.current);
    if (ws) {
      try {
        ws.chart.setMarket({ symbol: coin, timeframe });
      } catch (e) {
        console.error("[trade-pro replay] exit setMarket error:", e);
      }
    }
    onClose();
  };

  // Draggable toolbar handler
  const handleDragStart = (e: React.MouseEvent) => {
    if (isPinned) return;
    setIsDragging(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: position.x,
      startY: position.y,
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const onDragMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.mouseX;
      const dy = e.clientY - dragStartRef.current.mouseY;
      setPosition({
        x: dragStartRef.current.startX + dx,
        y: dragStartRef.current.startY + dy,
      });
    };

    const onDragEnd = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);
    return () => {
      window.removeEventListener("mousemove", onDragMove);
      window.removeEventListener("mouseup", onDragEnd);
    };
  }, [isDragging]);

  if (!active) return null;

  const currentBar = fullBars[cutIndex] || null;
  const currentFormattedDate = currentBar
    ? new Date(currentBar.time).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "";

  const barsLeft = Math.max(0, fullBars.length - 1 - cutIndex);

  return (
    <>
      {/* Background Chart Watermark (matching LuxAlgo Quant / Image 2 & 4) */}
      <div
        className="tv-replay-watermark"
        style={{
          position: "absolute",
          top: "45%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          userSelect: "none",
          zIndex: 5,
          opacity: 0.12,
        }}
      >
        <div style={{ fontSize: "42px", fontWeight: 800, color: "#ffffff", letterSpacing: "1px" }}>
          {coin} · {timeframe}
        </div>
        <div style={{ fontSize: "28px", fontWeight: 700, color: "#ffffff", marginTop: "4px" }}>
          ◂◂ Replay
        </div>
      </div>

      {/* Cut mode vertical tracking line and banner */}
      {cutMode && (
        <div
          className="tv-replay-cut-overlay"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 35,
            pointerEvents: "none",
          }}
        >
          {/* Blue vertical line tracking cursor */}
          {cursorX !== null && cursorX > 0 && (
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 32,
                left: `${cursorX}px`,
                width: "2px",
                background: "#2962FF",
                boxShadow: "0 0 8px rgba(41, 98, 255, 0.6)",
                pointerEvents: "none",
              }}
            />
          )}

          {/* Bottom pill tooltip: Bar replay: click the bar to start from (Esc cancels) */}
          <div
            style={{
              position: "absolute",
              bottom: "48px",
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(18, 22, 33, 0.92)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              backdropFilter: "blur(8px)",
              color: "#e2e8f0",
              padding: "7px 18px",
              borderRadius: "20px",
              fontSize: "13px",
              fontWeight: 500,
              boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
              pointerEvents: "auto",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span>Bar replay: click the bar to start from (Esc cancels)</span>
            <button
              onClick={() => setCutMode(false)}
              style={{
                background: "transparent",
                border: "none",
                color: "#94a3b8",
                cursor: "pointer",
                padding: "2px 4px",
                fontSize: "12px",
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Floating Replay Player Bar (Image 2 style) */}
      <div
        ref={playerRef}
        className={`tv-replay-player-pill ${isDragging ? "dragging" : ""}`}
        style={{
          position: "absolute",
          bottom: "36px",
          left: "50%",
          transform: `translate(calc(-50% + ${position.x}px), ${position.y}px)`,
          zIndex: 40,
          background: "#12151d",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "8px",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.65)",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "5px 10px",
          userSelect: "none",
          fontSize: "13px",
          color: "#e2e8f0",
        }}
      >
        {/* Drag handle */}
        <div
          onMouseDown={handleDragStart}
          style={{
            cursor: isPinned ? "default" : "grab",
            padding: "0 4px",
            color: "#64748b",
            fontSize: "14px",
            letterSpacing: "1px",
          }}
          title={isPinned ? "Toolbar pinned" : "Drag toolbar"}
        >
          ⋮⋮
        </div>

        {/* Start Bar button */}
        <button
          onClick={jumpToStartBar}
          style={{
            background: "transparent",
            border: "none",
            color: "#cbd5e1",
            display: "flex",
            alignItems: "center",
            gap: "5px",
            padding: "4px 8px",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "12px",
            fontWeight: 600,
          }}
          title="Jump to cut start bar"
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <span style={{ fontSize: "11px" }}>|◀</span>
          <span>Start bar</span>
        </button>

        {/* Play / Pause button */}
        <button
          onClick={() => setIsPlaying((p) => !p)}
          style={{
            background: isPlaying ? "rgba(37, 99, 235, 0.2)" : "transparent",
            border: "none",
            color: isPlaying ? "#60a5fa" : "#cbd5e1",
            padding: "4px 8px",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "14px",
          }}
          title={isPlaying ? "Pause" : "Play"}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = isPlaying ? "rgba(37, 99, 235, 0.2)" : "transparent")}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>

        {/* Step Forward button */}
        <button
          onClick={stepForward}
          disabled={cutIndex >= fullBars.length - 1}
          style={{
            background: "transparent",
            border: "none",
            color: cutIndex >= fullBars.length - 1 ? "#475569" : "#cbd5e1",
            padding: "4px 8px",
            borderRadius: "4px",
            cursor: cutIndex >= fullBars.length - 1 ? "not-allowed" : "pointer",
            fontSize: "13px",
          }}
          title="Step forward 1 bar"
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          ▶|
        </button>

        {/* Speed Selector */}
        <div style={{ position: "relative" }}>
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            style={{
              background: "rgba(255, 255, 255, 0.06)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              borderRadius: "4px",
              color: "#cbd5e1",
              fontSize: "12px",
              padding: "3px 6px",
              cursor: "pointer",
              outline: "none",
            }}
            title="Speed"
          >
            <option value={100}>10x</option>
            <option value={200}>5x</option>
            <option value={500}>2x</option>
            <option value={1000}>1x</option>
            <option value={2000}>0.5x</option>
            <option value={5000}>0.2x</option>
            <option value={10000}>0.1x</option>
          </select>
        </div>

        {/* Divider */}
        <div style={{ width: "1px", height: "18px", background: "rgba(255, 255, 255, 0.12)", margin: "0 2px" }} />

        {/* Timestamp Display */}
        <div style={{ fontSize: "12px", color: "#cbd5e1", padding: "0 4px", fontWeight: 500 }}>
          {currentFormattedDate}
        </div>

        {/* Bars left counter */}
        <div style={{ fontSize: "12px", color: "#94a3b8", padding: "0 4px" }}>
          {barsLeft} bars left
        </div>

        {/* Pin toggle */}
        <button
          onClick={() => setIsPinned((p) => !p)}
          style={{
            background: isPinned ? "rgba(255, 255, 255, 0.15)" : "transparent",
            border: "none",
            color: isPinned ? "#60a5fa" : "#94a3b8",
            padding: "4px 6px",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "13px",
          }}
          title={isPinned ? "Unpin toolbar" : "Pin toolbar"}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = isPinned ? "rgba(255, 255, 255, 0.15)" : "transparent")}
        >
          📌
        </button>

        {/* Exit Button */}
        <button
          onClick={handleExit}
          style={{
            background: "transparent",
            border: "none",
            color: "#94a3b8",
            padding: "4px 6px",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 700,
          }}
          title="Exit Replay"
          onMouseEnter={(e) => (e.currentTarget.style.color = "#f87171")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#94a3b8")}
        >
          ✕
        </button>
      </div>
    </>
  );
}
