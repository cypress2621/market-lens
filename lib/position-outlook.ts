import type { Candle } from './analytics.ts';
import type { Position } from './position-risk.ts';
export type HorizonOutlook = {
  hours: number;
  samples: number;
  lower: number | null;
  median: number | null;
  upper: number | null;
};
export type PositionOutlook = {
  symbol: string;
  asOf: number;
  referencePrice: number;
  tickSize: number;
  historyStart: number;
  historyEnd: number;
  rows: HorizonOutlook[];
  chart: { time: number; close: number }[];
};
const hour = 3600000;
function quantile(sorted: number[], q: number) {
  const i = (sorted.length - 1) * q,
    a = Math.floor(i);
  return (
    sorted[a] +
    (sorted[Math.min(a + 1, sorted.length - 1)] - sorted[a]) * (i - a)
  );
}
/** Non-overlapping historical endpoint returns. No claim of future calibration. */
export function horizonOutlook(
  input: Candle[],
  hours: number,
  now = Date.now(),
): HorizonOutlook {
  if (![1, 4, 24].includes(hours)) throw new Error('不支持的参考时长');
  const bars = input
      .filter(
        (c) => c.closeTime < now && Number.isFinite(c.close) && c.close > 0,
      )
      .sort((a, b) => a.time - b.time),
    changes: number[] = [];
  for (let end = bars.length - 1; end >= hours; end -= hours) {
    const start = end - hours;
    let valid = true;
    for (let i = start; i < end; i++)
      if (bars[i + 1].time - bars[i].time !== hour) {
        valid = false;
        break;
      }
    if (valid) changes.push(bars[end].close / bars[start].close - 1);
  }
  const result: HorizonOutlook = {
    hours,
    samples: changes.length,
    lower: null,
    median: null,
    upper: null,
  };
  if (changes.length < 30) return result;
  changes.sort((a, b) => a - b);
  return {
    ...result,
    lower: quantile(changes, 0.25),
    median: quantile(changes, 0.5),
    upper: quantile(changes, 0.75),
  };
}
export function profitReference(
  p: Position,
  row: HorizonOutlook,
  reference: number,
  tick: number,
): { price: number; pnl: number } | null {
  const move = p.side === 'long' ? row.upper : row.lower;
  if (
    move === null ||
    !Number.isFinite(reference) ||
    reference <= 0 ||
    !Number.isFinite(tick) ||
    tick <= 0 ||
    row.samples < 30
  )
    return null;
  if (p.side === 'long' ? move <= 0 : move >= 0) return null;
  const raw = reference * (1 + move),
    units = raw / tick;
  const price = Number(
    (
      (p.side === 'long' ? Math.floor(units + 1e-9) : Math.ceil(units - 1e-9)) *
      tick
    ).toPrecision(12),
  );
  const pnl =
    (p.side === 'long' ? price - p.entry : p.entry - price) * p.quantity;
  return price > 0 && pnl > 0 ? { price, pnl } : null;
}
