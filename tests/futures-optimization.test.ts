import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, type Candle } from '../lib/analytics.ts';
import {
  buildSetup,
  type Setup,
  type FuturesQuote,
} from '../lib/futures-analysis.ts';
import {
  executionEstimate,
  setupFresh,
  setupGroup,
} from '../lib/futures-quality.ts';
import { signalState, trackSignals } from '../lib/futures-tracking.ts';
import { scanReport } from '../lib/futures-market.ts';
const now = Date.now();
function bars(step: number, sign = 1): Candle[] {
  return Array.from({ length: 240 }, (_, i) => {
    const close = 100 + sign * (0.04 * i + 0.5 * Math.sin(i * 0.7));
    return {
      time: now - (240 - i) * step,
      closeTime: now - (239 - i) * step - 1,
      open: close - sign * 0.05,
      close,
      high: close + 0.4,
      low: close - 0.4,
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
    nextFundingTime: now + 3600000,
    fundingIntervalHours: 8,
    tick: 0.001,
    time: now - 1,
    bid: price - 0.001,
    ask: price + 0.001,
  };
  return { h, f, q, quote };
}
function setup(sign = 1): Setup {
  const { h, f, q, quote } = fixture(sign);
  return buildSetup(quote, h, f, q, 'steady', now).setup!;
}
const costs = { feePct: 0.05, slippagePct: 0.02, hours: 4 };
void test('Rejects missing, duplicate, reversed or malformed closed candles and invalid quote clocks', () => {
  const { h, f, q, quote } = fixture();
  for (const broken of [
    h.filter((_, i) => i !== 100),
    [...h.slice(0, 100), h[99], ...h.slice(101)],
    [...h].reverse(),
    h.map((c, i) => (i === 100 ? { ...c, closeTime: NaN } : c)),
  ])
    assert.equal(buildSetup(quote, broken, f, q, 'steady', now).setup, null);
  for (const time of [NaN, Infinity, now + 86400000, now - 120001])
    assert.equal(
      buildSetup({ ...quote, time }, h, f, q, 'steady', now).setup,
      null,
    );
});
void test('Executable entry beyond zone cannot retain confirmed status', () => {
  for (const sign of [1, -1]) {
    const s = setup(sign),
      { h, f, q, quote } = fixture(sign);
    assert.equal(s.status, 'confirmed');
    const changed =
      sign === 1
        ? { ...quote, ask: s.entryHigh + 0.01 }
        : { ...quote, bid: s.entryLow - 0.01 };
    assert.notEqual(
      buildSetup(changed, h, f, q, 'steady', now).setup?.status,
      'confirmed',
    );
  }
});
void test('Funding cap compares equivalent eight-hour costs, missing interval cannot confirm', () => {
  const { h, f, q, quote } = fixture();
  assert.ok(
    buildSetup(
      { ...quote, funding: 0.0004, fundingIntervalHours: 8 },
      h,
      f,
      q,
      'steady',
      now,
    ).setup,
  );
  assert.equal(
    buildSetup(
      { ...quote, funding: 0.0004, fundingIntervalHours: 1 },
      h,
      f,
      q,
      'steady',
      now,
    ).setup,
    null,
  );
  assert.notEqual(
    buildSetup(
      { ...quote, fundingIntervalHours: undefined },
      h,
      f,
      q,
      'steady',
      now,
    ).setup?.status,
    'confirmed',
  );
});
void test('Quote, one-hour, four-hour and confirmation freshness independently expire', () => {
  const s = setup();
  assert.ok(setupFresh(s, now));
  for (const changed of [
    { ...s, quote: { ...s.quote, time: now - 120001 } },
    { ...s, barTime: now - 3660001 },
    { ...s, trendTime: now - 14460001 },
    { ...s, confirmationTime: now - 960001 },
  ])
    assert.equal(setupFresh(changed, now), false);
  assert.equal(executionEstimate(s, costs, now + 121000), null);
});
void test('Current edge-of-zone RR is lower than midpoint RR; costs reduce long and short returns', () => {
  for (const sign of [1, -1]) {
    const s = setup(sign),
      book = sign === 1 ? s.entryHigh : s.entryLow;
    s.quote = { ...s.quote, bid: book, ask: book };
    const e = executionEstimate(s, costs, now)!;
    assert.ok(e.grossRR! < 1.5);
    assert.ok(e.rr! < e.grossRR!);
    const expected = (sign * (s.target1 - book)) / (sign * (book - s.stop));
    assert.ok(Math.abs(expected - e.grossRR!) < 1e-10);
    const entry = book * (1 + sign * 0.0002),
      exit = s.target1 * (1 - sign * 0.0002),
      stop = s.stop * (1 - sign * 0.0002);
    assert.ok(
      Math.abs(
        e.rr! -
          (sign * (exit - entry) - (entry + exit) * 0.0005) /
            (sign * (entry - stop) + (entry + stop) * 0.0005),
      ) < 1e-10,
    );
  }
});
void test('Funding settlements include horizon boundary and never bank receiving-side credits', () => {
  for (const sign of [1, -1]) {
    const s = setup(sign);
    s.quote.funding = sign * 0.0001;
    s.quote.fundingIntervalHours = 4;
    s.quote.nextFundingTime = now + 2 * 3600000;
    assert.equal(
      executionEstimate(s, { ...costs, hours: 1 }, now)!.settlements,
      0,
    );
    const e = executionEstimate(s, { ...costs, hours: 6 }, now)!;
    assert.equal(e.settlements, 2);
    assert.ok(Math.abs(e.fundingPct! - 0.02) < 1e-9);
    s.quote.funding = -sign * 0.0001;
    assert.equal(executionEstimate(s, costs, now)!.fundingPct, 0);
    s.quote.fundingIntervalHours = undefined;
    assert.equal(executionEstimate(s, costs, now)!.rr, null);
  }
});
void test('Invalid assumptions and prices past target or stop do not manufacture a useful RR', () => {
  const s = setup();
  for (const c of [
    { ...costs, feePct: NaN },
    { ...costs, feePct: -1 },
    { ...costs, slippagePct: 100 },
    { ...costs, hours: 100 },
  ])
    assert.equal(executionEstimate(s, c, now), null);
  for (const ask of [s.target1 + 1, s.stop - 1])
    assert.equal(
      executionEstimate({ ...s, quote: { ...s.quote, ask } }, costs, now)!.rr,
      null,
    );
});
void test('Signal tracking distinguishes baseline, continuation, confirmation and genuine departure', () => {
  const state = signalState(),
    s = { ...setup(), status: 'zone' as const };
  trackSignals(state, [s], [], now);
  assert.equal(s.change, 'baseline');
  const next = { ...s };
  trackSignals(state, [next], [], now + 1);
  assert.equal(next.change, 'ongoing');
  const confirmed = { ...s, status: 'confirmed' as const };
  trackSignals(state, [confirmed], [], now + 2);
  assert.equal(confirmed.change, 'new-confirmation');
  assert.equal(confirmed.firstSeen, now);
  assert.deepEqual(trackSignals(state, [], ['TESTUSDT'], now + 3), []);
  const resumed = { ...confirmed };
  trackSignals(state, [resumed], [], now + 4);
  assert.equal(resumed.change, 'resumed');
  assert.deepEqual(trackSignals(state, [], [], now + 5), ['TESTUSDT']);
  const again = { ...s };
  trackSignals(state, [again], [], now + 6);
  assert.equal(again.change, 'new');
  assert.equal(again.firstSeen, now + 6);
});
void test('First successful read after unknown data establishes baseline, not a fabricated new signal', () => {
  const state = signalState();
  trackSignals(state, [], ['TESTUSDT'], now);
  const s = setup();
  trackSignals(state, [s], [], now + 1);
  assert.equal(s.change, 'baseline');
});
void test('Confirmed, near-trigger and watch groups are exclusive', () => {
  const s = setup();
  assert.equal(setupGroup(s), 'confirmed');
  assert.equal(setupGroup({ ...s, status: 'zone' }), 'near');
  assert.equal(
    setupGroup({ ...s, status: 'waiting', distanceAtr: 0.5 }),
    'near',
  );
  assert.equal(
    setupGroup({ ...s, status: 'waiting', distanceAtr: 0.51 }),
    'watch',
  );
  assert.equal(setupGroup({ ...s, status: 'extended' }), 'watch');
});
void test('Scans beyond old 40-symbol cap, refreshes quotes last, and exposes failed symbols', async () => {
  const symbols = Array.from({ length: 47 }, (_, i) => 'T' + i + 'USDT'),
    { quote, h, f, q } = fixture();
  let tickerCalls = 0,
    completed = 0;
  const requested = new Set<string>();
  async function json<T>(path: string): Promise<T> {
    const u = new URL(path, 'http://local');
    let result: unknown;
    if (u.pathname.endsWith('exchangeInfo'))
      result = {
        symbols: symbols.map((symbol) => ({
          symbol,
          status: 'TRADING',
          contractType: 'PERPETUAL',
          quoteAsset: 'USDT',
          underlyingType: 'COIN',
          onboardDate: now - 100 * 86400000,
          filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.001' }],
        })),
      };
    else if (u.pathname.endsWith('fundingInfo')) result = [];
    else if (u.pathname.endsWith('24hr')) {
      tickerCalls++;
      if (tickerCalls === 2) assert.equal(completed, 46);
      result = symbols.map((symbol, i) => ({
        symbol,
        lastPrice: String(tickerCalls === 1 ? quote.price * 1.1 : quote.price),
        quoteVolume: i === 46 ? 'NaN' : '200000000',
        priceChangePercent: '2',
        closeTime: now - 1,
      }));
    } else if (u.pathname.endsWith('premiumIndex'))
      result = symbols.map((symbol) => ({
        symbol,
        markPrice: String(quote.price),
        lastFundingRate: '0',
        nextFundingTime: now + 3600000,
        time: now - 1,
      }));
    else if (u.pathname.endsWith('bookTicker'))
      result = symbols.map((symbol) => ({
        symbol,
        bidPrice: String(quote.bid),
        askPrice: String(quote.ask),
        time: tickerCalls === 2 && symbol === 'T2USDT' ? now - 200000 : now - 1,
      }));
    else if (u.pathname.endsWith('klines')) {
      const symbol = u.searchParams.get('symbol')!,
        interval = u.searchParams.get('interval');
      requested.add(symbol);
      if (symbol === 'T0USDT') {
        if (interval === '1h') completed++;
        throw new Error('read failed');
      }
      const source = interval === '1h' ? h : interval === '4h' ? f : q;
      result = source
        .filter(
          (_, i) => !(symbol === 'T1USDT' && interval === '1h' && i === 100),
        )
        .map((c) => [
          c.time,
          c.open,
          c.high,
          c.low,
          c.close,
          c.volume,
          c.closeTime,
        ]);
    } else if (u.pathname.endsWith('openInterestHist')) {
      completed++;
      result = [
        { sumOpenInterest: '100', timestamp: now - 3600001 },
        { sumOpenInterest: '101', timestamp: now - 1 },
      ];
    } else throw new Error('unexpected public route');
    return result as T;
  }
  const r = await scanReport('active', json);
  assert.equal(r.universe, 47);
  assert.equal(r.eligible, 46);
  assert.equal(r.scanned, 46);
  assert.equal(requested.size, 46);
  assert.deepEqual(r.failedSymbols, ['T0USDT', 'T1USDT', 'T2USDT']);
  assert.equal(r.failed, 3);
  assert.ok(r.marketUnavailable.includes('T46USDT'));
  assert.equal(r.candidates.length, 43);
  assert.ok(
    r.candidates.every(
      (s) => s.quote.price === quote.price && s.status === 'confirmed',
    ),
  );
  assert.equal(tickerCalls, 2);
});
