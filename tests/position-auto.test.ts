import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPositionAnalysis, automaticRisks } from '../lib/position-auto.ts';
import {
  defaultRule,
  positionRisks,
  type Position,
} from '../lib/position-risk.ts';
import type { Candle } from '../lib/analytics.ts';
const now = Date.UTC(2026, 8, 6),
  p: Position = {
    id: 'TESTUSDT:long',
    symbol: 'TESTUSDT',
    side: 'long',
    entry: 110,
    mark: 111,
    quantity: 2,
    unit: 'TEST',
    unrealized: 2,
    liquidation: 90,
    margin: null,
    mode: 'isolated',
    leverage: null,
    trend: 'unknown',
    analysisMode: 'automatic',
  };
function bars(step: number, sign = 1): Candle[] {
  return Array.from({ length: 240 }, (_, i) => {
    const close = 100 + sign * i * 0.04;
    return {
      time: now - (240 - i) * step,
      closeTime: now - (239 - i) * step - 1,
      open: close - 0.02,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 100,
    };
  });
}
const h = bars(3600000),
  f = bars(14400000),
  q = bars(900000);
void test('system automatically supplies reasons, structural stop and two profitable targets', () => {
  const a = buildPositionAnalysis(p, h, f, q, 0.01, undefined, now);
  assert.equal(a.trend, 'supports');
  assert.ok(a.reasons.length >= 4);
  assert.ok(a.stop > p.liquidation!);
  assert.ok(a.stop < p.mark);
  assert.ok(a.target1 > p.entry);
  assert.ok(a.target2 > a.target1);
});
void test('opposing direction is reported as lack of support, never fabricated entry rationale', () => {
  const short = { ...p, side: 'short' as const, liquidation: 140 };
  const a = buildPositionAnalysis(short, h, f, q, 0.01, undefined, now);
  assert.equal(a.trend, 'opposes');
  assert.match(a.reasons[0], /反对/);
  assert.ok(a.target2 < a.target1 && a.target1 < short.entry);
  assert.ok(a.stop < short.liquidation!);
});
void test('refresh cannot loosen a stop, move profit targets, or reset review clock', () => {
  const first = buildPositionAnalysis(p, h, f, q, 0.01, undefined, now);
  const lower = h.map((c) => ({ ...c, low: c.low - 5 }));
  const next = buildPositionAnalysis(
    { ...p, mark: 115 },
    lower,
    f,
    q,
    0.01,
    first,
    now + 1000,
  );
  assert.ok(next.stop >= first.stop);
  assert.equal(next.target1, first.target1);
  assert.equal(next.target2, first.target2);
  assert.equal(next.createdAt, first.createdAt);
  const changed = buildPositionAnalysis(
    { ...p, entry: 109 },
    h,
    f,
    q,
    0.01,
    first,
    now + 1000,
  );
  assert.equal(changed.createdAt, now + 1000);
});
void test('short stop never loosens; liquidation clearance is applied', () => {
  const short = {
    ...p,
    side: 'short' as const,
    entry: 90,
    mark: 90,
    liquidation: 92,
  };
  const downH = bars(3600000, -1),
    downF = bars(14400000, -1),
    downQ = bars(900000, -1);
  const first = buildPositionAnalysis(
    short,
    downH,
    downF,
    downQ,
    0.01,
    undefined,
    now,
  );
  const next = buildPositionAnalysis(
    short,
    downH.map((c) => ({ ...c, high: c.high + 8 })),
    downF,
    downQ,
    0.01,
    first,
    now + 1000,
  );
  assert.ok(next.stop <= first.stop);
  assert.ok(next.stop < short.liquidation);
  assert.equal(next.target2, first.target2);
});
void test('missing or stale history does not yield made-up automatic levels', () => {
  assert.throws(() => buildPositionAnalysis(p, [], f, q, 0.01, undefined, now));
  assert.throws(() =>
    buildPositionAnalysis(p, h, f, q, 0.01, undefined, now + 24 * 3600000),
  );
});
void test('open candles cannot affect automatic reasons or prices', () => {
  const future = {
    ...h.at(-1)!,
    time: now,
    closeTime: now + 3600000,
    close: 9999,
    high: 9999,
    low: 1,
  };
  assert.deepEqual(
    buildPositionAnalysis(p, [...h, future], f, q, 0.01, undefined, now),
    buildPositionAnalysis(p, h, f, q, 0.01, undefined, now),
  );
});
void test('automatic stops and targets trigger without manual price entry', () => {
  const auto = buildPositionAnalysis(p, h, f, q, 0.01, undefined, now);
  assert.ok(
    positionRisks({ ...p, auto, mark: auto.stop }, defaultRule, now).some(
      (r) => r.code === 'auto-stop',
    ),
  );
  assert.ok(
    positionRisks({ ...p, auto, mark: auto.target1 }, defaultRule, now).some(
      (r) => r.code === 'auto-target1',
    ),
  );
  assert.ok(
    positionRisks({ ...p, auto, mark: auto.target2 }, defaultRule, now).some(
      (r) => r.code === 'auto-target2',
    ),
  );
  assert.ok(
    !positionRisks(
      { ...p, auto },
      { ...defaultRule, stop: 9999, takeProfit: 1 },
      now,
    ).some((r) => r.code === 'stop' || r.code === 'profit'),
  );
});
void test('fixed price lines remain monitored on technical failure, while stale account prices only allow time alerts', () => {
  const auto = {
    ...buildPositionAnalysis(p, h, f, q, 0.01, undefined, now),
    error: 'unavailable',
  };
  assert.ok(
    automaticRisks({ ...p, auto, mark: auto.stop }, now, true).some(
      (r) => r.code === 'auto-stop',
    ),
  );
  const codes = automaticRisks(
    { ...p, auto, mark: auto.stop },
    now + 4 * 3600000,
    false,
  ).map((r) => r.code);
  assert.deepEqual(codes, ['auto-1h-deadline', 'auto-4h-deadline']);
});
