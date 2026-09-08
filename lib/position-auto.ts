import { analyze, type Candle } from './analytics.ts';
import { atr } from './futures-analysis.ts';
import type { Position, Risk } from './position-risk.ts';
export type AutoPositionAnalysis = {
  basisEntry: number;
  createdAt: number;
  updatedAt: number;
  barTime: number;
  stop: number;
  target1: number;
  target2: number;
  initialRisk: number;
  atr: number;
  tick: number;
  trend: Position['trend'];
  reasons: string[];
  exitCondition: string;
  error: string;
  chart: { time: number; close: number }[];
};
export function buildPositionAnalysis(
  p: Position,
  hour: Candle[],
  four: Candle[],
  quarter: Candle[],
  tick: number,
  previous?: AutoPositionAnalysis,
  now = Date.now(),
): AutoPositionAnalysis {
  const h = hour.filter((c) => c.closeTime < now),
    f = four.filter((c) => c.closeTime < now),
    q = quarter.filter((c) => c.closeTime < now),
    a = analyze(h, now),
    b = analyze(f, now),
    c = analyze(q, now);
  if (
    !a ||
    !b ||
    !c ||
    now - a.time > 3660000 ||
    now - b.time > 14460000 ||
    now - c.time > 960000
  )
    throw new Error('技术行情不足或过期');
  const range = atr(h),
    long = p.side === 'long',
    sign = long ? 1 : -1;
  if (![range, tick, p.entry, p.mark].every((v) => Number.isFinite(v) && v > 0))
    throw new Error('价格或波动数据异常');
  const up =
      a.close > a.ema20 &&
      a.ema20 > a.ema50 &&
      b.close > b.ema20 &&
      b.ema20 > b.ema50,
    down =
      a.close < a.ema20 &&
      a.ema20 < a.ema50 &&
      b.close < b.ema20 &&
      b.ema20 < b.ema50;
  const trend: Position['trend'] = long
    ? up
      ? 'supports'
      : down
        ? 'opposes'
        : 'mixed'
    : down
      ? 'supports'
      : up
        ? 'opposes'
        : 'mixed';
  const round = (v: number, mode: 'floor' | 'ceil') =>
    Number((Math[mode](v / tick) * tick).toPrecision(12));
  const recent = h.slice(-7, -1);
  let stop = long
    ? round(Math.min(...recent.map((v) => v.low)) - 0.2 * range, 'floor')
    : round(Math.max(...recent.map((v) => v.high)) + 0.2 * range, 'ceil');
  if (p.liquidation !== null)
    stop = long
      ? Math.max(
          stop,
          round(p.liquidation + Math.max(tick, 0.1 * range), 'ceil'),
        )
      : Math.min(
          stop,
          round(p.liquidation - Math.max(tick, 0.1 * range), 'floor'),
        );
  const prior = previous?.basisEntry === p.entry ? previous : undefined;
  // Never loosen an existing stop or move profit targets away on refresh.
  if (prior)
    stop = long ? Math.max(stop, prior.stop) : Math.min(stop, prior.stop);
  const risk = Math.max(range, long ? p.entry - stop : stop - p.entry),
    anchor = long ? Math.max(p.entry, p.mark) : Math.min(p.entry, p.mark);
  const target1 =
      prior?.target1 ??
      round(anchor + sign * 1.5 * risk, long ? 'ceil' : 'floor'),
    target2 =
      prior?.target2 ??
      round(anchor + sign * 2.5 * risk, long ? 'ceil' : 'floor');
  if (
    ![stop, target1, target2].every((v) => Number.isFinite(v) && v > 0) ||
    !(long
      ? target2 > target1 && target1 > p.entry
      : target2 < target1 && target1 < p.entry)
  )
    throw new Error('当前无法生成有效的止盈止损结构');
  const direction = long ? '多仓' : '空仓';
  const reasons = [
    trend === 'supports'
      ? `1h 与 4h 的趋势都支持${direction}，当前方向有依据`
      : trend === 'opposes'
        ? `1h 与 4h 的趋势都反对${direction}，当前缺乏顺势持仓依据`
        : '1h 与 4h 趋势未形成同向支持，当前依据偏弱',
    (long ? c.close > c.ema20 : c.close < c.ema20)
      ? '15 分钟收盘价仍在短期均线有利一侧'
      : '15 分钟收盘价已在短期均线不利一侧，注意短线转弱',
    `1h RSI 为 ${a.rsi.toFixed(0)}${a.rsi > 68 ? '，短期偏热' : a.rsi < 32 ? '，短期偏冷' : '，未处于极端区间'}；成交量是近期均量的 ${a.volumeRatio.toFixed(2)} 倍`,
    `止损参考依据前 6 根已收盘小时 K 线的${long ? '低点' : '高点'}，再留出正常波动缓冲`,
  ];
  return {
    basisEntry: p.entry,
    createdAt: prior?.createdAt ?? now,
    updatedAt: now,
    barTime: a.time,
    stop,
    target1,
    target2,
    initialRisk: prior?.initialRisk ?? risk,
    atr: range,
    tick,
    trend,
    reasons,
    exitCondition: `标记价${long ? '跌至' : '升至'}系统止损参考时优先复核退出；达到第一目标复核分批止盈，达到第二目标复核剩余仓位。趋势转为反对持仓时提前复核。`,
    error: '',
    chart: h.slice(-72).map((v) => ({ time: v.closeTime, close: v.close })),
  };
}
export function automaticRisks(
  p: Position,
  now: number,
  priceFresh: boolean,
): Risk[] {
  const a = p.auto;
  if (!a) return [];
  const risks: Risk[] = [];
  for (const hours of [1, 4, 24])
    if (now >= a.createdAt + hours * 3600000)
      risks.push({
        code: `auto-${hours}h-deadline`,
        severity: 'warning',
        message:
          hours === 1
            ? '系统分析已满 1 小时，请复核短线趋势和止盈进度'
            : hours === 4
              ? '系统主观察期已满 4 小时，若没有进展请复核减仓或退出'
              : '系统观察已满 24 小时，请重新评估持仓，不要把短线计划无限延长',
      });
  if (!priceFresh) return risks;
  const long = p.side === 'long';
  if (long ? p.mark <= a.stop : p.mark >= a.stop)
    risks.push({
      code: 'auto-stop',
      severity: 'danger',
      message: '标记价已触及系统止损参考，请立即核对减仓或平仓计划',
    });
  if (long ? p.mark >= a.target2 : p.mark <= a.target2)
    risks.push({
      code: 'auto-target2',
      severity: 'info',
      message: '已达到系统第二止盈目标，请复核剩余仓位止盈',
    });
  else if (long ? p.mark >= a.target1 : p.mark <= a.target1)
    risks.push({
      code: 'auto-target1',
      severity: 'info',
      message: '已达到系统第一止盈目标，请复核分批止盈',
    });
  if (!a.error && now - a.updatedAt <= 180000 && a.trend === 'opposes')
    risks.push({
      code: 'auto-trend',
      severity: 'warning',
      message:
        '系统分析显示 1h 与 4h 均反对持仓方向，优先复核退出而非等待止盈目标',
    });
  return risks;
}
