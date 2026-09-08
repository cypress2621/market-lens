import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateProbability,
  rsiSeries,
  wilson,
  HOUR,
} from '../lib/probability.ts';
import { rsi, type Candle } from '../lib/analytics.ts';

function history(count: number, ratio = 1.01): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    time: i * HOUR,
    closeTime: (i + 1) * HOUR - 1,
    open: 100 * Math.pow(ratio, i),
    close: 100 * Math.pow(ratio, i + 1),
    high: 110 * Math.pow(ratio, i + 1),
    low: 90 * Math.pow(ratio, i + 1),
    volume: 10,
  }));
}
void test('Historical categories are exhaustive; return windows do not overlap', () => {
  const bars = history(500);
  const result = estimateProbability(bars, 4, 3, 500 * HOUR);
  assert.equal(result.status, 'ready');
  assert.equal(result.sampleCount, Math.floor((499 - 100) / 4));
  assert.equal(result.outcomes?.up.probability, 1);
  assert.equal(result.outcomes?.down.probability, 0);
  assert.equal(result.outcomes?.flat.probability, 0);
  const all = result.outcomes!;
  assert.equal(
    all.up.count + all.down.count + all.flat.count,
    result.sampleCount,
  );
});
void test('Measures endpoint price, not intraperiod highs or lows', () => {
  const result = estimateProbability(history(500), 4, 5, 500 * HOUR);
  assert.equal(result.outcomes?.flat.probability, 1);
});
void test('Threshold equality includes an exact one percent rise despite floating point error', () => {
  const result = estimateProbability(history(500), 1, 1, 500 * HOUR);
  assert.equal(result.outcomes?.up.probability, 1);
});
void test('Downward moves are classified with the correct sign', () => {
  const result = estimateProbability(history(500, 0.99), 4, 3, 500 * HOUR);
  assert.equal(result.outcomes?.down.probability, 1);
});
void test('Sparse evidence does not produce percentages', () => {
  const result = estimateProbability(history(200), 24, 3, 200 * HOUR);
  assert.equal(result.status, 'insufficient');
  assert.equal(result.outcomes, null);
  assert.ok(result.sampleCount < 30);
});
void test('Unknown future candles cannot alter a historical estimate', () => {
  const expected = estimateProbability(history(500), 4, 1, 500 * HOUR);
  const withFuture = history(510);
  withFuture[505].close = 1e99;
  assert.deepEqual(estimateProbability(withFuture, 4, 1, 500 * HOUR), expected);
});
void test('Missing hourly data is not treated as a complete observation window', () => {
  const complete = history(500),
    missing = complete.filter((_, i) => i % 2 === 0);
  const result = estimateProbability(missing, 4, 1, 500 * HOUR);
  assert.equal(result.sampleCount, 0);
  assert.equal(result.outcomes, null);
});
void test('Streaming features match prefix-only calculations, including mixed returns', () => {
  const values = Array.from(
      { length: 200 },
      (_, i) => 100 + Math.sin(i * 0.7) * 3 + i * 0.02,
    ),
    series = rsiSeries(values);
  for (let i = 14; i < values.length; i++)
    assert.ok(Math.abs(series[i] - rsi(values.slice(0, i + 1))) < 1e-10);
});
void test('Wilson intervals retain uncertainty even when every example agrees', () => {
  const low = wilson(0, 30),
    high = wilson(30, 30),
    middle = wilson(50, 100);
  assert.ok(low[1] > 0.1);
  assert.ok(high[0] < 0.9);
  assert.ok(Math.abs(middle[0] - 0.4038315) < 1e-6);
  assert.ok(Math.abs(middle[1] - 0.5961685) < 1e-6);
});
void test('Unsupported horizons and thresholds are rejected', () => {
  assert.throws(() => estimateProbability(history(500), 8, 1), /不支持/);
  assert.throws(() => estimateProbability(history(500), 4, 0), /不支持/);
});
