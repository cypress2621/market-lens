import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultRule,
  validateRule,
  planDeadline,
  positionRisks,
  type Position,
} from '../lib/position-risk.ts';
import { horizonOutlook, profitReference } from '../lib/position-outlook.ts';
import type { Candle } from '../lib/analytics.ts';
const start = Date.UTC(2026, 8, 1),
  hour = 3600000;
const p: Position = {
  id: 'TESTUSDT:long',
  symbol: 'TESTUSDT',
  side: 'long',
  quantity: 2,
  unit: 'TEST',
  entry: 100,
  mark: 102,
  unrealized: 4,
  liquidation: 80,
  margin: null,
  mode: 'unknown',
  leverage: null,
  trend: 'unknown',
};
void test('legacy rules retain their existing prices and acquire empty plan fields', () => {
  const legacy = {
    stop: 95,
    takeProfit: 110,
    maxLoss: 20,
    liquidationWarning: 2,
    liquidationDanger: 1,
  };
  assert.deepEqual(validateRule(legacy), { ...defaultRule, ...legacy });
});
void test('plan deadline is anchored to saved time, not page refresh or quote update', () => {
  const rule = {
    ...defaultRule,
    holdHours: 4,
    planStartedAt: start,
    entryReason: '支撑回踩',
    invalidation: '失守支撑时退出',
  };
  assert.equal(planDeadline(rule), start + 4 * hour);
  assert.equal(positionRisks(p, rule, start + 4 * hour - 1).length, 0);
  assert.equal(positionRisks(p, rule, start + 4 * hour)[0].code, 'deadline');
  assert.equal(planDeadline({ ...rule }), start + 4 * hour);
  assert.equal(planDeadline(defaultRule), null);
});
void test('time reminder survives stale quotes without making fresh price decisions', () => {
  const rule = {
    ...defaultRule,
    holdHours: 1,
    planStartedAt: start,
    stop: 110,
  };
  assert.deepEqual(
    positionRisks(p, rule, start + hour, false).map((r) => r.code),
    ['deadline'],
  );
  assert.deepEqual(positionRisks(p, rule, start, false), []);
});
void test('notes and timer input are validated without interpreting free text as executable conditions', () => {
  assert.equal(
    validateRule({ ...defaultRule, entryReason: '  回踩做多  ' }).entryReason,
    '回踩做多',
  );
  for (const delta of [
    { entryReason: 'a'.repeat(1001) },
    { invalidation: 1 },
    { holdHours: 4 },
    { planStartedAt: start },
    { holdHours: 2, planStartedAt: start },
    { holdHours: 4, planStartedAt: NaN },
  ])
    assert.throws(() => validateRule({ ...defaultRule, ...delta }));
});
function bars(count = 1000): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    time: start + i * hour,
    closeTime: start + (i + 1) * hour - 1,
    open: 100,
    high: 110,
    low: 90,
    close: 100 * 1.001 ** i,
    volume: 1,
  }));
}
void test('1/4/24h use non-overlapping endpoint returns with known direction', () => {
  for (const h of [1, 4, 24]) {
    const r = horizonOutlook(bars(), h, start + 1001 * hour);
    assert.equal(r.samples, Math.floor(999 / h));
    assert.ok(Math.abs(r.median! - (1.001 ** h - 1)) < 1e-10);
  }
});
void test('unclosed bars cannot change quantiles and gaps remove invalid return windows', () => {
  const input = bars(),
    now = start + 1000 * hour;
  const future = {
    ...input.at(-1)!,
    time: now,
    closeTime: now + hour - 1,
    close: 1e8,
  };
  assert.deepEqual(
    horizonOutlook([...input, future], 24, now),
    horizonOutlook(input, 24, now),
  );
  assert.ok(
    horizonOutlook(
      input.filter((_, i) => i !== 985),
      24,
      now,
    ).samples < horizonOutlook(input, 24, now).samples,
  );
  assert.equal(horizonOutlook(bars(100), 24, now).upper, null);
});
void test('profit reference rounds to contract tick and rejects loss-side or sparse targets', () => {
  const row = { hours: 4, samples: 100, lower: -0.02, median: 0, upper: 0.025 };
  assert.deepEqual(profitReference(p, row, 100, 0.1), { price: 102.5, pnl: 5 });
  assert.deepEqual(profitReference({ ...p, side: 'short' }, row, 100, 0.1), {
    price: 98,
    pnl: 4,
  });
  assert.equal(profitReference({ ...p, entry: 110 }, row, 100, 0.1), null);
  assert.equal(profitReference(p, { ...row, upper: -0.01 }, 100, 0.1), null);
  assert.equal(profitReference(p, { ...row, samples: 29 }, 100, 0.1), null);
});
