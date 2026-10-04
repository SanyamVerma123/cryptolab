import React, { useState, useEffect, useRef, useCallback } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";

export interface RadialTool {
  id: string;
  type: string;
  label: string;
  shortLabel: string;
  svg: string;
}

export const RADIAL_TOOLS: RadialTool[] = [
  {
    id: "hray",
    type: "hray",
    label: "Horizontal Ray",
    shortLabel: "Horizontal ...",
    svg: `<line x1="5" y1="12" x2="21" y2="12"/><circle cx="5" cy="12" r="1.6" fill="currentColor"/>`,
  },
  {
    id: "fibextension",
    type: "fibextension",
    label: "Fib Extension",
    shortLabel: "Fib Extension",
    svg: `<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="11" x2="21" y2="11"/><line x1="3" y1="15" x2="14" y2="15"/><line x1="3" y1="20" x2="14" y2="20"/>`,
  },
  {
    id: "text",
    type: "text",
    label: "Text",
    shortLabel: "Text",
    svg: `<path d="M5 6h14M12 6v13"/>`,
  },
  {
    id: "freehand",
    type: "freehand",
    label: "Brush",
    shortLabel: "Brush",
    svg: `<path d="M9.5 12 17 4.5a2.12 2.12 0 0 1 3 3L12.5 15"/><path d="M7 14a3 3 0 0 0-3 3c0 1.3-1.2 1.5-1.5 2 .8.9 2 1.5 3.5 1.5a3.5 3.5 0 0 0 3.5-3.5 3 3 0 0 0-2.5-3Z"/>`,
  },
  {
    id: "xabcd",
    type: "xabcd",
    label: "XABCD Pattern",
    shortLabel: "XABCD Patt...",
    svg: `<path d="M3 18 7 8 11 14 15 6 20 16"/>`,
  },
  {
    id: "cursor",
    type: "cursor",
    label: "Cursor",
    shortLabel: "Cursor",
    svg: `<path d="m4 4 7 17 2.8-6.2L20 12Z"/>`,
  },
  {
    id: "abcd",
    type: "abcd",
    label: "ABCD Pattern",
    shortLabel: "ABCD Pattern",
    svg: `<path d="M4 17 9 7 14 15 20 5"/>`,
  },
  {
    id: "box",
    type: "box",
    label: "Rectangle",
    shortLabel: "Rectangle",
    svg: `<rect x="4" y="6" width="16" height="12" rx="1"/>`,
  },
  {
    id: "magnifier",
    type: "magnifier",
    label: "Magnifier",
    shortLabel: "Magnifier",
    svg: `<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.3 15.3 5.2 5.2"/><path d="M8 12.5v-3M10.5 13.5v-5.5M13 12v-2"/>`,
  },
];

interface Props {
  ws: VelaWorkspace | null;
}

