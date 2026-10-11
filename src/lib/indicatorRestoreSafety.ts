/**
 * Keep the known ETH chart lockup from being replayed after a restart.
 *
 * The script remains in its LuxAlgo/Pine library. Only its per-chart restore
 * pointers are removed, so the user can still add or delete it from the library.
 */
const LUX_APPLIED_KEY = "trade-pro:lux-applied";
const LUX_CACHE_KEY = "trade-pro:lux-library-cache";
const PINE_APPLIED_KEY = "trade-pro:pine-applied";
const TARGET = "multifactorprobabilisticbreakoutforecaster";

function normalize(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function declaredName(source: unknown): string {
  if (typeof source !== "string") return "";
  const match = source.match(/(?:indicator|strategy)\s*\(\s*(?:"([^"]*)"|'([^']*)')/i);
  return match?.[1] ?? match?.[2] ?? "";
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Remove the ETH chart's saved auto-restore references to the heavy forecaster.
 * The saved library sources themselves are deliberately left intact.
 */
export function suppressEthForecasterAutoRestore(symbol: string | undefined): boolean {
  const bare = String(symbol ?? "").split(":").pop()?.toUpperCase();
  if (bare !== "ETH") return false;

  let changed = false;
  const luxCache = readJson<Array<{ slug?: string; name?: string; script?: string }>>(LUX_CACHE_KEY, []);
  const badLuxSlugs = new Set(
    (Array.isArray(luxCache) ? luxCache : [])
      .filter((item) => normalize(item?.name) === TARGET || normalize(declaredName(item?.script)) === TARGET)
      .map((item) => item.slug)
      .filter((slug): slug is string => Boolean(slug))
  );

  const luxApplied = readJson<Record<string, string[]>>(LUX_APPLIED_KEY, {});
  for (const coin of ["ETH"]) {
    const entries = luxApplied[coin];
    if (Array.isArray(entries)) {
      const kept = entries.filter(
        (slug) => !badLuxSlugs.has(slug) && normalize(slug) !== TARGET
      );
      if (kept.length !== entries.length) {
        luxApplied[coin] = kept;
        changed = true;
      }
    }
  }

  const pineApplied = readJson<Record<string, Array<{ name?: string; script?: string }>>>(PINE_APPLIED_KEY, {});
  const pineEntries = pineApplied.ETH;
  if (Array.isArray(pineEntries)) {
    const kept = pineEntries.filter(
      (entry) => normalize(entry?.name) !== TARGET && normalize(declaredName(entry?.script)) !== TARGET
    );
    if (kept.length !== pineEntries.length) {
      pineApplied.ETH = kept;
      changed = true;
    }
  }

  if (changed) {
    try {
      localStorage.setItem(LUX_APPLIED_KEY, JSON.stringify(luxApplied));
      localStorage.setItem(PINE_APPLIED_KEY, JSON.stringify(pineApplied));
      console.info("[trade-pro] disabled ETH auto-restore for Multi-Factor Probabilistic Breakout Forecaster");
    } catch {
      // Storage restrictions must never prevent the chart from mounting.
    }
  }
  return changed;
}
