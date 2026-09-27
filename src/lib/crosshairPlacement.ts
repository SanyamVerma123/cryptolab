/**
 * crosshairPlacement — Mobile & Touch Drawing Placement Controller
 *
 * Implements TradingView-style crosshair drawing workflow specifically
 * for touch devices (phones and tablets), while keeping desktop mouse drawing
 * 100% native and untouched.
 *
 * UX on Touch / Mobile:
 *   1. Crosshair appears when a drawing tool is armed.
 *      - Full-width horizontal line & full-height vertical line.
 *      - Small center intersection dot (crisp & non-obstructive).
 *      - Live price chip on the right axis and live time chip on the bottom axis.
 *      - Top floating HUD displaying tool name, step instruction, and Cancel (✕) button.
 *   2. Drag moves the CROSSHAIR, NOT the chart:
 *      - One-finger drag moves the crosshair smoothly across the chart without finger occlusion.
 *      - Live price & time chips update continuously as the crosshair moves.
 *      - Two-finger pinch still zooms the chart time scale.
 *   3. Tap anywhere (<250ms, <10px) places the anchor at the current crosshair coordinates.
 *   4. Multi-point tools: Tap 1 places point 1, HUD updates to Point 2, dragging updates ghost line
 *      connecting to crosshair, Tap 2 places point 2 and finalizes.
 *   5. Disarm & teardown: on drawing:created or cancel, overlay is destroyed immediately and
 *      native Vela touch interaction (pan, pinch, tap existing drawing for handles/delete) resumes.
 *   6. Desktop mouse: untouched, completely native Vela behavior.
 */
import type { VelaWorkspace } from "@luxalgo/vela/workspace";

export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    navigator.maxTouchPoints > 0 ||
    "ontouchstart" in window
  );
}

const TOOL_NAMES: Record<string, string> = {
  trendline: "Trend Line",
  horizontal_line: "Horizontal Line",
  horizontal_ray: "Horizontal Ray",
  vertical_line: "Vertical Line",
  ray: "Ray",
  arrow: "Arrow",
  extended_line: "Extended Line",
  parallel_channel: "Parallel Channel",
  fib_retracement: "Fib Retracement",
  fib_extension: "Fib Extension",
  rectangle: "Rectangle",
  circle: "Circle",
  ellipse: "Ellipse",
  triangle: "Triangle",
  path: "Path",
  polyline: "Polyline",
  text: "Text",
  callout: "Callout",
  brush: "Brush",
  highlighter: "Highlighter",
  measure: "Measure",
  long_position: "Long Position",
  short_position: "Short Position",
  price_range: "Price Range",
  date_range: "Date Range",
  date_price_range: "Date & Price Range",
};