export function ChartRadialMenu({ ws }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [center, setCenter] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [selectedIndex, setSelectedIndex] = useState<number>(6); // Default: ABCD Pattern (bottom-left)
  const mousePos = useRef<{ x: number; y: number }>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const isOpenRef = useRef(false);
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  const R_IN = 74;
  const R_OUT = 180;
  const R_MID = 126;
  const SIZE = 380;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const NUM_SLICES = RADIAL_TOOLS.length;
  const SLICE_ANGLE = (2 * Math.PI) / NUM_SLICES;
  // Offset start angle so slice 0 is at 12 o'clock (top)
  const START_OFFSET = -Math.PI / 2 - SLICE_ANGLE / 2;

  // Track global mouse position
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      mousePos.current = { x: e.clientX, y: e.clientY };

      if (isOpenRef.current) {
        const dx = e.clientX - center.x;
        const dy = e.clientY - center.y;
        const dist = Math.hypot(dx, dy);

        if (dist > R_IN * 0.7) {
          let angle = Math.atan2(dy, dx) - START_OFFSET;
          while (angle < 0) angle += 2 * Math.PI;
          while (angle >= 2 * Math.PI) angle -= 2 * Math.PI;

          const idx = Math.floor(angle / SLICE_ANGLE) % NUM_SLICES;
          setSelectedIndex(idx);
        }
      }
    };

    window.addEventListener("mousemove", onMouseMove, { capture: true });
    return () => window.removeEventListener("mousemove", onMouseMove, { capture: true });
  }, [center]);

  // Arm chosen tool
  const armTool = useCallback(
    (tool: RadialTool) => {
      if (!ws) return;
      try {
        const chart = (ws as any).active ? ws.chart : null;
        if (!chart) return;
        if (tool.type === "cursor") {
          chart.drawings.setTool(null);
        } else {
          chart.drawings.setTool(tool.type as never);
        }
      } catch (e) {
        console.warn("[radial menu] failed to set tool:", e);
      }
    },
    [ws]
  );

  // Listen for Alt keydown / keyup and tradepro:toggle-radial-menu event
  useEffect(() => {
    const handleToggle = () => {
      if (isOpenRef.current) {
        setIsOpen(false);
        isOpenRef.current = false;
      } else {
        const pad = 200;
        const cx = Math.max(pad, Math.min(window.innerWidth - pad, mousePos.current.x || window.innerWidth / 2));
        const cy = Math.max(pad, Math.min(window.innerHeight - pad, mousePos.current.y || window.innerHeight / 2));
        setCenter({ x: cx, y: cy });
        setSelectedIndex(6);
        setIsOpen(true);
        isOpenRef.current = true;
      }
    };

    window.addEventListener("tradepro:toggle-radial-menu", handleToggle);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        if (!isOpenRef.current) {
          e.preventDefault();
          // Clamp center so wheel stays fully visible inside viewport
          const pad = 200;
          const cx = Math.max(pad, Math.min(window.innerWidth - pad, mousePos.current.x));
          const cy = Math.max(pad, Math.min(window.innerHeight - pad, mousePos.current.y));
          setCenter({ x: cx, y: cy });
          setSelectedIndex(6); // Default highlight ABCD Pattern like in reference image
          setIsOpen(true);
          isOpenRef.current = true;
        }
      } else if (e.key === "Escape" && isOpenRef.current) {
        setIsOpen(false);
        isOpenRef.current = false;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        e.preventDefault();
        if (isOpenRef.current) {
          const tool = RADIAL_TOOLS[selectedIndexRef.current];
          if (tool) {
            armTool(tool);
          }
          setIsOpen(false);
          isOpenRef.current = false;
        }
      }
    };

    const onBlur = () => {
      if (isOpenRef.current) {
        setIsOpen(false);
        isOpenRef.current = false;
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("tradepro:toggle-radial-menu", handleToggle);
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
      window.removeEventListener("blur", onBlur);
    };
  }, [armTool]);

  if (!isOpen) return null;

  const activeTool = RADIAL_TOOLS[selectedIndex] || RADIAL_TOOLS[6];

  // Helper to create donut wedge path
  const makeWedgePath = (index: number) => {
    const a1 = START_OFFSET + index * SLICE_ANGLE + 0.012;
    const a2 = START_OFFSET + (index + 1) * SLICE_ANGLE - 0.012;

    const x1Out = CX + R_OUT * Math.cos(a1);
    const y1Out = CY + R_OUT * Math.sin(a1);
    const x2Out = CX + R_OUT * Math.cos(a2);
    const y2Out = CY + R_OUT * Math.sin(a2);

    const x2In = CX + R_IN * Math.cos(a2);
    const y2In = CY + R_IN * Math.sin(a2);
    const x1In = CX + R_IN * Math.cos(a1);
    const y1In = CY + R_IN * Math.sin(a1);

    return `M ${x1Out} ${y1Out} A ${R_OUT} ${R_OUT} 0 0 1 ${x2Out} ${y2Out} L ${x2In} ${y2In} A ${R_IN} ${R_IN} 0 0 0 ${x1In} ${y1In} Z`;
  };

  return (
    <div
      className="radial-menu-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999999,
        background: "rgba(0, 0, 0, 0.45)",
        backdropFilter: "blur(2px)",
        pointerEvents: "auto",
        userSelect: "none",
      }}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setIsOpen(false);
          isOpenRef.current = false;
        }
      }}
    >
      <div
        className="radial-menu-container"
        style={{
          position: "absolute",
          left: `${center.x - CX}px`,
          top: `${center.y - CY}px`,
          width: `${SIZE}px`,
          height: `${SIZE}px`,
          pointerEvents: "auto",
        }}
      >
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          style={{
            overflow: "visible",
            filter: "drop-shadow(0 16px 40px rgba(0, 0, 0, 0.85))",
          }}
        >
          {/* Wheel wedges background paths */}
          {RADIAL_TOOLS.map((tool, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <path
                key={tool.id}
                d={makeWedgePath(idx)}
                fill={isSelected ? "#2962FF" : "rgba(26, 30, 42, 0.96)"}
                stroke={isSelected ? "#ffffff" : "rgba(255, 255, 255, 0.12)"}
                strokeWidth={isSelected ? 2 : 1}
                style={{
                  cursor: "pointer",
                  transition: "fill 80ms ease, stroke 80ms ease",
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                onClick={() => {
                  armTool(tool);
                  setIsOpen(false);
                  isOpenRef.current = false;
                }}
              />
            );
          })}

          {/* Center Circle Ring with glowing cyan/blue border */}
          <circle
            cx={CX}
            cy={CY}
            r={R_IN}
            fill="#12151d"
            stroke="#2962FF"
            strokeWidth="2.5"
            style={{
              filter: "drop-shadow(0 0 16px rgba(41, 98, 255, 0.75))",
            }}
          />
        </svg>

        {/* HTML Labels & Icons positioned at the centroid of each wedge */}
        {RADIAL_TOOLS.map((tool, idx) => {
          const isSelected = idx === selectedIndex;
          const midAngle = START_OFFSET + (idx + 0.5) * SLICE_ANGLE;
          const nodeX = CX + R_MID * Math.cos(midAngle);
          const nodeY = CY + R_MID * Math.sin(midAngle);

          return (
            <div
              key={`label-${tool.id}`}
              style={{
                position: "absolute",
                left: `${nodeX}px`,
                top: `${nodeY}px`,
                transform: "translate(-50%, -50%)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "3px",
                pointerEvents: "none",
                width: "78px",
                textAlign: "center",
              }}
            >
              {/* Tool Icon */}
              <div
                style={{
                  width: "20px",
                  height: "20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: isSelected ? "#ffffff" : "#cbd5e1",
                  transition: "color 80ms ease",
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dangerouslySetInnerHTML={{ __html: tool.svg }}
                />
              </div>

              {/* Tool Name */}
              <div
                style={{
                  color: isSelected ? "#ffffff" : "#94a3b8",
                  fontSize: "10.5px",
                  fontWeight: isSelected ? 700 : 500,
                  letterSpacing: "-0.2px",
                  whiteSpace: "nowrap",
                  textShadow: isSelected ? "0 1px 3px rgba(0,0,0,0.8)" : "none",
                  transition: "color 80ms ease",
                }}
              >
                {tool.shortLabel}
              </div>
            </div>
          );
        })}

        {/* Center Content overlay matching Image 5 */}
        <div
          style={{
            position: "absolute",
            top: `${CY - R_IN + 6}px`,
            left: `${CX - R_IN + 6}px`,
            width: `${(R_IN - 6) * 2}px`,
            height: `${(R_IN - 6) * 2}px`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            pointerEvents: "none",
          }}
        >
          {/* ALT keycap badge */}
          <div
            style={{
              padding: "2px 8px",
              background: "#262a36",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              borderRadius: "4px",
              fontSize: "10px",
              fontWeight: 700,
              color: "#d1d5db",
              letterSpacing: "0.5px",
              boxShadow: "0 2px 4px rgba(0,0,0,0.5)",
              marginBottom: "5px",
            }}
          >
            ALT
          </div>

          {/* Active Tool Title */}
          <div
            style={{
              color: "#ffffff",
              fontSize: "15px",
              fontWeight: 700,
              lineHeight: 1.2,
              padding: "0 8px",
              letterSpacing: "-0.2px",
              textShadow: "0 2px 6px rgba(0,0,0,0.9)",
            }}
          >
            {activeTool.label}
          </div>

          {/* Subtext: Release to arm */}
          <div
            style={{
              color: "#787f94",
              fontSize: "10.5px",
              marginTop: "4px",
              letterSpacing: "0.2px",
            }}
          >
            Release to arm
          </div>
        </div>
      </div>
    </div>
  );
}
