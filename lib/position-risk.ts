import { automaticRisks, type AutoPositionAnalysis } from './position-auto.ts';
export type Position = {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  unit: string;
  entry: number;
  mark: number;
  unrealized: number;
  liquidation: number | null;
  margin: number | null;
  mode: 'isolated' | 'cross' | 'unknown';
  leverage: number | null;
  trend: 'supports' | 'opposes' | 'mixed' | 'unknown';
  analysisMode?: 'automatic';
  auto?: AutoPositionAnalysis;
  analysisError?: string;
};
export type PositionRule = {
  stop: number | null;
  takeProfit: number | null;
  maxLoss: number | null;
  liquidationWarning: number;
  liquidationDanger: number;
  entryReason: string;
  invalidation: string;
  planStartedAt: number | null;
  holdHours: number | null;
};
export type Risk = {
  code: string;
  severity: 'danger' | 'warning' | 'info';
  message: string;
};
export const defaultRule: PositionRule = {
  stop: null,
  takeProfit: null,
  maxLoss: null,
  liquidationWarning: 2,
  liquidationDanger: 1,
  entryReason: '',
  invalidation: '',
  planStartedAt: null,
  holdHours: null,
};
export function planDeadline(r: PositionRule): number | null {
  return r.planStartedAt && r.holdHours
    ? r.planStartedAt + r.holdHours * 3600000
    : null;
}
export function accountDataFresh(asOf: number, now = Date.now()): boolean {
  return asOf > 0 && now >= asOf && now - asOf <= 30000;
}
export function liquidationDistance(p: Position): number | null {
  return p.liquidation && p.mark > 0
    ? ((p.side === 'long' ? p.mark - p.liquidation : p.liquidation - p.mark) /
        p.mark) *
        100
    : null;
}
export function positionRisks(
  p: Position,
  r: PositionRule,
  now = Date.now(),
  priceFresh = true,
): Risk[] {
  const automatic = p.analysisMode === 'automatic';
  const risks: Risk[] = automatic ? automaticRisks(p, now, priceFresh) : [],
    long = p.side === 'long';
  const deadline = planDeadline(r);
  if (!automatic && deadline !== null && now >= deadline)
    risks.push({
      code: 'deadline',
      severity: 'warning',
      message: `已到你设置的 ${r.holdHours} 小时复核时间，请检查止盈或退出计划；到期不代表价格已达目标`,
    });
  if (!priceFresh) return risks;
  if (
    !automatic &&
    r.stop !== null &&
    (long ? p.mark <= r.stop : p.mark >= r.stop)
  )
    risks.push({
      code: 'stop',
      severity: 'danger',
      message: '标记价已触及你设置的止损提醒，请立即核对是否执行退出计划',
    });
  if (r.maxLoss !== null && p.unrealized <= -r.maxLoss)
    risks.push({
      code: 'loss',
      severity: 'danger',
      message: '未实现亏损已达到你设置的上限，请核对减仓或退出计划',
    });
  const distance = liquidationDistance(p);
  if (distance !== null && distance <= r.liquidationDanger)
    risks.push({
      code: 'liquidation-danger',
      severity: 'danger',
      message:
        distance <= 0
          ? '币安返回的强平价已被触及，请立即核对账户状态'
          : `距币安强平价仅 ${distance.toFixed(2)}%，请立即核对风险`,
    });
  else if (distance !== null && distance <= r.liquidationWarning)
    risks.push({
      code: 'liquidation-warning',
      severity: 'warning',
      message: `距币安强平价 ${distance.toFixed(2)}%，注意仓位风险`,
    });
  if (!automatic && p.trend === 'opposes')
    risks.push({
      code: 'trend',
      severity: 'warning',
      message: '1h 和 4h 均线方向均与持仓相反，请检查原入场理由是否仍成立',
    });
  if (
    !automatic &&
    r.takeProfit !== null &&
    (long ? p.mark >= r.takeProfit : p.mark <= r.takeProfit)
  )
    risks.push({
      code: 'profit',
      severity: 'info',
      message: '标记价已达到你设置的止盈提醒，请检查止盈计划',
    });
  return risks;
}
export function validateRule(value: unknown): PositionRule {
  if (!value || typeof value !== 'object') throw new Error('预警条件无效');
  const v = value as Record<string, unknown>;
  const positive = (key: string) => {
    if (v[key] === null || v[key] === '') return null;
    if (typeof v[key] !== 'number' || !Number.isFinite(v[key]) || v[key] <= 0)
      throw new Error('价格与金额必须是大于零的数字');
    return v[key] as number;
  };
  const warning = v.liquidationWarning,
    danger = v.liquidationDanger;
  const note = (key: string) => {
    if (v[key] === undefined) return '';
    if (typeof v[key] !== 'string' || v[key].length > 1000)
      throw new Error('入场理由与退出条件须为 1000 字以内的文字');
    return v[key].trim();
  };
  const hold = v.holdHours ?? null,
    start = v.planStartedAt ?? null;
  if (hold !== null && ![1, 4, 24].includes(hold as number))
    throw new Error('计划持仓时间请选择 1、4 或 24 小时');
  if (
    start !== null &&
    (typeof start !== 'number' ||
      !Number.isFinite(start) ||
      start < Date.UTC(2000, 0, 1) ||
      start > Date.UTC(2100, 0, 1))
  )
    throw new Error('计划计时起点无效');
  if ((hold === null) !== (start === null))
    throw new Error('请同时设置计划时长和计时起点，或同时清空');
  if (
    typeof warning !== 'number' ||
    typeof danger !== 'number' ||
    !Number.isFinite(warning) ||
    !Number.isFinite(danger) ||
    danger <= 0 ||
    warning < danger ||
    warning > 50
  )
    throw new Error('强平距离阈值需满足 0 < 紧急阈值 ≤ 注意阈值 ≤ 50%');
  return {
    stop: positive('stop'),
    takeProfit: positive('takeProfit'),
    maxLoss: positive('maxLoss'),
    liquidationWarning: warning,
    liquidationDanger: danger,
    entryReason: note('entryReason'),
    invalidation: note('invalidation'),
    planStartedAt: start as number | null,
    holdHours: hold as number | null,
  };
}
