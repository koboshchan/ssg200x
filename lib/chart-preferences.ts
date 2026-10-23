/** Only known chart settings and finite timestamp/value anchors enter local storage. */
export const CHART_SCHEMA = 1;
export const INDICATORS = ["MA", "EMA", "BOLL", "RSI", "MACD", "VOL"] as const;
export type ChartIndicator = typeof INDICATORS[number];
export const DRAWINGS = ["segment", "horizontalStraightLine", "ssgRectangle", "fibonacciLine"] as const;
export type DrawingName = typeof DRAWINGS[number];
export type Drawing = {name: DrawingName; points: {timestamp: number; value: number}[]};
export type ChartPreferences = {version: 1; indicators: ChartIndicator[]; drawings: Drawing[]};
export const emptyPreferences = (): ChartPreferences => ({version: CHART_SCHEMA, indicators: [], drawings: []});
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function chartStorageKey(userId: string | null | undefined, symbol: string): string | null {
 return userId ? `ssg:chart:v${CHART_SCHEMA}:${encodeURIComponent(userId)}:${encodeURIComponent(symbol)}` : null;
}
export function parseChartPreferences(raw: string | null): ChartPreferences {
 const fallback = emptyPreferences();
 if (!raw || raw.length > 100_000) return fallback;
 try {
  const data: unknown = JSON.parse(raw);
  if (!record(data) || data.version !== CHART_SCHEMA) return fallback;
  const indicators = Array.isArray(data.indicators) ? [...new Set(data.indicators.filter((v): v is ChartIndicator => INDICATORS.includes(v as ChartIndicator)))] : [];
  const drawings: Drawing[] = [];
  if (Array.isArray(data.drawings)) for (const item of data.drawings.slice(0, 100)) {
   if (!record(item) || !DRAWINGS.includes(item.name as DrawingName) || !Array.isArray(item.points)) continue;
   const count = item.name === "horizontalStraightLine" ? 1 : 2;
   if (item.points.length !== count || !item.points.every(p => record(p) && Number.isSafeInteger(p.timestamp) && (p.timestamp as number) >= 0 && typeof p.value === "number" && Number.isFinite(p.value) && p.value > 0)) continue;
   drawings.push({name: item.name as DrawingName, points: item.points.map(p => ({timestamp: p.timestamp as number, value: p.value as number}))});
  }
  return {version: CHART_SCHEMA, indicators, drawings};
 } catch { return fallback; }
}
export function readChartPreferences(key: string | null): ChartPreferences {
 try { return parseChartPreferences(key ? localStorage.getItem(key) : null); } catch { return emptyPreferences(); }
}
export function writeChartPreferences(key: string | null, value: ChartPreferences): void {
 if (!key) return;
 try {
  // Sanitize outgoing data too; overlay instances contain callbacks and internal state.
  localStorage.setItem(key, JSON.stringify(parseChartPreferences(JSON.stringify(value))));
 } catch { /* Disabled/full storage must never break market charts. */ }
}
