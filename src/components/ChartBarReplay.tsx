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

const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 3, 5];
const formatSpeed = (n: number) => `${n}x`;

interface DockPosition { left: number; top: number }
interface SavedDockPosition { leftRatio: number; topRatio: number }

function toLocalInput(ms: number): string {
  const date = new Date(ms);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(ms - offset).toISOString().slice(0, 16);
}

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
  const [cutMode, setCutMode] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [cursorTime, setCursorTime] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [scrubValue, setScrubValue] = useState(0);
  const [showDate, setShowDate] = useState(false);
  const [dateValue, setDateValue] = useState("");
  const [cursorX, setCursorX] = useState<number | null>(null);
  const [dockPosition, setDockPosition] = useState<DockPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

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
    setCursorTime(s.cursorTime);
    setRemaining(s.remaining ?? 0);
    if (s.cursorTime && bounds && range) {
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
    // The native event stream remains authoritative; this short poll also catches
    // workspace state changes caused by timeframe switches while replay is active.
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
  }, [active, setPosition, collapsed]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  useEffect(() => {
    if (!active || !cutMode || !ws) return;
    let offClick: (() => void) | undefined;
    const bind = () => {
      try {
        const chart = ws.active ? ws.chart : null;
        offClick?.();
        offClick = chart?.renderer?.onClick?.(({ time }: { time?: number | null }) => {
          if (typeof time === "number" && Number.isFinite(time)) void startAt(time);
        });
      } catch { /* chart can be rebuilding during a layout or market switch */ }
    };
    bind();
    const offActive = ws.on("cell:active", bind);
    return () => { offClick?.(); offActive?.(); };
  }, [active, cutMode, ws]);

  useEffect(() => {
    if (!active || !cutMode) return;
    const chart = dockRef.current?.closest<HTMLElement>(".vela-chart-container")
      ?? document.querySelector<HTMLElement>(".vela-chart-container");
    if (!chart) return;
    const move = (e: PointerEvent) => setCursorX(e.clientX - chart.getBoundingClientRect().left);
    chart.addEventListener("pointermove", move);
    return () => chart.removeEventListener("pointermove", move);
  }, [active, cutMode]);

  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      try { replay?.stop(); } catch {}
      setPlaying(false);
      setCutMode(false);
      setCursorTime(null);
      onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active, onClose, replay]);

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
    setShowDate(false);
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

  const resetDockPosition = () => {
    setPosition(null);
    setReplayDockPosition(null);
    try { ws?.context().stateChanged(); } catch { /* workspace may be shutting down */ }
  };

  const seekToDate = async () => {
    const ms = new Date(dateValue).getTime();
    if (!Number.isFinite(ms)) return;
    if (await startAt(ms)) setShowDate(false);
  };

  const togglePlayback = async () => {
    if (!replay) return;
    if (replay.state.playing) replay.pause();
    else if (replay.state.active) replay.play(Math.max(50, Math.round(1000 / speed)));
    else {
      const b = replay.bounds;
      if (!b) return;
      await startAt(b.first + (b.last - b.first) * 0.75);
      replay.play(Math.max(50, Math.round(1000 / speed)));
    }
    sync();
  };

  const commitScrub = () => {
    if (!bounds || !range) return;
    void startAt(bounds.first + (scrubValue / 1000) * range);
  };

  if (!active) return null;

  return (
    <>
      {cutMode && <div className="replay-cut-layer" aria-live="polite">
        {cursorX != null && <span className="replay-cut-line" style={{ left: cursorX }} />}
        <div className="replay-cut-hint">Click a candle, use the timeline, or choose a date <button onClick={() => setCutMode(false)} aria-label="Cancel start-bar selection">Cancel</button></div>
      </div>}
      {!cutMode && state?.active && <div className="replay-watermark" aria-hidden="true">{coin} · {timeframe}<small>BAR REPLAY</small></div>}
      <div ref={dockRef} className={`replay-dock${dragging ? " is-dragging" : ""}${collapsed ? " is-collapsed" : ""}${cutMode ? " is-selecting" : ""}`} role="toolbar" aria-label="Bar replay controls"
        style={dockPosition ? { left: dockPosition.left, top: dockPosition.top, bottom: "auto" } : undefined}>
        <button className="replay-drag-handle" onPointerDown={beginDrag} onKeyDown={moveDockByKeyboard} title="Drag to move · use arrow keys to position" aria-label="Move replay toolbar">
          <span className="replay-grip" aria-hidden="true">⠿</span><span className="replay-badge">{cutMode ? "PICK BAR" : "REPLAY"}</span>
        </button>
        <button className="replay-control replay-primary" onClick={togglePlayback} title={playing ? "Pause replay" : "Play replay"} aria-label={playing ? "Pause replay" : "Play replay"}>{playing ? "Ⅱ" : "▶"}</button>
        {!collapsed && <>
          <button className="replay-control" onClick={() => cutMode ? setCutMode(false) : enterCutMode()} title={cutMode ? "Cancel start-bar selection" : "Choose a different start bar"}>⌖ <span>{cutMode ? "Cancel" : "Start"}</span></button>
          <button className="replay-control" onClick={() => { replay?.step(); sync(); }} disabled={!state?.active || remaining === 0} title="Step forward one bar" aria-label="Step forward one bar">▶|</button>
          <label className="replay-speed" title="Replay speed">
            <select aria-label="Replay speed" value={speed} onChange={(e) => {
              const next = Number(e.target.value); setSpeed(next);
              if (replay?.state.playing) replay.play(Math.max(50, Math.round(1000 / next)));
            }}>
              {SPEEDS.map((n) => <option key={n} value={n}>{formatSpeed(n)}</option>)}
            </select>
          </label>
          <span className="replay-time">{formatTime(cursorTime)}</span>
          <span className="replay-remaining">{remaining.toLocaleString()} bars left</span>
          <div className="replay-scrubber-wrap">
            <input aria-label="Replay timeline" className="replay-scrubber" type="range" min="0" max="1000" value={scrubValue}
              disabled={!bounds || !range} onChange={(e) => setScrubValue(Number(e.target.value))} onPointerUp={commitScrub} onKeyUp={commitScrub} />
          </div>
          <div className="replay-date-wrap">
            <button className="replay-control" onClick={() => {
              setDateValue(cursorTime ? toLocalInput(cursorTime) : bounds ? toLocalInput(bounds.last) : "");
              setShowDate((v) => !v);
            }} title="Go to date and time" aria-label="Go to date and time">▦</button>
            {showDate && <div className="replay-date-popover">
              <input className="replay-date-input" type="datetime-local" value={dateValue} min={bounds ? toLocalInput(bounds.first) : undefined}
                max={bounds ? toLocalInput(bounds.last) : undefined} onChange={(e) => setDateValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void seekToDate(); }} />
              <button className="replay-date-go" onClick={() => void seekToDate()}>Go to time</button>
            </div>}
          </div>
          <span className="replay-position-actions">
            <button className="replay-control" onClick={resetDockPosition} title="Reset toolbar position" aria-label="Reset toolbar position">↺</button>
            <button className="replay-control replay-collapse" onClick={() => setCollapsed(true)} title="Minimize replay controls" aria-label="Minimize replay controls">−</button>
          </span>
        </>}
        {collapsed && <button className="replay-control replay-expand" onClick={() => setCollapsed(false)} title="Expand replay controls" aria-label="Expand replay controls">＋</button>}
        <button className="replay-control replay-exit" onClick={exitReplay} title="Exit replay" aria-label="Exit replay">✕</button>
      </div>
    </>
  );
}
