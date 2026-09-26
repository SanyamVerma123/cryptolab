/**
 * AiPanel — floating, draggable AI chat window.
 *
 * Per the user's requests:
 *   - the AI circle at the LEFT side of the chart is DELETED. The window now
 *     opens from the topbar "✦ AI" button and the "Show AI chat" tab in the
 *     right panel — both drive the same controlled open state.
 *   - the window is draggable by its header and, on open, parks at the right
 *     side of the chart host (never under the drawing toolbar on the left).
 *   - the AI can PLOT on the chart: natural phrases map onto Vela's own
 *     drawing + native-indicator surface, so "draw a trend line", "mark the
 *     FVG box", "ema 200" all land on the real chart.
 *   - a real LLM endpoint drops into `respond()` later without touching UI.
 */
import { useEffect, useRef, useState } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import { AiSettings } from "./AiSettings";
import {
  sendToAI,
  applyActions,
  findFVGs,
  visibleBars,
  readChartState,
  describeChart,
  type ChartAction,
} from "../lib/aiClient";
import { visibleBarsInRange } from "../lib/marketData";

interface Props {
  ws: VelaWorkspace | null;
  /** Controlled open state — the topbar button and the panel tab both set it. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open the Pine Script editor from this panel's button. */
  onPineOpen: () => void;
}

interface Msg {
  who: "user" | "bot";
  text: string;
}

export function AiPanel({ ws, open, onOpenChange, onPineOpen }: Props) {
  const [log, setLog] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // The "endpoint URL + API key + model" settings, inline above the chat.
  const [showSettings, setSettingsOpen] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);

  // Park the panel on the right side of the chart host when it opens — never
  // on the left, where Vela's drawing toolbar lives.
  useEffect(() => {
    if (!open || !panelRef.current) return;
    const host = panelRef.current.closest(".chart-host") as HTMLElement | null;
    if (!host) return;
    const hr = host.getBoundingClientRect();
    // measure first so width is known
    panelRef.current.style.left = "auto";
    panelRef.current.style.top = "12px";
    panelRef.current.style.right = "12px";
    void hr;
  }, [open]);

  // Dragging by the header. Pure pointer-delta math: the offset from the
  // pointer to the panel's top-left is captured on pointerdown, then the
  // panel is positioned so that offset stays constant. No getBoundingClientRect
  // on move, so the panel never jumps on grab.
  const onHeadDown = (e: React.PointerEvent) => {
    const el = panelRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = {
      sx: e.clientX, sy: e.clientY,
      px: e.clientX - r.left, py: e.clientY - r.top,
    };
  };
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      const el = panelRef.current;
      if (!d || !el) return;
      // Position in the .chart-host's coordinate space.
      const host = el.closest(".chart-host") as HTMLElement | null;
      const hr = host ? host.getBoundingClientRect() : { left: 0, top: 0 };
      el.style.right = "auto";
      el.style.left = e.clientX - hr.left - d.px + "px";
      el.style.top = e.clientY - hr.top - d.py + "px";
    };
    const up = () => { drag.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const respond = async (raw: string) => {
    const say = (text: string) => setLog((l) => [...l, { who: "bot", text }]);
    if (!ws) {
      say("Chart isn't ready yet — try again in a moment.");
      return;
    }

    // Pull the bars ON SCREEN so the AI marks where the user is looking, not
    // hundreds of bars back in history. `getVisibleRange` is the chart's own
    // viewport; if it's unavailable we fall back to the recent tail.
    let range: { from: number; to: number } | null = null;
    try {
      range = ws.chart.getVisibleRange();
    } catch {
      range = null;
    }
    const bars = visibleBarsInRange(range);

    // READ THE CHART: describe what's actually on it — drawings, indicators,
    // price — so the AI can answer "what do you see". Without this it only
    // knows the symbol and can only guess, which is why it said there's
    // nothing on the chart.
    const chartState = readChartState(ws);

    const ctx = {
      symbol: (ws.chart.market?.symbol as string) ?? "?",
      timeframe: (ws.chart.market?.timeframe as string) ?? "?",
      bars,
      chart: chartState,
    };

    setBusy(true);
    let reply;
    try {
      reply = await sendToAI(raw, ctx);
    } finally {
      setBusy(false);
    }

    // FVG is special-cased: the AI decides to mark gaps, but detection runs
    // here on real bars (the model can't see them unless the webhook asks).
    const wantsFVG = /fvg|fair value gap/i.test(raw);
    if (wantsFVG && bars.length > 2) {
      const gaps = findFVGs(bars);
      if (gaps.length) {
        const acts: ChartAction[] = gaps.map((g) => ({
          type: "plotAt",
          tool: "box",
          anchors: [
            { time: g.from, price: g.top },
            { time: g.to, price: g.bottom },
          ],
        }));
        const done = applyActions(ws, acts);
        say(
          `Marked ${gaps.length} fair value gap${gaps.length > 1 ? "s" : ""} on the visible bars (${gaps[0].up ? "bullish" : "bearish"} most recent). ` +
            reply.reply,
        );
        void done;
        return;
      }
      say("No clean fair value gaps on the visible bars. I armed the Box tool so you can mark one manually.");
      applyActions(ws, [{ type: "draw", tool: "box" }]);
      return;
    }

    const done = applyActions(ws, reply.actions ?? []);
    say(reply.reply + (done.length ? "\n" + done.join("\n") : ""));
  };

  const send = () => {
    const v = draft.trim();
    if (!v || busy) return;
    setLog((l) => [...l, { who: "user", text: v }]);
    setDraft("");
    void respond(v);
  };

  if (!open) return null;

  return (
    <div className="ai-panel" ref={panelRef} role="dialog" aria-label="AI Assistant">
      <div className="ai-head" onPointerDown={onHeadDown}>
        <span className="ai-dot" />
        <span className="ai-title">AI Assistant</span>
        <button
          className="ai-x"
          title="AI model settings — endpoint URL and API key"
          onClick={() => setSettingsOpen((v) => !v)}
          aria-label="AI model settings"
        >
          ⚙
        </button>
        <button
          className="ai-x"
          onClick={() => onOpenChange(false)}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {showSettings && (
        <AiSettings
          onStatus={(text) => setLog((l) => [...l, { who: "bot", text }])}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <div className="ai-log" ref={logRef}>
        {!log.length && (
          <div className="ai-msg bot">
            Hi — I'm the chart AI. I can read the live chart, mark fair value
            gaps, arm drawing tools, add indicators, and run Pine scripts. Ask
            in plain English: “mark fvg”, “trend line”, “ema 200”, “pine
            plot(ta.rsi(close,14))”.
          </div>
        )}
        {log.map((mm, i) => (
          <div className={"ai-msg " + mm.who} key={i}>
            {mm.text}
          </div>
        ))}
        {busy && <div className="ai-msg bot ai-thinking">thinking…</div>}
      </div>
      <div className="ai-input">
        <input
          placeholder="Ask the AI…"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
        />
        <button onClick={send} disabled={busy}>Send</button>
        <button
          className="ai-pine-btn"
          title="Open the Pine Script editor"
          onClick={() => onPineOpen()}
        >
          Pine
        </button>
      </div>
    </div>
  );
}
