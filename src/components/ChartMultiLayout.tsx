import React, { useState, useEffect, useRef } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import { layoutForGrid } from "@luxalgo/vela/workspace";

interface Props {
  ws: VelaWorkspace | null;
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

export interface LayoutPreset {
  id: string;
  name: string;
  rows: number;
  cols: number;
  count: number;
  icon: React.ReactNode;
}

const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    id: "1",
    name: "1 Chart (Single)",
    rows: 1,
    cols: 1,
    count: 1,
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
      </svg>
    ),
  },
  {
    id: "1x2",
    name: "2 Charts (Vertical Split)",
    rows: 1,
    cols: 2,
    count: 2,
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="12" y1="3" x2="12" y2="21" />
      </svg>
    ),
  },
  {
    id: "2x1",
    name: "2 Charts (Horizontal Split)",
    rows: 2,
    cols: 1,
    count: 2,
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="3" y1="12" x2="21" y2="12" />
      </svg>
    ),
  },
  {
    id: "1x3",
    name: "3 Charts (3 Columns)",
    rows: 1,
    cols: 3,
    count: 3,
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="9" y1="3" x2="9" y2="21" />
        <line x1="15" y1="3" x2="15" y2="21" />
      </svg>
    ),
  },
  {
    id: "3x1",
    name: "3 Charts (3 Rows)",
    rows: 3,
    cols: 1,
    count: 3,
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="3" y1="15" x2="21" y2="15" />
      </svg>
    ),
  },
  {
    id: "2x2",
    name: "4 Charts (Quad Grid)",
    rows: 2,
    cols: 2,
    count: 4,
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="12" y1="3" x2="12" y2="21" />
        <line x1="3" y1="12" x2="21" y2="12" />
      </svg>
    ),
  },
  {
    id: "2x3",
    name: "6 Charts (2 Rows × 3 Cols)",
    rows: 2,
    cols: 3,
    count: 6,
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="9" y1="3" x2="9" y2="21" />
        <line x1="15" y1="3" x2="15" y2="21" />
      </svg>
    ),
  },
  {
    id: "3x2",
    name: "6 Charts (3 Rows × 2 Cols)",
    rows: 3,
    cols: 2,
    count: 6,
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="12" y1="3" x2="12" y2="21" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="3" y1="15" x2="21" y2="15" />
      </svg>
    ),
  },
  {
    id: "2x4",
    name: "8 Charts (2 Rows × 4 Cols - MAX)",
    rows: 2,
    cols: 4,
    count: 8,
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="7.5" y1="3" x2="7.5" y2="21" />
        <line x1="12" y1="3" x2="12" y2="21" />
        <line x1="16.5" y1="3" x2="16.5" y2="21" />
      </svg>
    ),
  },
  {
    id: "4x2",
    name: "8 Charts (4 Rows × 2 Cols - MAX)",
    rows: 4,
    cols: 2,
    count: 8,
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="12" y1="3" x2="12" y2="21" />
        <line x1="3" y1="7.5" x2="21" y2="7.5" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="16.5" x2="21" y2="16.5" />
      </svg>
    ),
  },
];

