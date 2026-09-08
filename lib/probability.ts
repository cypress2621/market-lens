import { ema, type Candle } from './analytics.ts';

export const HOUR = 3600000;
export const MIN_SAMPLES = 30;
export type Outcome = {
  count: number;
  probability: number;
  interval: [number, number];
};
export type ProbabilityEstimate = {
  status: 'ready' | 'insufficient';
  horizon: number;
  threshold: number;
  sampleCount: number;
  minimumSamples: number;
  historyCount: number;
  historyStart: number | null;
  historyEnd: number | null;
  featureTime: number | null;
  state: { trend: string; rsi: string } | null;
  outcomes: { up: Outcome; down: Outcome; flat: Outcome } | null;
  sampleStart: number | null;
  sampleEnd: number | null;
};

/** Wilder RSI for every prefix; no future prices enter a feature. */
export function rsiSeries(values: number[], period = 14): number[] {
  const result = values.map(() => NaN);
  if (values.length <= period) return result;
  let gain = 0,
    loss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = values[i] - values[i - 1];
    gain += Math.max(delta, 0) / period;
    loss += Math.max(-delta, 0) / period;
  }
  const value = () =>
    loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
  result[period] = value();
  for (let i = period + 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(delta, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-delta, 0)) / period;
    result[i] = value();
  }
  return result;
}

/** Approximate 95% Wilson interval for a historical binomial frequency. */
export function wilson(count: number, total: number): [number, number] {
  if (total <= 0) return [0, 1];
  const z = 1.95996398454,
    p = count / total,
    den = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / den,
    half =
      (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) /
      den;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export function estimateProbability(
  input: Candle[],
  horizon: number,
  threshold: number,
  now = Date.now(),
): ProbabilityEstimate {
  if (![1, 4, 24].includes(horizon) || ![0.5, 1, 2, 3, 5].includes(threshold))
    throw new Error('不支持的时间或涨跌门槛');
  const candles = input
    .filter((c) => c.closeTime < now && c.close > 0 && Number.isFinite(c.close))
    .sort((a, b) => a.time - b.time);
  const last = candles.at(-1);
  const result: ProbabilityEstimate = {
    status: 'insufficient',
    horizon,
    threshold,
    sampleCount: 0,
    minimumSamples: MIN_SAMPLES,
    historyCount: candles.length,
    historyStart: candles[0]?.time ?? null,
    historyEnd: last?.closeTime ?? null,
    featureTime: last?.closeTime ?? null,
    state: null,
    outcomes: null,
    sampleStart: null,
    sampleEnd: null,
  };
  if (candles.length < 120 + horizon) return result;
  const prices = candles.map((c) => c.close),
    fast = ema(prices, 20),
    slow = ema(prices, 50),
    strength = rsiSeries(prices);
  function stateAt(i: number) {
    return {
      trend:
        prices[i] > fast[i] && fast[i] > slow[i]
          ? '偏强'
          : prices[i] < fast[i] && fast[i] < slow[i]
            ? '偏弱'
            : '整理',
      rsi: strength[i] < 40 ? '较弱' : strength[i] > 60 ? '较强' : '中间',
    };
  }
  const current = stateAt(candles.length - 1);
  result.state = current;
  // Work backwards to prefer recent history. Accepted forward return windows
  // do not overlap; a shared endpoint is allowed. Features use only past data.
  let nextStart = candles.length - 1,
    up = 0,
    down = 0,
    flat = 0;
  const starts: number[] = [],
    ends: number[] = [];
  for (let i = candles.length - 1 - horizon; i >= 100; i--) {
    if (i + horizon > nextStart) continue;
    const state = stateAt(i);
    if (state.trend !== current.trend || state.rsi !== current.rsi) continue;
    let continuous = true;
    // Reject a sample if its indicator warmup or outcome spans missing bars.
    for (let j = i - 50; j < i + horizon; j++)
      if (candles[j + 1].time - candles[j].time !== HOUR) {
        continuous = false;
        break;
      }
    if (!continuous) continue;
    const change = (prices[i + horizon] / prices[i] - 1) * 100;
    if (change + 1e-10 >= threshold) up++;
    else if (change - 1e-10 <= -threshold) down++;
    else flat++;
    starts.push(candles[i].closeTime);
    ends.push(candles[i + horizon].closeTime);
    nextStart = i;
  }
  result.sampleCount = up + down + flat;
  result.sampleStart = starts.length ? Math.min(...starts) : null;
  result.sampleEnd = ends.length ? Math.max(...ends) : null;
  if (result.sampleCount < MIN_SAMPLES) return result;
  const outcome = (count: number): Outcome => ({
    count,
    probability: count / result.sampleCount,
    interval: wilson(count, result.sampleCount),
  });
  result.status = 'ready';
  result.outcomes = {
    up: outcome(up),
    down: outcome(down),
    flat: outcome(flat),
  };
  return result;
}
