import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, type Candle } from '../lib/analytics.ts';
import { atr, buildSetup, type FuturesQuote } from '../lib/futures-analysis.ts';
const now = 4_000_000_000;
function bars(step: number, sign = 1): Candle[] {
  return Array.from({ length: 240 }, (_, i) => {
    const close = 100 + sign * (0.04 * i + 0.5 * Math.sin(i * 0.7));
    return {
      time: now - (240 - i) * step,
      closeTime: now - (239 - i) * step - 1,
      open: close - sign * 0.05,
      high: close + 0.4,
      low: close - 0.4,
      close,
      volume: 10,
    };
  });
}
function fixture(sign = 1) {
  const h = bars(3600000, sign),
    f = bars(14400000, sign),
    q = bars(900000, sign),
    price = analyze(h, now)!.ema20;
  const quote: FuturesQuote = {
    symbol: 'TESTUSDT',
    volume: 2e8,
    price,
    mark: price,
    change: 2,
    spreadBps: 1,
    funding: 0,
    nextFundingTime: now + 1000,
    fundingIntervalHours: 8,
    tick: 0.001,
    time: now - 1,
  };
  return { h, f, q, quote };
}
void test('ATR measures true range and flat candles have zero volatility', () => {
  const input = Array.from({ length: 20 }, (_, i) => ({
    time: i,
    closeTime: i,
    open: 10,
    close: 10,
    high: 11,
    low: 9,
    volume: 1,
  }));
  assert.equal(atr(input), 2);
  assert.equal(atr(input.map((c) => ({ ...c, high: 10, low: 10 }))), 0);
});
void test('Long plan has stop below entry and targets above, at least 1.5R and 2.5R', () => {
  const { h, f, q, quote } = fixture(),
    s = buildSetup(quote, h, f, q, 'steady', now).setup!;
  assert.equal(s.direction, 'long');
  assert.ok(
    s.stop < s.entryLow &&
      s.entryLow <= s.entry &&
      s.entry <= s.entryHigh &&
      s.target1 > s.entryHigh &&
      s.target2 > s.target1,
  );
  assert.ok((s.target1 - s.entry) / (s.entry - s.stop) >= 1.5 - 1e-8);
  assert.ok((s.target2 - s.entry) / (s.entry - s.stop) >= 2.5 - 1e-8);
  for (const v of [
    s.entryLow,
    s.entryHigh,
    s.entry,
    s.stop,
    s.target1,
    s.target2,
  ])
    assert.ok(Math.abs(v / quote.tick - Math.round(v / quote.tick)) < 1e-6);
});
void test('Short plan reverses stop and targets correctly', () => {
  const { h, f, q, quote } = fixture(-1),
    s = buildSetup(quote, h, f, q, 'steady', now).setup!;
  assert.equal(s.direction, 'short');
  assert.ok(
    s.stop > s.entryHigh &&
      s.entryLow <= s.entry &&
      s.entry <= s.entryHigh &&
      s.target1 < s.entryLow &&
      s.target2 < s.target1,
  );
  assert.ok((s.entry - s.target1) / (s.stop - s.entry) >= 1.5 - 1e-8);
  assert.ok((s.entry - s.target2) / (s.stop - s.entry) >= 2.5 - 1e-8);
});
void test('Conflicting timeframes do not yield a candidate', () => {
  const { h, q, quote } = fixture();
  assert.equal(
    buildSetup(quote, h, bars(14400000, -1), q, 'steady', now).setup,
    null,
  );
});
void test('A confirmation cannot justify chasing a price far outside its zone', () => {
  const { h, f, q, quote } = fixture(),
    first = buildSetup(quote, h, f, q, 'steady', now).setup!;
  assert.equal(first.status, 'confirmed');
  const changed = { ...quote, price: first.entryHigh + atr(h) * 4 };
  const second = buildSetup(changed, h, f, q, 'steady', now).setup!;
  assert.equal(second.status, 'extended');
});
void test('Adverse funding is filtered in the correct direction, receiving funding is not', () => {
  for (const sign of [1, -1]) {
    const { h, f, q, quote } = fixture(sign);
    assert.equal(
      buildSetup({ ...quote, funding: sign * 0.002 }, h, f, q, 'steady', now)
        .setup,
      null,
    );
    assert.ok(
      buildSetup({ ...quote, funding: -sign * 0.002 }, h, f, q, 'steady', now)
        .setup,
    );
  }
});
void test('Stale quotes and a price beyond the stop invalidate the setup', () => {
  for (const sign of [1, -1]) {
    const { h, f, q, quote } = fixture(sign),
      s = buildSetup(quote, h, f, q, 'steady', now).setup!;
    assert.equal(
      buildSetup({ ...quote, time: now - 121000 }, h, f, q, 'steady', now)
        .setup,
      null,
    );
    assert.equal(
      buildSetup(
        { ...quote, price: s.stop - sign * 0.1 },
        h,
        f,
        q,
        'steady',
        now,
      ).setup,
      null,
    );
  }
});
void test('Unclosed future candles cannot generate or alter a setup', () => {
  const { h, f, q, quote } = fixture();
  const future = {
    time: now,
    closeTime: now + 3600000,
    open: 1,
    high: 9999,
    low: 0,
    close: 9999,
    volume: 9999,
  };
  assert.deepEqual(
    buildSetup(
      quote,
      [...h, future],
      [...f, future],
      [...q, future],
      'steady',
      now,
    ),
    buildSetup(quote, h, f, q, 'steady', now),
  );
});
void test('Breakout confirmation requires an actual crossing and supporting 15m volume', () => {
  for (const sign of [1, -1]) {
    const { h, f, q, quote } = fixture(sign),
      previous = h.slice(-21, -1);
    const pivot =
      sign === 1
        ? Math.max(...previous.map((c) => c.high))
        : Math.min(...previous.map((c) => c.low));
    h[239] = {
      ...h[239],
      close: pivot + sign * 0.02,
      high: pivot + 0.5,
      low: pivot - 0.5,
      volume: 20,
    };
    const first = buildSetup(quote, h, f, q, 'active', now).setup!;
    assert.equal(first.strategy, 'breakout');
    const before = sign === 1 ? first.entryLow - 0.02 : first.entryHigh + 0.02;
    q[238] = {
      ...q[238],
      close: before,
      high: before + 0.2,
      low: before - 0.2,
    };
    q[239] = {
      ...q[239],
      open: first.entry - sign * 0.04,
      close: first.entry,
      high: first.entry + 0.2,
      low: first.entry - 0.2,
      volume: 10,
    };
    const live = { ...quote, price: first.entry, mark: first.entry };
    assert.equal(
      buildSetup(live, h, f, q, 'active', now).setup?.status,
      'zone',
    );
    q[239].volume = 20;
    assert.equal(
      buildSetup(live, h, f, q, 'active', now).setup?.status,
      'confirmed',
    );
  }
});
