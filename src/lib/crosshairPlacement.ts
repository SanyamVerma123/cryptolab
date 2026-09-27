/**
 * crosshairPlacement — let Vela's OWN touch handling do everything.
 *
 * HISTORY: this module once intercepted touch-origin pointer events on the
 * chart, swallowed them, and re-issued synthetic pointer events at an offset
 * crosshair point. That reliably broke Vela's selection and panning on real
 * glass — after placing a drawing, tapping it did nothing (no move/resize
 * handles, no delete) and the whole chart froze. The synthetic stream is not
 * equivalent to real input for Vela's pan/selection machinery.
 *
 * CURRENT DESIGN: this module does NOT touch any pointer event. It only:
 *   1. Reflects Vela's armed-tool state onto a CSS class (`tool-armed`), which
 *      hides the system cursor while placing and pins `touch-action: none` on
 *      the chart so a finger drag cannot scroll or pinch-zoom the page mid-
 *      placement. Vela owns the gesture entirely.
 *   2. Disarms the tool once a drawing has been created, so the chart returns
 *      to normal immediately — tap the drawing and Vela gives you its native
 *      move/resize handles and the delete button in the settings popup.
 *
 * Everything else is Vela's default behaviour, unchanged.
 */
import type { VelaWorkspace } from "@luxalgo/vela/workspace";

export function installCrosshairPlacement(ws: VelaWorkspace): () => void {
  let armed = false;

  const hostEl = (): HTMLElement | null =>
    document.querySelector(".chart-host") as HTMLElement | null;

  const apply = (on: boolean) => {
    armed = on;
    const h = hostEl();
    if (h) h.classList.toggle("tool-armed", on);
    document.body.classList.toggle("tool-armed", on);
  };

  try {
    apply(!!ws.chart.drawings.getTool());
  } catch {
    /* chart not ready yet */
  }

  // Tool armed / disarmed (toolbar click, one-shot tool finishing, or a
  // programmatic setTool — this is the single source of truth for "placing?").
  const offTool = ws.chart.on(
    "drawing:tool",
    (p: { type: string | null }) => apply(!!p?.type)
  );

  // A drawing was finalized — disarm the tool so normal touch resumes at once:
  // the chart can pan again and a tap on the drawing selects it natively
  // (move/resize handles + delete in its popup).
  const offCreated = ws.chart.on("drawing:created", () => {
    try {
      ws.chart.drawings.setTool(null);
    } catch {
      apply(false);
    }
  });

  return () => {
    offTool?.();
    offCreated?.();
    apply(false);
  };
}
