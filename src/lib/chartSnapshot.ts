import type { VelaWorkspace } from "@luxalgo/vela/workspace";

export async function captureChartImage(
  ws: VelaWorkspace | null | undefined,
  symbol = "BTC",
  timeframe = "15m"
): Promise<{ dataUrl: string; blob: Blob } | null> {
  if (!ws) return null;

  try {
    const chart = (ws as any).active?.chart || ws.chart;
    let canvas: HTMLCanvasElement | null = null;

    if (typeof chart?.renderer?.screenshotCanvas === "function") {
      canvas = chart.renderer.screenshotCanvas();
    }

    if (!canvas) {
      // Find main canvas in container
      const found = document.querySelector<HTMLCanvasElement>(".vela-chart-container canvas");
      if (found) {
        canvas = document.createElement("canvas");
        canvas.width = found.width;
        canvas.height = found.height;
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.drawImage(found, 0, 0);
      }
    }

    if (!canvas) {
      const dataUrl = chart?.renderer?.screenshot?.();
      if (dataUrl && typeof dataUrl === "string") {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        return { dataUrl, blob };
      }
      return null;
    }

    // Add crisp watermark header / footer
    const compositeCanvas = document.createElement("canvas");
    compositeCanvas.width = canvas.width;
    compositeCanvas.height = canvas.height;
    const ctx = compositeCanvas.getContext("2d");
    if (!ctx) return null;

    // Draw main chart canvas
    ctx.drawImage(canvas, 0, 0);

    // Draw modern TradingView-style watermark badge at bottom-left
    const watermarkText = `Trade Pro · ${symbol} · ${timeframe} · ${new Date().toLocaleDateString()}`;
    ctx.font = "bold 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    const textMetrics = ctx.measureText(watermarkText);
    const badgeW = textMetrics.width + 24;
    const badgeH = 26;
    const badgeX = 16;
    const badgeY = canvas.height - badgeH - 16;

    // Badge background
    ctx.fillStyle = "rgba(19, 23, 34, 0.85)";
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
    ctx.fill();
    ctx.strokeStyle = "#363a45";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Badge text
    ctx.fillStyle = "#2962ff";
    ctx.fillText("✦", badgeX + 8, badgeY + 18);
    ctx.fillStyle = "#d1d4dc";
    ctx.fillText(watermarkText, badgeX + 22, badgeY + 18);

    const dataUrl = compositeCanvas.toDataURL("image/png");
    const blob = await new Promise<Blob | null>((resolve) =>
      compositeCanvas.toBlob((b) => resolve(b), "image/png")
    );

    if (!blob) return null;
    return { dataUrl, blob };
  } catch (err) {
    console.error("[trade-pro screenshot] capture failed:", err);
    return null;
  }
}

export async function downloadChartSnapshot(
  ws: VelaWorkspace | null | undefined,
  symbol = "BTC",
  timeframe = "15m"
): Promise<boolean> {
  const result = await captureChartImage(ws, symbol, timeframe);
  if (!result) return false;

  const a = document.createElement("a");
  a.href = result.dataUrl;
  a.download = `TradePro_${symbol}_${timeframe}_${new Date().toISOString().slice(0, 10)}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return true;
}

export async function copyChartSnapshot(
  ws: VelaWorkspace | null | undefined,
  symbol = "BTC",
  timeframe = "15m"
): Promise<boolean> {
  const result = await captureChartImage(ws, symbol, timeframe);
  if (!result) return false;

  try {
    if (navigator.clipboard && (window as any).ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": result.blob,
        }),
      ]);
      return true;
    }
  } catch (e) {
    console.warn("[trade-pro screenshot] clipboard write failed, downloading instead:", e);
    return downloadChartSnapshot(ws, symbol, timeframe);
  }
  return false;
}