export function ChartMultiLayout({ ws, isOpen, onClose, triggerRef }: Props) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [activeLayoutId, setActiveLayoutId] = useState<string>("1");
  const [syncSymbol, setSyncSymbol] = useState<boolean>(false);
  const [syncTimeframe, setSyncTimeframe] = useState<boolean>(false);
  const [syncCrosshair, setSyncCrosshair] = useState<boolean>(true);
  const [syncStyle, setSyncStyle] = useState<boolean>(true);
  const [isMaximized, setIsMaximized] = useState<boolean>(false);

  // Sync initial state from workspace
  useEffect(() => {
    if (!ws) return;
    try {
      const state = ws.sync.state();
      setSyncSymbol(state.symbol === true);
      setSyncTimeframe(state.timeframe === true);
      setSyncCrosshair(state.crosshair === true);
      setSyncStyle(state.style === true);
      setIsMaximized(!!ws.maximizedCell);
      if (ws.layout?.id) {
        setActiveLayoutId(ws.layout.id);
      }
    } catch {
      // workspace not ready
    }
  }, [ws, isOpen]);

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        if (triggerRef?.current && triggerRef.current.contains(target)) {
          return;
        }
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose, triggerRef]);

  if (!isOpen || !ws) return null;

  const handleSelectLayout = (preset: LayoutPreset) => {
    if (!ws) return;
    try {
      // Strict constraint: max 8 charts
      const count = preset.rows * preset.cols;
      if (count > 8) {
        console.warn("[trade-pro] layout exceeds max 8 charts, clamping to 8");
        ws.setLayout(layoutForGrid(2, 4));
        setActiveLayoutId("2x4");
      } else {
        const gridDef = layoutForGrid(preset.rows, preset.cols);
        ws.setLayout(gridDef);
        setActiveLayoutId(preset.id);
      }
    } catch (e) {
      console.error("[trade-pro] setLayout error:", e);
    }
    onClose();
  };

  const handleToggleSync = (type: "symbol" | "timeframe" | "crosshair" | "style") => {
    if (!ws) return;
    try {
      if (type === "symbol") {
        const next = !syncSymbol;
        setSyncSymbol(next);
        ws.sync.set("symbol", next);
      } else if (type === "timeframe") {
        const next = !syncTimeframe;
        setSyncTimeframe(next);
        ws.sync.set("timeframe", next);
      } else if (type === "crosshair") {
        const next = !syncCrosshair;
        setSyncCrosshair(next);
        ws.sync.set("crosshair", next);
      } else if (type === "style") {
        const next = !syncStyle;
        setSyncStyle(next);
        ws.sync.set("style", next);
      }
    } catch (e) {
      console.error("[trade-pro] sync.set error:", e);
    }
  };

  const handleToggleMaximize = () => {
    if (!ws) return;
    try {
      if (ws.maximizedCell) {
        ws.maximizeCell(null);
        setIsMaximized(false);
      } else if (ws.active?.id) {
        ws.maximizeCell(ws.active.id);
        setIsMaximized(true);
      }
    } catch (e) {
      console.error("[trade-pro] maximizeCell error:", e);
    }
    onClose();
  };

  return (
    <div ref={popoverRef} className="tv-layout-popover">
      <div className="tv-layout-header">
        <div className="tv-layout-title">
          <span>Multiple Charts</span>
          <span className="tv-layout-max-badge">Max 8</span>
        </div>
        <button
          className="tv-layout-close-btn"
          onClick={onClose}
          title="Close Layout Picker"
        >
          ✕
        </button>
      </div>

      <div className="tv-layout-body">
        {/* Layout Presets Grid */}
        <div className="tv-layout-section">
          <div className="tv-layout-section-label">Select Grid Layout</div>
          <div className="tv-layout-grid-list">
            {LAYOUT_PRESETS.map((p) => {
              const isSelected =
                activeLayoutId === p.id ||
                activeLayoutId === `g${p.rows}x${p.cols}` ||
                (p.id === "1" && activeLayoutId === "1");
              return (
                <button
                  key={p.id}
                  className={`tv-layout-grid-btn ${isSelected ? "selected" : ""}`}
                  onClick={() => handleSelectLayout(p)}
                  title={`${p.name} (${p.count} chart${p.count > 1 ? "s" : ""})`}
                >
                  <div className="tv-layout-grid-icon">{p.icon}</div>
                  <span className="tv-layout-grid-caption">
                    {p.cols}×{p.rows}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Sync Settings */}
        <div className="tv-layout-section tv-layout-sync-section">
          <div className="tv-layout-section-label">Sync In All Charts</div>
          <div className="tv-layout-sync-list">
            <label className="tv-layout-sync-item">
              <input
                type="checkbox"
                checked={syncCrosshair}
                onChange={() => handleToggleSync("crosshair")}
              />
              <span className="tv-layout-sync-text">Crosshair</span>
              <span className="tv-layout-sync-desc">Follow cursor across charts</span>
            </label>

            <label className="tv-layout-sync-item">
              <input
                type="checkbox"
                checked={syncSymbol}
                onChange={() => handleToggleSync("symbol")}
              />
              <span className="tv-layout-sync-text">Symbol</span>
              <span className="tv-layout-sync-desc">Same ticker in every cell</span>
            </label>

            <label className="tv-layout-sync-item">
              <input
                type="checkbox"
                checked={syncTimeframe}
                onChange={() => handleToggleSync("timeframe")}
              />
              <span className="tv-layout-sync-text">Interval</span>
              <span className="tv-layout-sync-desc">Same timeframe across charts</span>
            </label>

            <label className="tv-layout-sync-item">
              <input
                type="checkbox"
                checked={syncStyle}
                onChange={() => handleToggleSync("style")}
              />
              <span className="tv-layout-sync-text">Style</span>
              <span className="tv-layout-sync-desc">Candle colors & display</span>
            </label>
          </div>
        </div>

        {/* Maximize active cell shortcut */}
        <div className="tv-layout-footer">
          <button
            className={`tv-layout-maximize-btn ${isMaximized ? "active" : ""}`}
            onClick={handleToggleMaximize}
            title="Expand active chart to full screen, or restore grid"
          >
            {isMaximized ? "◱ Restore Grid" : "⛶ Maximize Active Chart"}
          </button>
        </div>
      </div>
    </div>
  );
}
