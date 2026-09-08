import test from 'node:test';
import assert from 'node:assert/strict';
import { ema, rsi, analyze } from '../lib/analytics.ts';
import type { Candle } from '../lib/analytics.ts';
void test('EMA recurrence and flat series', () => {
  assert.deepEqual(ema([10, 20, 30], 3), [10, 15, 22.5]);
  assert.deepEqual(ema([], 20), []);
  assert.equal(ema(Array(100).fill(25), 20).at(-1), 25);
});
void test('Wilder RSI matches known numerical reference', () => {
  const closes = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89,
    46.03, 45.61, 46.28, 46.28,
  ];
  assert.ok(Math.abs(rsi(closes) - 70.464135) < 0.00001);
  assert.equal(rsi(Array(20).fill(10)), 50);
  assert.equal(rsi(Array.from({ length: 20 }, (_, i) => i)), 100);
  assert.equal(rsi(Array.from({ length: 20 }, (_, i) => 20 - i)), 0);
});
const bars: Candle[] = Array.from({ length: 80 }, (_, i) => ({
  time: i * 1000,
  closeTime: i * 1000 + 999,
  open: 100 + i,
  high: 101 + i,
  low: 99 + i,
  close: 100.5 + i,
  volume: 10,
}));
void test('Unclosed candles never affect signals', () => {
  const expected = analyze(bars, 80000);
  const unfinished = {
    time: 80000,
    closeTime: 80999,
    open: 1,
    high: 999999,
    low: 0,
    close: 999999,
    volume: 999999,
  };
  assert.deepEqual(analyze([...bars, unfinished], 80500), expected);
  assert.equal(expected?.trend, true);
});
void test('Breakout compares previous twenty bars, excluding signal candle', () => {
  const input = bars.map((b) => ({ ...b }));
  input[79].close = 190;
  input[79].high = 191;
  input[79].volume = 20;
  const a = analyze(input, 80000);
  assert.equal(a?.breakout, true);
  assert.equal(a?.volumeRatio, 2);
  assert.equal(analyze(input.slice(0, 59), 80000), null);
});
