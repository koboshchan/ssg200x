/** Consume provider calendar/clock responses. No weekday/holiday inference. */
export type StockSession = {date: string; open: number; close: number};
export type StockClock = {timestamp: number; receivedAt: number; isOpen: boolean; nextOpen: number; nextClose: number};
const ny = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
function localEpoch(date: string, time: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error("invalid_calendar");
  const target = Date.parse(date + "T" + time + ":00Z");
  let epoch = target;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(ny.formatToParts(epoch).map(x => [x.type, x.value]));
    const actual = Date.parse(p.year + "-" + p.month + "-" + p.day + "T" + p.hour + ":" + p.minute + ":" + p.second + "Z");
    epoch += target - actual;
  }
  if (!Number.isFinite(epoch)) throw new Error("invalid_calendar");
  const p = Object.fromEntries(ny.formatToParts(epoch).map(x => [x.type, x.value]));
  if (p.year + "-" + p.month + "-" + p.day !== date || p.hour + ":" + p.minute !== time) throw new Error("invalid_calendar");
  return epoch;
}
export function parseStockCalendar(input: unknown): StockSession[] {
  if (!Array.isArray(input)) throw new Error("invalid_calendar");
  const dates = new Set<string>();
  return input.map(row => {
    if (!row || typeof row.date !== "string" || typeof row.open !== "string" || typeof row.close !== "string" || dates.has(row.date)) throw new Error("invalid_calendar");
    dates.add(row.date);
    const open = localEpoch(row.date, row.open), close = localEpoch(row.date, row.close);
    if (!(close > open)) throw new Error("invalid_calendar");
    return {date: row.date, open, close};
  }).sort((a,b) => a.open - b.open);
}
export function parseStockClock(input: unknown, receivedAt: number): StockClock {
  const row = input as Record<string, unknown> | null;
  if (!row || typeof row.is_open !== "boolean") throw new Error("invalid_clock");
  const times = [row.timestamp, row.next_open, row.next_close].map(x => typeof x === "string" ? Date.parse(x) : NaN);
  if (!Number.isFinite(receivedAt) || times.some(x => !Number.isFinite(x))) throw new Error("invalid_clock");
  return {timestamp: times[0], nextOpen: times[1], nextClose: times[2], isOpen: row.is_open, receivedAt};
}
export function regularStockSession(sessions: readonly StockSession[], clock: StockClock | null, now: number) {
  if (!clock || !clock.isOpen || now < clock.receivedAt || now - clock.receivedAt > 60_000 ||
    Math.abs(now - clock.timestamp) > 60_000) return null;
  const session = sessions.find(s => now >= s.open && now < s.close);
  return session && clock.nextClose === session.close ? session : null;
}
