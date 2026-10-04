import React, { useState, useEffect, useRef, useCallback } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";

interface Props {
  ws: VelaWorkspace | null;
  coin: string;
  timeframe: string;
  active: boolean;
  onClose: () => void;
}

export function ChartBarReplay({ ws, coin, timeframe, active, onClose }: Props) {
  const [cutMode, setCutMode] = useState<boolean>(true);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [speed, setSpeed] = useState<number>(1000); // ms per bar
  const [cursorX, setCursorX] = useState<number | null>(null);
  const [isPinned, setIsPinned] = useState<boolean>(false);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number } | null>(null);
  const playerRef = useRef<HTMLDivElement | null>(null);

  const [currentCursorTime, setCurrentCursorTime] = useState<number | null>(null);
  const [initialCutTime, setInitialCutTime] = useState<number | null>(null);
  const [barsLeft, setBarsLeft] = useState<number>(0);

  // Synchronize with Vela's native WorkspaceReplay
  useEffect(() => {
    if (!active || !ws) {
      setIsPlaying(false);
      return;
    }

    const replay = ws.replay;
    if (!replay) return;

    // Check existing state
    const s = replay.state;
    if (s?.active) {
      setCutMode(false);
      setIsPlaying(s.playing ?? false);
      if (s.cursorTime) setCurrentCursorTime(s.cursorTime);
      if (s.remaining !== undefined) setBarsLeft(s.remaining);
    } else {
      setCutMode(true);
    }

    // Subscribe to native WorkspaceReplay events
    const offs: (() => void)[] = [];

    try {
      const offStart = replay.on("replay:start", (e: any) => {
        setCutMode(false);
        if (e?.cursorTime) {
          setCurrentCursorTime(e.cursorTime);
          if (!initialCutTime) setInitialCutTime(e.cursorTime);
        }
        if (e?.remaining !== undefined) setBarsLeft(e.remaining);
      });
      if (typeof offStart === "function") offs.push(offStart);

      const offStep = replay.on("replay:step", (e: any) => {
        if (e?.cursorTime) setCurrentCursorTime(e.cursorTime);
        if (e?.remaining !== undefined) setBarsLeft(e.remaining);
      });
      if (typeof offStep === "function") offs.push(offStep);

      const offPlay = replay.on("replay:play", () => setIsPlaying(true));
      if (typeof offPlay === "function") offs.push(offPlay);

      const offPause = replay.on("replay:pause", () => setIsPlaying(false));
      if (typeof offPause === "function") offs.push(offPause);

      const offEnd = replay.on("replay:end", () => {
        setIsPlaying(false);
        setBarsLeft(0);
      });
      if (typeof offEnd === "function") offs.push(offEnd);
    } catch (e) {
      console.warn("[trade-pro replay] event listener registration failed:", e);
    }

    return () => {
      offs.forEach((fn) => {
        try {
          fn();
        } catch {}
      });
    };
  }, [active, ws, initialCutTime]);

  // Apply cut at specified timestamp
  const applyCutAtTime = useCallback(
    async (timeMs: number) => {
      if (!ws?.replay) return;
      try {
        await ws.replay.start({ from: timeMs });
        setInitialCutTime(timeMs);
        setCurrentCursorTime(timeMs);
        setCutMode(false);
      } catch (e) {
        console.error("[trade-pro replay] start replay failed:", e);
      }
    },
    [ws]
  );

  // Listen for candle clicks in cut mode directly via chart renderer onClick
  useEffect(() => {
    if (!active || !cutMode || !ws) return;

    let offClick: (() => void) | undefined;
    const bindClick = () => {
      const chart = ws.active ? ws.chart : null;
      if (chart?.renderer?.onClick) {
        try {
          offClick = chart.renderer.onClick(({ time }: { time?: number | null }) => {
            if (time && time > 0) {
              void applyCutAtTime(time);
            }
          });
        } catch {}
      }
    };

    bindClick();
    const offCellActive = ws.on("cell:active", bindClick);

    return () => {
      offClick?.();
      offCellActive?.();
    };
  }, [active, cutMode, ws, applyCutAtTime]);

  // Pointer move on chart container for the cut line indicator
  useEffect(() => {
    if (!active || !cutMode) return;

    const container = document.querySelector(".vela-chart-container") as HTMLElement | null;
    if (!container) return;

    const onPointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setCursorX(x);
    };

    container.addEventListener("pointermove", onPointerMove);
    return () => container.removeEventListener("pointermove", onPointerMove);
  }, [active, cutMode]);

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

  // Step 1 bar forward
  const stepForward = useCallback(() => {
    if (!ws?.replay) return;
    try {
      ws.replay.step();
      const s = ws.replay.state;
      if (s?.cursorTime) setCurrentCursorTime(s.cursorTime);
      if (s?.remaining !== undefined) setBarsLeft(s.remaining);
    } catch (e) {
      console.warn("[trade-pro replay] step error:", e);
    }
  }, [ws]);

  // Jump to start cut bar
  const jumpToStartBar = useCallback(async () => {
    if (!ws?.replay) return;
    if (initialCutTime) {
      await ws.replay.start({ from: initialCutTime });
    } else {
      const bounds = ws.replay.bounds;
      if (bounds?.first) {
        const fallback = bounds.first + (bounds.last - bounds.first) * 0.7;
        await ws.replay.start({ from: fallback });
      }
    }
  }, [ws, initialCutTime]);

  // Play / Pause toggle
  const togglePlay = useCallback(() => {
    if (!ws?.replay) return;
    try {
      if (isPlaying) {
        ws.replay.pause();
        setIsPlaying(false);
      } else {
        // If replay hasn't started yet, auto-cut at 75% history
        if (!ws.replay.state?.active) {
          const bounds = ws.replay.bounds;
          const from = bounds?.first ? bounds.first + (bounds.last - bounds.first) * 0.75 : Date.now() - 3600000 * 24;
          void ws.replay.start({ from }).then(() => {
            ws.replay.play(speed);
            setIsPlaying(true);
          });
        } else {
          ws.replay.play(speed);
          setIsPlaying(true);
        }
      }
    } catch (e) {
      console.warn("[trade-pro replay] play toggle error:", e);
    }
  }, [ws, isPlaying, speed]);

  // Exit replay and restore live market
  const handleExit = () => {
    setIsPlaying(false);
    if (ws?.replay) {
      try {
        ws.replay.stop();
      } catch (e) {
        console.warn("[trade-pro replay] stop error:", e);
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

  const currentFormattedDate = currentCursorTime
    ? new Date(currentCursorTime).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "";

  return (
    <>
      {/* Background Chart Watermark (subtle, exactly like LuxAlgo Quant reference) */}
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
          zIndex: 4,
          opacity: 0.08,
        }}
      >
        <div style={{ fontSize: "28px", fontWeight: 700, color: "#ffffff", letterSpacing: "1px" }}>
          {coin} · {timeframe}
        </div>
        <div style={{ fontSize: "20px", fontWeight: 600, color: "#ffffff", marginTop: "3px" }}>
          ◂◂ Replay
        </div>
      </div>

      {/* Cut mode: vertical line with red cursor and bottom instruction pill */}
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
          {/* 1px Blue vertical line tracking cursor */}
          {cursorX !== null && cursorX > 0 && (
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 32,
                left: `${cursorX}px`,
                width: "1px",
                background: "#2962FF",
                boxShadow: "0 0 4px rgba(41, 98, 255, 0.5)",
                pointerEvents: "none",
              }}
            />
          )}

          {/* Bottom instruction banner */}
          <div
            style={{
              position: "absolute",
              bottom: "16px",
              left: "50%",
              transform: "translateX(-50%)",
              background: "#1e222d",
              border: "1px solid #2a2e39",
              color: "#d1d4dc",
              padding: "6px 16px",
              borderRadius: "20px",
              fontSize: "12px",
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
              onClick={() => handleExit()}
              style={{
                background: "transparent",
                border: "none",
                color: "#787b86",
                cursor: "pointer",
                padding: "2px 4px",
                fontSize: "11px",
                lineHeight: 1,
              }}
              title="Cancel replay"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Real Replay Player Bar at bottom (visible once cut bar is selected) */}
      {!cutMode && (
        <div
          ref={playerRef}
          className={`tv-replay-player-pill ${isDragging ? "dragging" : ""}`}
          style={{
            position: "absolute",
            bottom: "14px",
            left: "50%",
            transform: `translate(calc(-50% + ${position.x}px), ${position.y}px)`,
            zIndex: 40,
            background: "#1e222d",
            border: "1px solid #2a2e39",
            borderRadius: "6px",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.55)",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            padding: "4px 8px",
            userSelect: "none",
            fontSize: "12px",
            color: "#d1d4dc",
            height: "34px",
            boxSizing: "border-box",
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
          onClick={togglePlay}
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
          style={{
            background: "transparent",
            border: "none",
            color: "#cbd5e1",
            padding: "4px 8px",
            borderRadius: "4px",
            cursor: "pointer",
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
            onChange={(e) => {
              const newSpeed = Number(e.target.value);
              setSpeed(newSpeed);
              if (isPlaying && ws?.replay) {
                ws.replay.play(newSpeed);
              }
            }}
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
        {currentFormattedDate && (
          <div style={{ fontSize: "12px", color: "#cbd5e1", padding: "0 4px", fontWeight: 500 }}>
            {currentFormattedDate}
          </div>
        )}

        {/* Bars left counter */}
        {barsLeft > 0 && (
          <div style={{ fontSize: "12px", color: "#94a3b8", padding: "0 4px" }}>
            {barsLeft} bars left
          </div>
        )}

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
      )}
    </>
  );
}
