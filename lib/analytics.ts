export type Candle = {
  time: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
export type Analysis = {
  ema20: number;
  ema50: number;
  rsi: number;
  volumeRatio: number;
  breakout: boolean;
  trend: boolean;
  close: number;
  time: number;
};
export type MarketRow = {
  symbol: string;
  base: string;
  price: number;
  change: number;
  volume: number;
  high: number;
  low: number;
  amplitude: number;
  closeTime: number;
};
export function ema(values: number[], period: number): number[] {
  if (!values.length) return [];
  const out = [values[0]],
    k = 2 / (period + 1);
  for (let i = 1; i < values.length; i++)
    out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}
export function rsi(values: number[], period = 14): number {
  if (values.length <= period) return NaN;
  let gain = 0,
    loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    gain += Math.max(d, 0) / period;
    loss += Math.max(-d, 0) / period;
  }
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  return loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
}
export function analyze(candles: Candle[], now = Date.now()): Analysis | null {
  const closed = candles.filter((c) => c.closeTime < now);
  if (closed.length < 60) return null;
  const values = closed.map((c) => c.close),
    last = closed[closed.length - 1],
    prior = closed.slice(-21, -1);
  const ema20 = ema(values, 20).at(-1)!,
    ema50 = ema(values, 50).at(-1)!;
  const avg = prior.reduce((s, c) => s + c.volume, 0) / 20;
  return {
    ema20,
    ema50,
    rsi: rsi(values),
    volumeRatio: avg > 0 ? last.volume / avg : 0,
    breakout: last.close > Math.max(...prior.map((c) => c.high)),
    trend: last.close > ema20 && ema20 > ema50,
    close: last.close,
    time: last.closeTime,
  };
}
