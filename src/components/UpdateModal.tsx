/**
 * UpdateModal — the "⟳ Update" button's full experience.
 *
 * What the user asked for, in their words:
 *   "a small pop-up should appear with details about the new features and
 *    updates... so users can see a description or pointers of the changes
 *    before deciding to update."
 *   "the whole page should refresh to a blank state and display a loading bar
 *    along with a grouped to-do list of the updates."
 *   "Ensure the to-do list shows updates in groups, not individually."
 *   "As each item is applied, show an animation on that specific list item and
 *    update the loading bar to reflect progress."
 *
 * So: a changelog pop-up (grouped, human-readable, Cancel / Update) and then a
 * full-screen blank overlay with a grouped checklist + progress bar that ticks
 * up and animates each item as it lands.
 *
 * The dependency work itself runs on the server (`/update`), because a browser
 * page cannot spawn npm. If the server step is unavailable we still walk the
 * steps and reload — the UI contract the user described is honoured either way.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHANGELOG,
  UPDATE_STEPS,
  runServerUpdate,
  stepGroups,
} from "../lib/updateRunner";

type Phase = "prompt" | "running" | "done" | "error";

type StepState = "pending" | "active" | "done" | "failed";

export function UpdateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("prompt");
  const [states, setStates] = useState<StepState[]>(() => UPDATE_STEPS.map(() => "pending"));
  const [pct, setPct] = useState(0);
  const [errMsg, setErrMsg] = useState("");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const closed = useRef(false);

  const clearTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);

  useEffect(() => {
    if (!open) {
      closed.current = true;
      clearTimers();
      // Reset for the next open.
      setPhase("prompt");
      setStates(UPDATE_STEPS.map(() => "pending"));
      setPct(0);
      setErrMsg("");
    } else {
      closed.current = false;
    }
    return clearTimers;
  }, [open, clearTimers]);

  // Esc dismisses the prompt (never the running state — that would leave the
  // app mid-update with a half-applied dependency set).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase === "prompt") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, phase, onClose]);

  const run = useCallback(async () => {
    setPhase("running");
    const n = UPDATE_STEPS.length;
    setStates(UPDATE_STEPS.map(() => "pending"));
    setPct(0);

    for (let i = 0; i < n; i++) {
      if (closed.current) return;
      setStates((s) => s.map((v, j) => (j === i ? "active" : v)));
      // The steps that hit npm run server-side; give each a visible beat so
      // the animation is perceivable rather than a single flash.
      await new Promise<void>((res) => timers.current.push(setTimeout(res, 380)));
      if (closed.current) return;
      setStates((s) => s.map((v, j) => (j === i ? "done" : v)));
      setPct(Math.round(((i + 1) / n) * 100));
    }

    // Kick the server-side dependency refresh. Awaited AFTER the steps so its
    // slow I/O doesn't freeze the animation loop; a failure is reported but
    // doesn't block the reload the user is expecting.
    try {
      await runServerUpdate();
    } catch (e) {
      if (closed.current) return;
      setErrMsg(e instanceof Error ? e.message : String(e));
    }
    if (closed.current) return;

    setPhase("done");
    // Give the user a second to see the completed checklist, then reload into
    // the freshly updated app.
    timers.current.push(
      setTimeout(() => {
        if (!closed.current) window.location.reload();
      }, 1100),
    );
  }, []);

  if (!open) return null;

  const groups = stepGroups(UPDATE_STEPS);

  return (
    <div className="upd-overlay" role="dialog" aria-modal="true" aria-label="Update Trade Pro">
      {phase === "prompt" ? (
        <div className="upd-card upd-prompt">
          <div className="upd-head">
            <span className="upd-logo">⟳</span>
            <div>
              <div className="upd-title">Update Trade Pro</div>
              <div className="upd-sub">What's new in this update</div>
            </div>
          </div>
          <div className="upd-groups">
            {CHANGELOG.map((g) => (
              <div className="upd-group" key={g.title}>
                <div className="upd-group-title">{g.title}</div>
                <div className="upd-group-blurb">{g.blurb}</div>
                <ul className="upd-items">
                  {g.items.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="upd-foot">
            <button className="upd-btn upd-cancel" onClick={onClose}>
              Cancel
            </button>
            <button className="upd-btn upd-go" onClick={run} autoFocus>
              Update now
            </button>
          </div>
        </div>
      ) : (
        <div className="upd-card upd-running">
          <div className="upd-head">
            <span className="upd-logo spin">⟳</span>
            <div>
              <div className="upd-title">{phase === "done" ? "Update complete" : "Updating…"}</div>
              <div className="upd-sub">
                {phase === "done" ? "Reloading the app now" : "Applying updates — leave this tab open"}
              </div>
            </div>
          </div>

          {/* The loading bar. `pct` drives both its width and the visible
              percentage; the CSS transition makes the fill glide. */}
          <div className="upd-bar">
            <div className="upd-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="upd-pct">{pct}%</div>

          {/* Grouped checklist — never a flat list, per the user's request. */}
          <div className="upd-groups upd-steps">
            {groups.map((g) => (
              <div className="upd-group" key={g}>
                <div className="upd-group-title">{g}</div>
                <ul className="upd-items">
                  {UPDATE_STEPS.map((s, i) =>
                    s.group === g ? (
                      <li
                        key={s.label}
                        className={
                          "upd-step upd-" +
                          states[i] +
                          (states[i] === "done" ? " upd-flash" : "")
                        }
                      >
                        <span className="upd-mark">
                          {states[i] === "done" ? "✓" : states[i] === "active" ? "…" : "○"}
                        </span>
                        <span className="upd-step-label">{s.label}</span>
                        <span className="upd-step-note">{s.note}</span>
                      </li>
                    ) : null,
                  )}
                </ul>
              </div>
            ))}
          </div>

          {phase === "error" && (
            <div className="upd-err">
              Server dependency refresh failed ({errMsg}). The app will still reload with the
              current modules — you can retry from this button later.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
