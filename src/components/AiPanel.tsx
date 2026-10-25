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
 *   - chart-aware AI requests flow through the configured provider in `respond()`.
 */
import { useEffect, useRef, useState } from "react";
import { BarChart3, LoaderCircle, Send, Settings2, Sparkles, Trash2, X } from "lucide-react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import { getSafeActiveChart } from "../lib/workspaceSafe";
import { AiSettings } from "./AiSettings";
import {
  sendToAI,
  applyActions,
  findFVGs,
  visibleBars,
  supportResistanceActions,
  readChartState,
  describeChart,
  type ChartAction,
} from "../lib/aiClient";

interface Props {
  ws: VelaWorkspace | null;
  /** Controlled open state — optional when embedded inline */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Open the Pine Script editor from this panel's button. */
  onPineOpen: () => void;
  /** Render embedded inside side panel instead of as a floating window */
  inline?: boolean;
}

interface Msg {
  who: "user" | "bot";
  text: string;
  at: number;
}

export function AiPanel({ ws, open = true, onOpenChange, onPineOpen, inline = false }: Props) {
  const [log, setLog] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // The "endpoint URL + API key + model" settings, inline above the chat.
  const [showSettings, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);

  // Park the panel on the right side of the chart host when it opens (floating only)
  useEffect(() => {
    if (inline || !open || !panelRef.current) return;
    const host = panelRef.current.closest(".chart-host") as HTMLElement | null;
    if (!host) return;
    const hr = host.getBoundingClientRect();
    panelRef.current.style.left = "auto";
    panelRef.current.style.top = "12px";
    panelRef.current.style.right = "12px";
    void hr;
  }, [open, inline]);

  // Dragging by the header. Pure pointer-delta math: the offset from the
  // pointer to the panel's top-left is captured on pointerdown, then the
  // panel is positioned so that offset stays constant. No getBoundingClientRect
  // on move, so the panel never jumps on grab.
  const onHeadDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
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
    const say = (text: string) => setLog((l) => [...l, { who: "bot", text, at: Date.now() }]);
    if (busyRef.current) return;
    if (!ws) {
      say("Chart isn't ready yet — try again in a moment.");
      return;
    }
    busyRef.current = true;
    setBusy(true);

    try {
      // Pull the bars ON SCREEN so the AI marks where the user is looking, not
      // hundreds of bars back in history. Fall back to the recent tail if the
      // chart viewport isn't ready yet.
      const bars = await visibleBars(ws);

      // Support/resistance is an explicit drawing command. Resolve it from
      // Vela's active bars and don't let an LLM turn it into an indicator or
      // return placeholder coordinates such as time 0/1.
      const markRequest = /\b(mark|draw|plot|show|place|find|detect|identify|add)\b/i.test(raw);
      if (markRequest && /\b(support|resistance|s\/r|key levels?)\b/i.test(raw)) {
        if (bars.length < 5) {
          say("The active chart has not loaded enough bars to find support or resistance yet. Wait for the chart candles to load, then retry.");
          return;
        }
        const result = supportResistanceActions(raw, bars);
        if (!result.actions.length) {
          say("I couldn't identify a support or resistance level in the visible candles. Scroll the chart to the area you want and retry.");
          return;
        }
        const done = await applyActions(ws, result.actions);
        say(`Marked ${result.labels.join(" and ")} on the active chart.${done.length ? `\n${done.join("\n")}` : ""}`);
        return;
      }

      // Include actual drawings, indicators and price so chart questions use
      // the current workspace instead of guessing.
      const chartState = readChartState(ws, bars);

      const activeChart = getSafeActiveChart(ws);
      const ctx = {
        symbol: (activeChart?.market?.symbol as string) ?? "?",
        timeframe: (activeChart?.market?.timeframe as string) ?? "?",
        bars,
        chart: chartState,
      };

      const reply = await sendToAI(raw, ctx);

      // FVG detection stays deterministic and uses the visible bars. The LLM
      // describes the result; it does not guess coordinates for the boxes.
      const wantsFVG = /\b(mark|draw|plot|show|find|detect|identify)\b/i.test(raw) && /fvg|fair value gap/i.test(raw);
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
          const done = await applyActions(ws, acts);
          say(
            `Marked ${gaps.length} fair value gap${gaps.length > 1 ? "s" : ""} on the visible bars (${gaps[0].up ? "bullish" : "bearish"} most recent).` +
              (done.length ? `\n${done.join("\n")}` : "") + `\n${reply.reply}`,
          );
          return;
        }
        say("No clean fair value gaps on the visible bars. I armed the Box tool so you can mark one manually.");
        const done = await applyActions(ws, [{ type: "draw", tool: "box" }]);
        if (done.length) say(done.join("\n"));
        return;
      }

      const done = await applyActions(ws, reply.actions ?? []);
      say(reply.reply + (done.length ? "\n" + done.join("\n") : ""));
    } catch (e) {
      say(`The AI request failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  if (!open && !inline) return null;

  const quickPrompts = ["Mark FVGs", "Add EMA 200", "Read this chart"];
  const submitPrompt = (raw: string) => {
    const text = raw.trim();
    if (!text || busyRef.current) return;
    setLog((l) => [...l, { who: "user", text, at: Date.now() }]);
    setDraft("");
    void respond(text);
  };

  return (
    <div
      className={"ai-panel" + (inline ? " inline" : "")}
      ref={inline ? undefined : panelRef}
      role="region"
      aria-label="AI Assistant"
    >
      <div className="ai-head" onPointerDown={inline ? undefined : onHeadDown}>
        <span className="ai-brand-icon"><Sparkles size={15} /></span>
        <span className="ai-heading-copy"><span className="ai-title">Chart assistant</span><span className="ai-subtitle">Ask, analyze, or mark up</span></span>
        <span className={"ai-connection" + (ws ? " is-ready" : "")}><i />{ws ? "Chart ready" : "Connecting"}</span>
        <button
          className={"ai-icon-btn" + (showSettings ? " is-active" : "")}
          title="AI model settings — endpoint URL and API key"
          onClick={() => setSettingsOpen((v) => !v)}
          aria-label="AI model settings"
        >
          <Settings2 size={15} />
        </button>
        {!!log.length && <button className="ai-icon-btn" title="Clear conversation" aria-label="Clear conversation" onClick={() => setLog([])}><Trash2 size={14} /></button>}
        {!inline && onOpenChange && (
          <button className="ai-icon-btn" onClick={() => onOpenChange(false)} aria-label="Close"><X size={16} /></button>
        )}
      </div>

      {showSettings && (
        <AiSettings
          onStatus={(text) => setLog((l) => [...l, { who: "bot", text, at: Date.now() }])}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <div className="ai-log" ref={logRef}>
        {!log.length && (
          <div className="ai-empty-state">
            <span className="ai-empty-icon"><BarChart3 size={19} /></span>
            <strong>Your chart, in context</strong>
            <p>Ask about the current market, find a setup, or tell me what to draw. Chart actions are applied directly to this workspace.</p>
            <span className="ai-empty-note">Choose a prompt below to get started</span>
          </div>
        )}
        {log.map((mm, i) => (
          <div className={"ai-message-row " + mm.who} key={`${mm.at}-${i}`}>
            {mm.who === "bot" && <span className="ai-message-avatar"><Sparkles size={12} /></span>}
            <div className="ai-message-body">
              <div className="ai-message-meta">{mm.who === "user" ? "You" : "Chart assistant"}<time>{new Date(mm.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>
              <div className="ai-msg">{mm.text}</div>
            </div>
          </div>
        ))}
        {busy && (
          <div className="ai-working"><LoaderCircle size={14} className="ai-spinner" /><span>Reading chart context and preparing a response…</span>
          </div>
        )}
      </div>

      {/* Quick Prompts Bar */}
      <div className="ai-quick-prompts">
        {quickPrompts.map((qp) => (
          <button
            key={qp}
            type="button"
            className="ai-qp-chip"
            disabled={busy}
            onClick={() => submitPrompt(qp)}
          >
            {qp}
          </button>
        ))}
      </div>

      <form className="ai-composer" onSubmit={(event) => { event.preventDefault(); submitPrompt(draft); }}>
        <div className="ai-composer-box">
          <textarea aria-label="Message the chart assistant" value={draft} rows={2} placeholder="Ask about price action or request a chart mark…" disabled={busy} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitPrompt(draft); } }} />
          <button type="submit" className="ai-send-btn" aria-label="Send message" disabled={busy || !draft.trim()}><Send size={15} /></button>
        </div>
        <div className="ai-composer-footer"><button type="button" className="ai-pine-btn" title="Open the Pine Script editor" onClick={onPineOpen}>Open Pine Script</button><span>Enter to send · Shift+Enter for a new line</span></div>
      </form>
    </div>
  );
}
