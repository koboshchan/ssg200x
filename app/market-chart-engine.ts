// This module is dynamically imported after mount. Never import it from server code.
import {init, dispose, registerOverlay, type Chart, type Coordinate, type KLineData, type OverlayCreate, type Period} from "klinecharts";
import {pricePrecision} from "@/lib/price-display";
import {readChartPreferences, writeChartPreferences, type ChartIndicator, type DrawingName} from "@/lib/chart-preferences";
import type {CandleRow} from "@/lib/client-market-cache";

export const TOOL_NAMES = {trend: "segment", hline: "horizontalStraightLine", rect: "ssgRectangle", fib: "fibonacciLine"} as const;
export type ChartTool = keyof typeof TOOL_NAMES;
export interface ChartControls {
 setTool: (tool: ChartTool | null) => void;
 clear: () => void;
 deleteSelected: () => void;
 setIndicators: (indicators: ChartIndicator[]) => void;
 replace: (rows: CandleRow[]) => void;
 update: (row: CandleRow) => void;
 destroy: () => void;
}
registerOverlay({
 name: "ssgRectangle", totalStep: 3,
 needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true,
 createPointFigures: ({coordinates}) => {
  if (coordinates.length < 2) return [];
  const [a, b] = coordinates;
  return [{type: "rect", attrs: {x: Math.min(a.x,b.x), y: Math.min(a.y,b.y), width: Math.abs(b.x-a.x), height: Math.abs(b.y-a.y)}}];
 },
});
export function createMarketChart(el: HTMLElement, options: {
 symbol: string; period: Period; storeKey: string | null; initialPrice?: number;
 onTool: (tool: ChartTool | null) => void; onCount: (count: number) => void;
 onSelected: (selected: boolean) => void; onIndicators: (indicators: ChartIndicator[]) => void;
}): ChartControls {
 const chart: Chart | null = init(el, {locale: "en-US"});
 if (!chart) throw new Error("Chart could not initialize");
 const c = chart;
 let disposed = false, selected: string | null = null, pending: string | null = null;
 let rows: KLineData[] = [], realtime: ((row: KLineData) => void) | undefined;
 let prefs = readChartPreferences(options.storeKey);
 let precision = pricePrecision(options.initialPrice ?? 0);
 // FX native pairs need sub-cent precision even above one.
 if (options.symbol.includes("/")) precision = Math.max(precision, 6);
 const symbolInfo = () => ({ticker: options.symbol, pricePrecision: precision, volumePrecision: 0});
 const colors = () => {
  const style = getComputedStyle(el);
  const color = (name: string) => style.getPropertyValue(name).trim();
  return {line: color("--line"), ink: color("--ink"), muted: color("--muted"), up: color("--ok"), down: color("--red"), blue: color("--blue")};
 };
 function theme() {
  const t = colors();
  const axis = {axisLine: {color: t.line}, tickLine: {color: t.line}, tickText: {color: t.muted}};
  c.setStyles({
   grid: {horizontal: {color: t.line}, vertical: {color: t.line}},
   candle: {bar: {upColor: t.up, downColor: t.down, noChangeColor: t.muted, upBorderColor: t.up, downBorderColor: t.down, noChangeBorderColor: t.muted, upWickColor: t.up, downWickColor: t.down, noChangeWickColor: t.muted},
    priceMark: {last: {upColor: t.up, downColor: t.down, noChangeColor: t.muted}}},
   xAxis: axis, yAxis: axis, separator: {color: t.line},
   crosshair: {horizontal: {text: {backgroundColor: t.blue}, line: {color: t.muted}}, vertical: {text: {backgroundColor: t.blue}, line: {color: t.muted}}},
   overlay: {line: {color: t.blue}, rect: {color: t.blue + "22", borderColor: t.blue}, point: {color: t.blue, borderColor: t.blue, activeColor: t.blue, activeBorderColor: t.blue}},
  });
 }
 theme();
 const media = matchMedia("(prefers-color-scheme: dark)");
 media.addEventListener("change", theme);
 c.setDecimalFold({format: value => String(value)});
 c.setSymbol(symbolInfo());
 c.setPeriod(options.period);
 c.setDataLoader({
  getBars: ({type, callback}) => {if (!disposed) callback(type === "init" ? rows.map(row => ({...row})) : [], false);},
  subscribeBar: ({callback}) => {realtime = callback;},
  unsubscribeBar: () => {realtime = undefined;},
 });
 c.setOffsetRightDistance(40);
 const completed = () => c.getOverlays().filter(o => o.currentStep === -1);
 function persist() {
  if (disposed) return;
  prefs.drawings = completed().map(o => ({
   name: o.name as DrawingName,
   points: o.points.map(p => ({timestamp: p.timestamp!, value: p.value!})),
  }));
  writeChartPreferences(options.storeKey, prefs);
  options.onCount(prefs.drawings.length);
 }
 const hooks = (): Partial<OverlayCreate> => ({
  onDrawEnd: () => {pending = null; persist(); options.onTool(null);},
  onPressedMoveEnd: () => {persist(); return false;},
  onRemoved: ({overlay}) => {
   if (pending === overlay.id) {pending = null; options.onTool(null);}
   if (selected === overlay.id) {selected = null; options.onSelected(false);}
   // v10 calls this before the overlay is removed from its store.
   queueMicrotask(persist);
  },
  onSelected: ({overlay}) => {selected = overlay.id; options.onSelected(true); return false;},
  onDeselected: () => {selected = null; options.onSelected(false); return false;},
 });
 let restored = false;
 function restore() {
  if (restored || !rows.length) return;
  restored = true;
  for (const saved of prefs.drawings) c.createOverlay({...saved, lock: false, ...hooks()});
  options.onCount(completed().length);
 }
 function setIndicators(indicators: ChartIndicator[]) {
  const wanted = new Set(indicators);
  for (const current of c.getIndicators()) if (!wanted.has(current.name as ChartIndicator)) c.removeIndicator({id: current.id});
  const existing = new Set(c.getIndicators().map(i => i.name));
  for (const name of indicators) if (!existing.has(name)) {
   const main = ["MA","EMA","BOLL"].includes(name);
   const calcParams = name === "MA" ? [20] : name === "EMA" ? [50] : name === "RSI" ? [14] : undefined;
   c.createIndicator({name, ...(main ? {paneId: "candle_pane"} : {}), ...(calcParams ? {calcParams} : {})}, main);
  }
  prefs.indicators = indicators;
  writeChartPreferences(options.storeKey, prefs);
  options.onIndicators(indicators);
 }
 setIndicators(prefs.indicators);
 const point = (row: CandleRow): KLineData => ({timestamp: row.time, open: row.open, high: row.high, low: row.low, close: row.close, ...(typeof row.volume === "number" && Number.isFinite(row.volume) && row.volume >= 0 ? {volume: row.volume} : {})});
 function nextPrecision(row?: CandleRow) {
  return row ? Math.max(pricePrecision(row.close), options.symbol.includes("/") ? 6 : 0) : precision;
 }
 function viewport() {
  const visible = c.getVisibleRange();
  const timestamp = rows[Math.max(0,Math.min(rows.length-1,visible.to-1))]?.timestamp;
  const x = timestamp === undefined ? undefined : (c.convertToPixel({timestamp}) as Partial<Coordinate>).x;
  return {timestamp, x, following: visible.realTo >= rows.length};
 }
 function reload(view: ReturnType<typeof viewport>, next: number) {
  // setSymbol itself resets the loader in v10. Never reset twice or send the
  // same live point again after a reload. Both datasets must stay at 301 bars.
  if (next !== precision) {precision = next; c.setSymbol(symbolInfo());}
  else c.resetData();
  if (!view.following && view.timestamp !== undefined && view.x !== undefined) {
   const x = (c.convertToPixel({timestamp: view.timestamp}) as Partial<Coordinate>).x;
   if (x !== undefined) c.scrollByDistance(view.x-x,0);
  }
  restore();
 }
 return {
  setTool(tool) {
   if (pending) c.removeOverlay({id: pending});
   pending = null; selected = null; options.onSelected(false);
   if (tool) {
    const id = c.createOverlay({name: TOOL_NAMES[tool], ...hooks()});
    pending = Array.isArray(id) ? id[0] ?? null : id;
   }
   options.onTool(pending ? tool : null);
  },
  clear() {pending = null; selected = null; c.removeOverlay(); options.onTool(null); options.onSelected(false); prefs.drawings = []; persist();},
  deleteSelected() {if (selected) {c.removeOverlay({id: selected}); selected = null; options.onSelected(false);}},
  setIndicators,
  replace(data) {
   const next = data.map(point);
   if (next.length === rows.length && next.every((row,i) => row.timestamp === rows[i].timestamp && row.open === rows[i].open && row.high === rows[i].high && row.low === rows[i].low && row.close === rows[i].close && row.volume === rows[i].volume)) return;
   const view = viewport();
   rows = next.slice(-301);
   reload(view, nextPrecision(data.at(-1)));
  },
  update(row) {
   const value = point(row), tail = rows.at(-1);
   if (tail && tail.timestamp > value.timestamp) return;
   const view = viewport(), next = nextPrecision(row);
   if (tail?.timestamp === value.timestamp) rows[rows.length-1] = value;
   else rows.push(value);
   const overflow = rows.length > 301;
   if (overflow) rows = rows.slice(-301);
   if (overflow || next !== precision) reload(view, next);
   else {realtime?.({...value}); restore();}
  },
  destroy() {
   disposed = true;
   media.removeEventListener("change", theme);
   // Native chart disposal disconnects its own ResizeObserver and input handlers.
   dispose(el);
  },
 };
}
