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

const SPEEDS = [0.5, 1, 2, 4, 8];
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
  const [cutMode, setCutMode] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [cursorTime, setCursorTime] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [scrubValue, setScrubValue] = useState(0);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [cursorX, setCursorX] = useState<number | null>(null);
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

  const commitScrub = () => {
    if (!bounds || !range) return;
    void startAt(bounds.first + (scrubValue / 1000) * range);
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
      if (event.key !== "Escape") return;
      if (speedMenuOpen) { setSpeedMenuOpen(false); return; }
      if (cutMode) { setCutMode(false); return; }
      try { replay?.stop(); } catch {}
      setPlaying(false);
      setCursorTime(null);
      onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active, cutMode, onClose, replay, speedMenuOpen]);

  if (!active) return null;

  return (
    <>
      {cutMode && <div className="replay-cut-layer" aria-live="polite">
        {cursorX != null && <span className="replay-cut-line" style={{ left: cursorX }} />}
        <div className="replay-cut-hint">Click a candle or scrub to a starting bar <button onClick={() => setCutMode(false)} aria-label="Cancel start-bar selection">Cancel</button></div>
      </div>}
      {!cutMode && state?.active && <div className="replay-watermark" aria-hidden="true">{coin} · {timeframe}<small>BAR REPLAY</small></div>}
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
            onPointerUp={commitScrub} onKeyUp={commitScrub} />
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
