import { useEffect, useState } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";

interface Props {
  ws?: VelaWorkspace | null;
  onClose?: () => void;
}

interface DrawingItem {
  id: string;
  type: string;
  visible: boolean;
  locked: boolean;
}

interface IndicatorItem {
  id: string;
  title: string;
  visible: boolean;
  nativeType?: string;
  handle: any;
}

export function ObjectTree({ ws, onClose }: Props) {
  const [drawings, setDrawings] = useState<DrawingItem[]>([]);
  const [indicators, setIndicators] = useState<IndicatorItem[]>([]);
  const [activeTab, setActiveTab] = useState<"all" | "drawings" | "indicators">("all");

  const syncObjects = () => {
    if (!ws) return;
    const chart = (ws as any).active?.chart || ws.chart;
    if (!chart) return;

    // Read drawings
    try {
      const allDrawings = chart.drawings?.all?.() || [];
      setDrawings(
        allDrawings.map((d: any) => ({
          id: d.id,
          type: d.type || "Drawing",
          visible: d.visible !== false,
          locked: !!d.locked,
        }))
      );
    } catch (e) {
      console.warn("[trade-pro object tree] error reading drawings:", e);
    }

    // Read indicators
    try {
      const allIndicators = chart.indicators?.() || [];
      setIndicators(
        allIndicators.map((ind: any) => ({
          id: ind.id,
          title: ind.title || ind.nativeType || "Indicator",
          visible: ind.visible !== false,
          nativeType: ind.nativeType,
          handle: ind,
        }))
      );
    } catch (e) {
      console.warn("[trade-pro object tree] error reading indicators:", e);
    }
  };

  useEffect(() => {
    syncObjects();
    const interval = window.setInterval(syncObjects, 800);
    return () => window.clearInterval(interval);
  }, [ws]);

  const toggleDrawingVisibility = (id: string, current: boolean) => {
    if (!ws) return;
    const chart = (ws as any).active?.chart || ws.chart;
    try {
      if (typeof chart.drawings.setVisible === "function") {
        chart.drawings.setVisible(id, !current);
      } else if (typeof chart.drawings.show === "function") {
        chart.drawings.show(id, !current);
      }
      syncObjects();
    } catch (e) {
      console.warn("[trade-pro object tree] toggleDrawingVisibility failed:", e);
    }
  };

  const toggleDrawingLock = (id: string, current: boolean) => {
    if (!ws) return;
    const chart = (ws as any).active?.chart || ws.chart;
    try {
      if (typeof chart.drawings.setLocked === "function") {
        chart.drawings.setLocked(id, !current);
      } else if (typeof chart.drawings.lock === "function") {
        chart.drawings.lock(id, !current);
      }
      syncObjects();
    } catch (e) {
      console.warn("[trade-pro object tree] toggleDrawingLock failed:", e);
    }
  };

  const removeDrawing = (id: string) => {
    if (!ws) return;
    const chart = (ws as any).active?.chart || ws.chart;
    try {
      chart.drawings?.remove?.(id);
      chart.drawings?.removeMany?.([id]);
      syncObjects();
    } catch (e) {
      console.warn("[trade-pro object tree] removeDrawing failed:", e);
    }
  };

  const removeAllDrawings = () => {
    if (!ws || !drawings.length) return;
    const chart = (ws as any).active?.chart || ws.chart;
    try {
      chart.drawings?.removeMany?.(drawings.map((d) => d.id));
      syncObjects();
    } catch (e) {
      console.warn("[trade-pro object tree] removeAllDrawings failed:", e);
    }
  };

  const toggleAllDrawingsVisibility = () => {
    if (!ws || !drawings.length) return;
    const chart = (ws as any).active?.chart || ws.chart;
    const anyVisible = drawings.some((d) => d.visible);
    try {
      for (const d of drawings) {
        if (typeof chart.drawings.setVisible === "function") {
          chart.drawings.setVisible(d.id, !anyVisible);
        } else if (typeof chart.drawings.show === "function") {
          chart.drawings.show(d.id, !anyVisible);
        }
      }
      syncObjects();
    } catch (e) {
      console.warn("[trade-pro object tree] toggleAllDrawingsVisibility failed:", e);
    }
  };

  const toggleIndicatorVisibility = (item: IndicatorItem) => {
    try {
      item.handle.setVisible?.(!item.visible);
      syncObjects();
    } catch (e) {
      console.warn("[trade-pro object tree] toggleIndicatorVisibility failed:", e);
    }
  };

  const openIndicatorSettings = (item: IndicatorItem) => {
    try {
      if (typeof item.handle.openSettings === "function") {
        item.handle.openSettings();
      } else {
        const chart = (ws as any).active?.chart || ws?.chart;
        chart?.openIndicatorSettings?.(item.id);
      }
    } catch (e) {
      console.warn("[trade-pro object tree] openIndicatorSettings failed:", e);
    }
  };

  const removeIndicator = (item: IndicatorItem) => {
    try {
      item.handle.remove?.();
      syncObjects();
    } catch (e) {
      console.warn("[trade-pro object tree] removeIndicator failed:", e);
    }
  };

  const removeAllIndicators = () => {
    try {
      for (const ind of indicators) {
        ind.handle.remove?.();
      }
      syncObjects();
    } catch (e) {
      console.warn("[trade-pro object tree] removeAllIndicators failed:", e);
    }
  };

  return (
    <div className="object-tree-panel" role="region" aria-label="Object Tree Inspector">
      <div className="ot-head">
        <div className="ot-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
          <span>Object Tree</span>
        </div>
        <div className="ot-head-actions">
          {onClose && (
            <button type="button" className="ot-btn-close" onClick={onClose} title="Close Object Tree">
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="ot-tabs">
        <button
          type="button"
          className={`ot-tab${activeTab === "all" ? " on" : ""}`}
          onClick={() => setActiveTab("all")}
        >
          All ({drawings.length + indicators.length})
        </button>
        <button
          type="button"
          className={`ot-tab${activeTab === "drawings" ? " on" : ""}`}
          onClick={() => setActiveTab("drawings")}
        >
          Drawings ({drawings.length})
        </button>
        <button
          type="button"
          className={`ot-tab${activeTab === "indicators" ? " on" : ""}`}
          onClick={() => setActiveTab("indicators")}
        >
          Indicators ({indicators.length})
        </button>
      </div>

      <div className="ot-body">
        {/* Indicators Section */}
        {(activeTab === "all" || activeTab === "indicators") && (
          <div className="ot-section">
            <div className="ot-section-header">
              <span className="ot-section-title">INDICATORS ({indicators.length})</span>
              {indicators.length > 0 && (
                <button
                  type="button"
                  className="ot-bulk-btn danger"
                  onClick={removeAllIndicators}
                  title="Remove all indicators from chart"
                >
                  Clear All
                </button>
              )}
            </div>

            {indicators.length === 0 ? (
              <div className="ot-empty">No indicators on chart</div>
            ) : (
              <div className="ot-list">
                {indicators.map((ind) => (
                  <div key={ind.id} className="ot-item">
                    <span className="ot-item-icon">📈</span>
                    <span className="ot-item-label" title={ind.title}>
                      {ind.title}
                    </span>
                    <div className="ot-item-tools">
                      <button
                        type="button"
                        className={`ot-tool-btn${!ind.visible ? " dimmed" : ""}`}
                        onClick={() => toggleIndicatorVisibility(ind)}
                        title={ind.visible ? "Hide indicator" : "Show indicator"}
                      >
                        {ind.visible ? "👁" : "⊘"}
                      </button>
                      <button
                        type="button"
                        className="ot-tool-btn"
                        onClick={() => openIndicatorSettings(ind)}
                        title="Indicator settings"
                      >
                        ⚙
                      </button>
                      <button
                        type="button"
                        className="ot-tool-btn danger"
                        onClick={() => removeIndicator(ind)}
                        title="Remove indicator"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Drawings Section */}
        {(activeTab === "all" || activeTab === "drawings") && (
          <div className="ot-section">
            <div className="ot-section-header">
              <span className="ot-section-title">DRAWINGS ({drawings.length})</span>
              {drawings.length > 0 && (
                <div className="ot-section-actions">
                  <button
                    type="button"
                    className="ot-bulk-btn"
                    onClick={toggleAllDrawingsVisibility}
                    title="Toggle visibility of all drawings"
                  >
                    Hide/Show
                  </button>
                  <button
                    type="button"
                    className="ot-bulk-btn danger"
                    onClick={removeAllDrawings}
                    title="Remove all drawings"
                  >
                    Clear All
                  </button>
                </div>
              )}
            </div>

            {drawings.length === 0 ? (
              <div className="ot-empty">No drawings on chart</div>
            ) : (
              <div className="ot-list">
                {drawings.map((d) => (
                  <div key={d.id} className="ot-item">
                    <span className="ot-item-icon">✏️</span>
                    <span className="ot-item-label">{d.type}</span>
                    <div className="ot-item-tools">
                      <button
                        type="button"
                        className={`ot-tool-btn${!d.visible ? " dimmed" : ""}`}
                        onClick={() => toggleDrawingVisibility(d.id, d.visible)}
                        title={d.visible ? "Hide drawing" : "Show drawing"}
                      >
                        {d.visible ? "👁" : "⊘"}
                      </button>
                      <button
                        type="button"
                        className={`ot-tool-btn${d.locked ? " on" : ""}`}
                        onClick={() => toggleDrawingLock(d.id, d.locked)}
                        title={d.locked ? "Unlock drawing" : "Lock drawing"}
                      >
                        {d.locked ? "🔒" : "🔓"}
                      </button>
                      <button
                        type="button"
                        className="ot-tool-btn danger"
                        onClick={() => removeDrawing(d.id)}
                        title="Delete drawing"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
