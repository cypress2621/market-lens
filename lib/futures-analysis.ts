import { analyze, type Candle } from './analytics.ts';
import { freshTime, validCandleSeries } from './futures-quality.ts';
export type Profile = 'steady' | 'active';
export type Direction = 'long' | 'short';
export type FuturesQuote = {
  symbol: string;
  volume: number;
  price: number;
  change: number;
  spreadBps: number;
  funding: number;
  nextFundingTime: number;
  mark: number;
  tick: number;
  time: number;
  bid?: number;
  ask?: number;
  fundingIntervalHours?: number;
  fundingIntervalSource?: 'exchange' | 'default' | 'unavailable';
};
export type Setup = {
  symbol: string;
  direction: Direction;
  strategy: 'pullback' | 'breakout';
  status: 'confirmed' | 'zone' | 'waiting' | 'extended';
  statusText: string;
  entryLow: number;
  entryHigh: number;
  entry: number;
  stop: number;
  target1: number;
  target2: number;
  riskPct: number;
  targetPct: number;
  atrPct: number;
  rsi: number;
  volumeRatio: number;
  condition: string;
  invalidReason: string;
  reasons: string[];
  barTime: number;
  trendTime: number;
  confirmationTime: number;
  distanceAtr: number;
  quote: FuturesQuote;
  oiChange: number | null;
  oiTime: number | null;
  firstSeen?: number;
  lastConfirmedAt?: number | null;
  change?: 'baseline' | 'new' | 'new-confirmation' | 'ongoing' | 'resumed';
};
export type SetupResult = { setup: Setup | null; reason: string };
export function atr(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return NaN;
  const tr = candles
    .slice(1)
    .map((c, i) =>
      Math.max(
        c.high - c.low,
        Math.abs(c.high - candles[i].close),
        Math.abs(c.low - candles[i].close),
      ),
    );
  let value = tr.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < tr.length; i++)
    value = (value * (period - 1) + tr[i]) / period;
  return value;
}
export function buildSetup(
  quote: FuturesQuote,
  hour: Candle[],
  fourHour: Candle[],
  quarter: Candle[],
  profile: Profile,
  now = Date.now(),
): SetupResult {
  if (
    [hour, fourHour, quarter].some((series) =>
      series.some(
        (c) => !Number.isFinite(c.time) || !Number.isFinite(c.closeTime),
      ),
    )
  )
    return { setup: null, reason: 'K 线不足、不连续或字段异常' };
  const h = hour.filter((c) => c.closeTime < now),
    f = fourHour.filter((c) => c.closeTime < now),
    q = quarter.filter((c) => c.closeTime < now);
  if (
    !validCandleSeries(h, 3600000, now) ||
    !validCandleSeries(f, 14400000, now) ||
    !validCandleSeries(q, 900000, now)
  )
    return { setup: null, reason: 'K 线不足、不连续或字段异常' };
  const a = analyze(h, now),
    b = analyze(f, now),
    c = analyze(q, now);
  const reject = (reason: string): SetupResult => ({ setup: null, reason });
  if (!a || !b || !c) return reject('历史 K 线不足');
  if (
    now - a.time > 3660000 ||
    now - b.time > 14460000 ||
    now - c.time > 960000 ||
    !freshTime(quote.time, now)
  )
    return reject('数据过期');
  if (
    ![quote.price, quote.mark, quote.tick].every(
      (v) => Number.isFinite(v) && v > 0,
    ) ||
    !Number.isFinite(quote.funding)
  )
    return reject('价格或资金费率异常');
  const long =
    a.close > a.ema20 &&
    a.ema20 > a.ema50 &&
    b.close > b.ema20 &&
    b.ema20 > b.ema50;
  const short =
    a.close < a.ema20 &&
    a.ema20 < a.ema50 &&
    b.close < b.ema20 &&
    b.ema20 < b.ema50;
  if (!long && !short) return reject('1h 与 4h 趋势未一致');
  if (profile === 'steady' && (a.rsi > 68 || a.rsi < 32))
    return reject('短期涨跌过热');
  if (profile === 'active' && (a.rsi > 78 || a.rsi < 22))
    return reject('短期涨跌过热');
  const direction: Direction = long ? 'long' : 'short',
    sign = long ? 1 : -1,
    range = atr(h);
  if (!Number.isFinite(range) || range <= 0) return reject('波动数据异常');
  // Compare paying-side funding on a common eight-hour basis when available.
  const interval = quote.fundingIntervalHours;
  const funding8h =
    interval !== undefined && Number.isFinite(interval) && interval > 0
      ? (quote.funding * 8) / interval
      : null;
  if (
    funding8h !== null &&
    sign * funding8h > (profile === 'steady' ? 0.0005 : 0.001)
  )
    return reject('持仓方向资金费率偏高');
  const previous = h.slice(-21, -1),
    high = Math.max(...previous.map((v) => v.high)),
    low = Math.min(...previous.map((v) => v.low));
  const breakout =
    (long ? a.close > high : a.close < low) &&
    a.volumeRatio >= (profile === 'steady' ? 1.5 : 1.2);
  const strategy = breakout ? 'breakout' : 'pullback';
  const pivot = breakout ? (long ? high : low) : a.ema20;
  const tick = quote.tick,
    round = (v: number, mode: 'floor' | 'ceil' | 'round') =>
      Number((Math[mode](v / tick) * tick).toPrecision(12));
  const entryLow = round(
    breakout ? (long ? pivot : pivot - 0.3 * range) : pivot - 0.2 * range,
    'floor',
  );
  const entryHigh = round(
    breakout ? (long ? pivot + 0.3 * range : pivot) : pivot + 0.2 * range,
    'ceil',
  );
  const entry = round((entryLow + entryHigh) / 2, 'round');
  const recent = h.slice(-6),
    stop = long
      ? round(
          Math.min(
            entryLow - 0.7 * range,
            Math.min(...recent.map((v) => v.low)) - 0.2 * range,
          ),
          'floor',
        )
      : round(
          Math.max(
            entryHigh + 0.7 * range,
            Math.max(...recent.map((v) => v.high)) + 0.2 * range,
          ),
          'ceil',
        );
  const risk = Math.abs(entry - stop),
    riskPct = (risk / entry) * 100;
  if (
    entryLow <= 0 ||
    stop <= 0 ||
    risk <= tick ||
    riskPct > (profile === 'steady' ? 4 : 8)
  )
    return reject('结构止损距离过大');
  if (long ? quote.price <= stop : quote.price >= stop)
    return reject('价格已越过失效位');
  const target1 = round(entry + sign * 1.5 * risk, long ? 'ceil' : 'floor'),
    target2 = round(entry + sign * 2.5 * risk, long ? 'ceil' : 'floor');
  if (target2 <= 0) return reject('目标价格无效');
  const last = q.at(-1)!,
    prev = q.at(-2)!;
  const executionPrice = (long ? quote.ask : quote.bid) ?? quote.price;
  const inZone =
    quote.price >= entryLow &&
    quote.price <= entryHigh &&
    executionPrice >= entryLow &&
    executionPrice <= entryHigh;
  const confirmation = breakout
    ? (long
        ? last.close > pivot && prev.close <= pivot
        : last.close < pivot && prev.close >= pivot) && c.volumeRatio >= 1.3
    : long
      ? last.low <= entryHigh && last.close >= entry && last.close > last.open
      : last.high >= entryLow && last.close <= entry && last.close < last.open;
  const distanceAtr =
    (quote.price < entryLow
      ? entryLow - quote.price
      : quote.price > entryHigh
        ? quote.price - entryHigh
        : 0) / range;
  const fundingKnown =
    Number.isFinite(quote.fundingIntervalHours) &&
    (quote.fundingIntervalHours ?? 0) > 0 &&
    Number.isFinite(quote.nextFundingTime) &&
    quote.nextFundingTime > now;
  const status =
    inZone && confirmation && fundingKnown
      ? 'confirmed'
      : inZone
        ? 'zone'
        : distanceAtr > 3
          ? 'extended'
          : 'waiting';
  const statusText =
    status === 'confirmed'
      ? '确认信号已出现'
      : status === 'zone'
        ? fundingKnown
          ? '到达观察区，等待确认'
          : '资金结算周期暂缺，等待核实'
        : status === 'extended'
          ? '偏离观察区较远'
          : breakout
            ? '等待突破 / 回测确认'
            : long
              ? '等待回踩确认'
              : '等待反弹确认';
  return {
    reason: '符合基础条件',
    setup: {
      symbol: quote.symbol,
      direction,
      strategy,
      status,
      statusText,
      entryLow,
      entryHigh,
      entry,
      stop,
      target1,
      target2,
      riskPct,
      targetPct: Math.abs(target1 / entry - 1) * 100,
      atrPct: (range / entry) * 100,
      rsi: a.rsi,
      volumeRatio: a.volumeRatio,
      condition: breakout
        ? `15 分钟收盘${long ? '突破' : '跌破'} ${pivot.toPrecision(7)}，前一根在另一侧，量比 ≥ 1.3；实时价仍在观察区`
        : `价格进入观察区，15 分钟${long ? '回踩收阳且收在区间中点以上' : '反弹收阴且收在区间中点以下'}，再考虑入场`,
      invalidReason: `${long ? '价格跌破' : '价格升破'}结构止损位，或 1h / 4h 趋势不再一致时，取消该计划`,
      reasons: [
        `1h 与 4h ${long ? '多头' : '空头'}排列一致`,
        `24h 成交额与买卖价差通过筛选`,
        breakout
          ? '1h 放量越过此前 20 根高 / 低点'
          : '以 1h EMA20 附近作为回撤观察区',
      ],
      barTime: a.time,
      trendTime: b.time,
      confirmationTime: c.time,
      distanceAtr,
      quote,
      oiChange: null,
      oiTime: null,
    },
  };
}
