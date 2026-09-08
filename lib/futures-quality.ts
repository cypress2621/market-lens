import type { Candle } from './analytics.ts';
import type { Setup } from './futures-analysis.ts';
export function freshTime(time: number, now: number, maxAge = 120000) {
  return (
    Number.isFinite(time) &&
    time > 0 &&
    time <= now + 5000 &&
    now - time <= maxAge
  );
}
export function validCandleSeries(
  candles: Candle[],
  step: number,
  now: number,
) {
  if (candles.length < 60) return false;
  return candles.every(
    (c, i) =>
      [c.time, c.closeTime, c.open, c.high, c.low, c.close, c.volume].every(
        Number.isFinite,
      ) &&
      c.open > 0 &&
      c.high > 0 &&
      c.low > 0 &&
      c.close > 0 &&
      c.high >= c.low &&
      c.volume >= 0 &&
      c.closeTime - c.time === step - 1 &&
      c.closeTime < now &&
      (i === 0 || c.time - candles[i - 1].time === step),
  );
}
export function setupFresh(s: Setup, now: number) {
  return (
    freshTime(s.quote.time, now) &&
    freshTime(s.barTime, now, 3660000) &&
    freshTime(s.trendTime, now, 14460000) &&
    freshTime(s.confirmationTime, now, 960000) &&
    (s.status !== 'confirmed' || s.quote.nextFundingTime > now)
  );
}
export function setupGroup(s: Setup): 'confirmed' | 'near' | 'watch' {
  return s.status === 'confirmed'
    ? 'confirmed'
    : s.status === 'zone' || (s.status === 'waiting' && s.distanceAtr <= 0.5)
      ? 'near'
      : 'watch';
}
export type CostAssumptions = {
  feePct: number;
  slippagePct: number;
  hours: number;
};
export function executionEstimate(s: Setup, c: CostAssumptions, now: number) {
  if (
    ![c.feePct, c.slippagePct, c.hours].every(Number.isFinite) ||
    c.feePct < 0 ||
    c.feePct > 5 ||
    c.slippagePct < 0 ||
    c.slippagePct > 5 ||
    c.hours < 1 ||
    c.hours > 24
  )
    return null;
  const long = s.direction === 'long',
    sign = long ? 1 : -1,
    quote = s.quote;
  const book = long ? quote.ask : quote.bid;
  if (
    !book ||
    !Number.isFinite(book) ||
    book <= 0 ||
    !Number.isFinite(quote.funding) ||
    !setupFresh(s, now)
  )
    return null;
  const entry = book * (1 + (sign * c.slippagePct) / 100),
    target = s.target1 * (1 - (sign * c.slippagePct) / 100),
    stop = s.stop * (1 - (sign * c.slippagePct) / 100);
  const grossReward = sign * (s.target1 - book),
    grossRisk = sign * (book - s.stop);
  if (grossRisk <= 0 || grossReward <= 0)
    return {
      entry,
      rr: null,
      grossRR: null,
      netRewardPct: null,
      fundingPct: null,
      settlements: 0,
      reason: '当前价已越过第一目标或止损，等待重新形成计划',
    };
  const interval = quote.fundingIntervalHours;
  if (
    !interval ||
    interval <= 0 ||
    !Number.isFinite(interval) ||
    !freshTime(quote.time, now) ||
    !Number.isFinite(quote.nextFundingTime) ||
    quote.nextFundingTime <= now
  )
    return {
      entry,
      rr: null,
      grossRR: grossReward / grossRisk,
      netRewardPct: null,
      fundingPct: null,
      settlements: 0,
      reason: '资金结算信息待更新，暂不计算扣费盈亏比',
    };
  const end = now + c.hours * 3600000,
    settlements =
      end < quote.nextFundingTime
        ? 0
        : Math.floor((end - quote.nextFundingTime) / (interval * 3600000)) + 1;
  const funding = Math.max(0, sign * quote.funding) * settlements * entry;
  const reward =
      sign * (target - entry) - ((entry + target) * c.feePct) / 100 - funding,
    risk = sign * (entry - stop) + ((entry + stop) * c.feePct) / 100 + funding;
  return {
    entry,
    rr: risk > 0 ? reward / risk : null,
    grossRR: grossReward / grossRisk,
    netRewardPct: (reward / entry) * 100,
    fundingPct: (funding / entry) * 100,
    settlements,
    reason: reward <= 0 ? '按当前假设，第一目标空间不足以覆盖成本' : '',
  };
}
