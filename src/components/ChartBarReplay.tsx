import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import { getReplayDockPosition, setReplayDockPosition } from "../lib/replayDockPersistence";

interface Props {
  ws: VelaWorkspace | null;
  coin: string;
  timeframe: string;
  active: boolean;
  onClose: () => void;
}

const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 3, 5, 8];
const formatSpeed = (n: number) => `${n}x`;

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
  const [cutMode, setCutMode] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [cursorTime, setCursorTime] = useState<number | null>(null);
  const [hoverBarTime, setHoverBarTime] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [scrubValue, setScrubValue] = useState(0);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [cursorX, setCursorX] = useState<number | null>(null);
  const [cursorY, setCursorY] = useState<number | null>(null);
  const [dockPosition, setDockPosition] = useState<DockPosition | null>(null);
  const [dragging, setDragging] = useState(false);

  const setPosition = useCallback((next: DockPosition | null) => {
    positionRef.current = next;
    setDockPosition(next);
  }, []);

  const replay = ws?.replay;
  const bounds = replay?.bounds ?? null;
  const state = replay?.state;
  const range = useMemo(() => {
    if (!bounds || bounds.last <= bounds.first) return null;
    return bounds.last - bounds.first;
  }, [bounds?.first, bounds?.last]);

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
    if (!scrubbingRef.current && s.cursorTime != null && bounds && range) {
      setScrubValue(Math.max(0, Math.min(1000, ((s.cursorTime - bounds.first) / range) * 1000)));
    }
  }, [replay, bounds, range]);

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

  const startAt = useCallback(async (from: number) => {
    if (!replay || !Number.isFinite(from)) return false;
    const min = replay.bounds?.first;
    const max = replay.bounds?.last;
    if (min == null || max == null) return false;
    const wasPlaying = replay.state.playing;
    try {
      replay.pause();
      await replay.start({ from: Math.max(min, Math.min(max, from)) });
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
        const chart = ws.active ? ws.chart : null;
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

  const exitReplay = useCallback(() => {
    try { replay?.stop(); } catch (e) { console.warn("[trade-pro replay] stop failed:", e); }
    setPlaying(false);
    setCutMode(false);
    setCursorTime(null);
    onClose();
  }, [replay, onClose]);

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

  const stepBack = () => {
    if (cursorTime == null || !bounds || cursorTime <= bounds.first) return;
    // `cursorTime` is the open time of the last visible candle. Seeking one
    // millisecond before it excludes that candle and reveals the prior one.
    void startAt(cursorTime - 1);
  };

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
    if (!bounds || !range) return;
    const next = Math.max(0, Math.min(1000, value));
    setScrubValue(next);
    void startAt(bounds.first + (next / 1000) * range);
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
        if (cutMode) { setCutMode(false); return; }
        try { replay?.stop(); } catch {}
        setPlaying(false);
        setCursorTime(null);
        onClose();
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
                  top: cursorY != null ? Math.max(30, Math.min(cursorY - 14, (window.innerHeight || 600) - 150)) : 80,
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
          <div className="replay-cut-hint">
            <span style={{ color: "#f23645", fontWeight: 700, fontSize: "14px" }}>✂</span>
            <span>Click any candle on the chart to start bar replay from that point</span>
            <button onClick={() => setCutMode(false)} aria-label="Cancel start-bar selection">Cancel</button>
          </div>
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
      <div ref={dockRef} className={`replay-toolbar${dragging ? " is-dragging" : ""}${cutMode ? " is-selecting" : ""}`} role="toolbar" aria-label="Bar replay controls"
        style={dockPosition ? { left: dockPosition.left, top: dockPosition.top, bottom: "auto" } : undefined}>
        <button className="replay-icon drag-handle" onPointerDown={beginDrag} onKeyDown={moveDockByKeyboard} title="Drag to move · use arrow keys to position" aria-label="Move replay toolbar">
          <img src="/replay-icons/drag-handle.svg" alt="" />
        </button>
        <button className="replay-icon start-point" onClick={() => cutMode ? setCutMode(false) : enterCutMode()} title={cutMode ? "Cancel start point" : "Select replay starting point"} aria-label={cutMode ? "Cancel start point" : "Select replay starting point"}>
          <img src="/replay-icons/start-point.svg" alt="" />
        </button>
        <div className="replay-progress-control" title={`${formatTime(cursorTime)} · ${remaining.toLocaleString()} bars remaining`}>
          <img src="/replay-icons/progress-track.svg" alt="" />
          <span className="progress-fill" style={{ width: `${5 + (scrubValue / 1000) * 76}px` }} />
          <span className="progress-thumb" style={{ left: `${(scrubValue / 1000) * 76}px` }} />
          <input aria-label="Replay progress" type="range" min="0" max="1000" value={scrubValue}
            disabled={!bounds || !range} onChange={(event) => setScrubValue(Number(event.target.value))}
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
          {speedMenuOpen && <div className="replay-interval-menu" role="menu" aria-label="Choose replay speed">
            {SPEEDS.map((value) => <button key={value} role="menuitemradio" aria-checked={speed === value} onClick={() => {
              setSpeed(value);
              if (replay?.state.playing) replay.play(Math.max(50, Math.round(1000 / value)));
              setSpeedMenuOpen(false);
            }}>{formatSpeed(value)}</button>)}
          </div>}
        </div>
        <button className="replay-icon next" onClick={() => { if (replay?.step()) sync(); }} disabled={!state?.active || remaining === 0} title="Next bar" aria-label="Next bar">
          <img src="/replay-icons/next-bar.svg" alt="" />
        </button>
        <button className="replay-icon toggle" role="switch" aria-checked={active} aria-label="Enable replay" title={active ? "Exit replay" : "Enable replay"} onClick={exitReplay}>
          <img src="/replay-icons/toggle.svg" alt="" />
          {active && <span className="enabled-toggle"><span /></span>}
        </button>
      </div>
    </>
  );
}