function getToolDisplayName(toolId: string): string {
  if (TOOL_NAMES[toolId]) return TOOL_NAMES[toolId];
  return toolId
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatAxisPrice(r: any, pane: any, price: number): string {
  try {
    const mintick = r?.scene?.priceMintick;
    if (mintick && mintick > 0) {
      const decimals = Math.max(0, -Math.floor(Math.log10(mintick)));
      return price.toFixed(decimals);
    }
  } catch {}
  if (Math.abs(price) >= 1000) return price.toFixed(2);
  if (Math.abs(price) >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

function formatAxisTime(timeMs: number): string {
  if (!timeMs || isNaN(timeMs)) return "--";
  const d = new Date(timeMs);
  const month = d.toLocaleDateString(undefined, { month: "short" });
  const day = d.getDate();
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${month} ${day} ${hours}:${mins}`;
}

export function installCrosshairPlacement(ws: VelaWorkspace): () => void {
  let overlayEl: HTMLDivElement | null = null;
  let lineH: HTMLDivElement | null = null;
  let lineV: HTMLDivElement | null = null;
  let centerDot: HTMLDivElement | null = null;
  let priceChip: HTMLDivElement | null = null;
  let timeChip: HTMLDivElement | null = null;
  let hudTitle: HTMLDivElement | null = null;
  let hudStep: HTMLDivElement | null = null;
  let resizeObserver: ResizeObserver | null = null;

  let currentCrosshairX = 0;
  let currentCrosshairY = 0;

  interface DragState {
    pointerId: number;
    startX: number;
    startY: number;
    startTime: number;
    moved: boolean;
    startCrosshairX: number;
    startCrosshairY: number;
  }
  let dragState: DragState | null = null;
  const activePointers = new Map<number, { x: number; y: number }>();
  let pinchStartDist = 0;
  let pinchStartSpacing = 0;

  const getRenderer = () => (ws.chart?.renderer as any)?.renderer;

  const teardown = () => {
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
    lineH = null;
    lineV = null;
    centerDot = null;
    priceChip = null;
    timeChip = null;
    hudTitle = null;
    hudStep = null;
    dragState = null;
    activePointers.clear();
    pinchStartDist = 0;
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    const host = document.querySelector(".chart-host");
    if (host) host.classList.remove("tool-armed");
    document.body.classList.remove("tool-armed");
  };

  const updateChipsAndLines = (x: number, y: number) => {
    const r = getRenderer();
    if (!r?.coords || !overlayEl) return;

    const cw = r.coords.width || overlayEl.clientWidth || 300;
    const ch = r.coords.height || overlayEl.clientHeight || 300;
    const cx = Math.max(0, Math.min(cw, Math.round(x)));
    const cy = Math.max(0, Math.min(ch, Math.round(y)));

    currentCrosshairX = cx;
    currentCrosshairY = cy;

    if (lineH) {
      lineH.style.top = `${cy}px`;
      lineH.style.width = `${cw}px`;
    }
    if (lineV) {
      lineV.style.left = `${cx}px`;
      lineV.style.height = `${ch}px`;
    }
    if (centerDot) {
      centerDot.style.left = `${cx}px`;
      centerDot.style.top = `${cy}px`;
    }

    // Price at crosshair Y
    let pane = r.scene?.panes?.get("price");
    if (!pane && r.scene?.panes) {
      for (const p of r.scene.panes.values()) {
        if (cy >= p.bounds.top && cy <= p.bounds.top + p.bounds.height) {
          pane = p;
          break;
        }
      }
    }
    if (!pane && r.scene?.panes) {
      pane = [...r.scene.panes.values()][0];
    }

    if (priceChip && pane && pane.scale && pane.bounds) {
      try {
        const price = r.coords.yToPrice(cy, pane.scale, pane.bounds);
        priceChip.textContent = formatAxisPrice(r, pane, price);
        priceChip.style.top = `${cy}px`;
        const maxLeft = (overlayEl.clientWidth || cw) - 64;
        priceChip.style.left = `${Math.min(cw + 2, maxLeft)}px`;
      } catch {
        priceChip.textContent = "--";
      }
    }

    // Time at crosshair X
    if (timeChip) {
      try {
        const logical = r.coords.xToLogical(cx);
        const timeMs = r.coords.logicalToTime(logical);
        timeChip.textContent = formatAxisTime(timeMs);
        timeChip.style.left = `${cx}px`;
        const maxTop = (overlayEl.clientHeight || ch) - 24;
        timeChip.style.top = `${Math.min(ch + 2, maxTop)}px`;
      } catch {
        timeChip.textContent = "--";
      }
    }
  };

  const cancelDrawing = () => {
    try {
      const r = getRenderer();
      r?.userDrawings?.cancelPlacement?.();
      ws.chart.drawings.setTool(null);
    } catch (e) {
      console.warn("[trade-pro] cancel tool failed:", e);
    }
    teardown();
  };

  const placePointAtCrosshair = () => {
    const r = getRenderer();
    if (!r?.coords || !r?.userDrawings) return;

    const snap = ws.chart.drawings.getSnapMode?.() ?? "off";

    // Commit anchor point in Vela at current crosshair position
    try {
      r.userDrawings.pointerDown(currentCrosshairX, currentCrosshairY, snap, false, false);
      r.userDrawings.pointerUp(currentCrosshairX, currentCrosshairY, snap);
    } catch (err) {
      console.error("[trade-pro] error placing point at crosshair:", err);
    }

    // Check interaction state after placement
    const state = r.userDrawings?.interaction?.state;
    if (state?.kind === "placing") {
      const placed = state.draft?.anchors?.length ?? 1;
      const need = state.need ?? 2;
      if (hudStep) {
        if (placed >= need - 1) {
          hudStep.textContent = `Point ${placed + 1}: Drag crosshair, tap to complete`;
        } else {
          hudStep.textContent = `Point ${placed + 1} of ${need}: Drag crosshair, tap to place`;
        }
      }
      // Update ghost preview line to current crosshair
      r.userDrawings.pointerMove(currentCrosshairX, currentCrosshairY, snap, false, false);
    }
  };

  const setupOverlay = (toolType: string) => {
    // Only touch devices get the center mobile crosshair
    if (!isTouchDevice()) return;

    const r = getRenderer();
    if (!r) return;

    teardown();

    const host = document.querySelector(".chart-host");
    if (host) host.classList.add("tool-armed");
    document.body.classList.add("tool-armed");

    // Parent to mount inside: r.plot gives 1:1 pixel parity with chart panes
    const mountParent = r.plot || r.wrapper || host;
    if (!mountParent) return;

    // Initial position: center of chart plot area
    const cw = r.coords?.width || mountParent.clientWidth || 300;
    const ch = r.coords?.height || mountParent.clientHeight || 300;
    currentCrosshairX = Math.round(cw / 2);
    currentCrosshairY = Math.round(ch / 2);

    // Overlay container
    overlayEl = document.createElement("div");
    overlayEl.className = "mobile-draw-overlay";

    // Horizontal line
    lineH = document.createElement("div");
    lineH.className = "mobile-crosshair-h";
    overlayEl.appendChild(lineH);

    // Vertical line
    lineV = document.createElement("div");
    lineV.className = "mobile-crosshair-v";
    overlayEl.appendChild(lineV);

    // Center dot marker (small & crisp)
    centerDot = document.createElement("div");
    centerDot.className = "mobile-crosshair-dot";
    overlayEl.appendChild(centerDot);

    // Right axis price chip
    priceChip = document.createElement("div");
    priceChip.className = "mobile-crosshair-price-chip";
    priceChip.textContent = "--";
    overlayEl.appendChild(priceChip);

    // Bottom axis time chip
    timeChip = document.createElement("div");
    timeChip.className = "mobile-crosshair-time-chip";
    timeChip.textContent = "--";
    overlayEl.appendChild(timeChip);

    // Floating HUD at top
    const hud = document.createElement("div");
    hud.className = "mobile-draw-hud";

    const hudInfo = document.createElement("div");
    hudInfo.className = "mobile-draw-hud-info";

    hudTitle = document.createElement("div");
    hudTitle.className = "mobile-draw-tool-name";
    hudTitle.textContent = getToolDisplayName(toolType);
    hudInfo.appendChild(hudTitle);

    hudStep = document.createElement("div");
    hudStep.className = "mobile-draw-step-hint";
    hudStep.textContent = "Point 1: Drag to move crosshair, tap anywhere to place";
    hudInfo.appendChild(hudStep);

    hud.appendChild(hudInfo);

    // Cancel (✕) button
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "mobile-draw-cancel-btn";
    cancelBtn.setAttribute("type", "button");
    cancelBtn.setAttribute("aria-label", "Cancel");
    cancelBtn.innerHTML = "✕";
    cancelBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    cancelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      cancelDrawing();
    });
    hud.appendChild(cancelBtn);

    overlayEl.appendChild(hud);

    // Pointer events on overlay: 1-finger crosshair move, 2-finger pinch, tap to place
    overlayEl.addEventListener("pointerdown", (e: PointerEvent) => {
      if ((e.target as HTMLElement)?.closest(".mobile-draw-cancel-btn")) return;
      e.preventDefault();
      e.stopPropagation();

      try {
        overlayEl?.setPointerCapture(e.pointerId);
      } catch {}

      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 1) {
        dragState = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          startTime: performance.now(),
          moved: false,
          startCrosshairX: currentCrosshairX,
          startCrosshairY: currentCrosshairY,
        };
      } else if (activePointers.size === 2) {
        dragState = null;
        const [p1, p2] = [...activePointers.values()];
        pinchStartDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        pinchStartSpacing = r.coords.getViewport().barSpacing;
      }
    });

    overlayEl.addEventListener("pointermove", (e: PointerEvent) => {
      if (activePointers.has(e.pointerId)) {
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      // 2-finger pinch zoom
      if (activePointers.size === 2 && pinchStartDist > 0) {
        e.preventDefault();
        e.stopPropagation();
        const [p1, p2] = [...activePointers.values()];
        const curDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const scale = curDist / pinchStartDist;
        const newSpacing = Math.max(1, Math.min(100, pinchStartSpacing * scale));
        const vp = r.coords.getViewport();
        r.applyViewport({ barSpacing: newSpacing, rightOffset: vp.rightOffset });
        updateChipsAndLines(currentCrosshairX, currentCrosshairY);
        return;
      }

      // 1-finger crosshair move (moves the crosshair, NOT the chart)
      if (!dragState || dragState.pointerId !== e.pointerId) return;
      e.preventDefault();
      e.stopPropagation();

      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;

      if (!dragState.moved && Math.hypot(dx, dy) > 5) {
        dragState.moved = true;
      }

      if (dragState.moved) {
        const nextX = dragState.startCrosshairX + dx;
        const nextY = dragState.startCrosshairY + dy;
        updateChipsAndLines(nextX, nextY);

        // Update ghost line preview to current crosshair if placing multi-point tool
        if (r.userDrawings?.interaction?.state?.kind === "placing") {
          const snap = ws.chart.drawings.getSnapMode?.() ?? "off";
          r.userDrawings.pointerMove(currentCrosshairX, currentCrosshairY, snap, false, false);
        }
      }
    });

    overlayEl.addEventListener("pointerup", (e: PointerEvent) => {
      activePointers.delete(e.pointerId);
      try {
        overlayEl?.releasePointerCapture(e.pointerId);
      } catch {}

      if (dragState && dragState.pointerId === e.pointerId) {
        const wasMoved = dragState.moved;
        const duration = performance.now() - dragState.startTime;
        dragState = null;

        if (!wasMoved && duration < 250) {
          placePointAtCrosshair();
        }
      }
    });

    overlayEl.addEventListener("pointercancel", (e: PointerEvent) => {
      activePointers.delete(e.pointerId);
      dragState = null;
    });

    mountParent.appendChild(overlayEl);
    updateChipsAndLines(currentCrosshairX, currentCrosshairY);

    if (r.plot) {
      resizeObserver = new ResizeObserver(() => {
        updateChipsAndLines(currentCrosshairX, currentCrosshairY);
      });
      resizeObserver.observe(r.plot);
    }
  };

  // Check initial tool state on mount
  try {
    const initialTool = ws.chart.drawings.getTool();
    if (initialTool && isTouchDevice()) {
      setupOverlay(initialTool);
    }
  } catch {
    /* chart not ready yet */
  }

  // Listen to tool arming / disarming
  const offTool = ws.chart.on("drawing:tool", (p: { type: string | null }) => {
    if (p?.type) {
      if (isTouchDevice()) {
        setupOverlay(p.type);
      }
    } else {
      teardown();
    }
  });

  // Listen to drawing creation (finalized) -> disarm & teardown immediately
  const offCreated = ws.chart.on("drawing:created", () => {
    try {
      ws.chart.drawings.setTool(null);
    } catch {}
    teardown();
  });

  return () => {
    offTool?.();
    offCreated?.();
    teardown();
  };
}
