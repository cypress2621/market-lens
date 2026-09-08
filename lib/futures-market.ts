import { futuresJson } from './futures-api.ts';
import {
  buildSetup,
  type FuturesQuote,
  type Profile,
  type Setup,
} from './futures-analysis.ts';
import { freshTime, setupFresh } from './futures-quality.ts';
import { signalState, trackSignals } from './futures-tracking.ts';
import type { Candle } from './analytics.ts';
type Info = {
  symbols: {
    symbol: string;
    status: string;
    contractType: string;
    quoteAsset: string;
    underlyingType: string;
    onboardDate: number;
    filters: { filterType: string; tickSize?: string }[];
  }[];
};
type Ticker = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  closeTime: number;
};
type Mark = {
  symbol: string;
  markPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
  time: number;
};
type Book = {
  symbol: string;
  bidPrice: string;
  askPrice: string;
  time?: number;
};
type Funding = { symbol: string; fundingIntervalHours: number };
type OI = { sumOpenInterest: string; timestamp: number };
export type FuturesReport = {
  profile: Profile;
  asOf: number;
  marketTime: number;
  universe: number;
  eligible: number;
  scanned: number;
  failed: number;
  failedSymbols: string[];
  failedReasons: Record<string, string>;
  marketUnavailable: string[];
  departed: string[];
  durationMs: number;
  rejected: Record<string, number>;
  candidates: Setup[];
  minVolume: number;
  spreadLimit: number;
  oiMissing: number;
};
const reports = new Map<Profile, FuturesReport>(),
  jobs = new Map<Profile, Promise<FuturesReport>>();
const histories = { steady: signalState(), active: signalState() };
export async function candidatesReport(
  profile: Profile,
): Promise<FuturesReport> {
  const cached = reports.get(profile);
  if (
    cached &&
    Date.now() - cached.asOf < 60000 &&
    freshTime(cached.marketTime, Date.now()) &&
    cached.candidates.every((s) => setupFresh(s, Date.now()))
  )
    return cached;
  const pending = jobs.get(profile);
  if (pending) return pending;
  const job = scanReport(profile).then((report) => {
    report.departed = trackSignals(
      histories[profile],
      report.candidates,
      [...report.failedSymbols, ...report.marketUnavailable],
      report.asOf,
    );
    reports.set(profile, report);
    return report;
  });
  jobs.set(profile, job);
  try {
    return await job;
  } finally {
    jobs.delete(profile);
  }
}
/** Whole eligible universe, bounded I/O; injected transport permits deterministic coverage tests. */
export async function scanReport(
  profile: Profile,
  json: typeof futuresJson = futuresJson,
): Promise<FuturesReport> {
  const started = Date.now(),
    minVolume = profile === 'steady' ? 1e8 : 3e7,
    spreadLimit = profile === 'steady' ? 5 : 10;
  const [info, funding] = await Promise.all([
    json<Info>('/fapi/v1/exchangeInfo', 3600000),
    json<Funding[]>('/fapi/v1/fundingInfo', 300000).catch(() => null),
  ]);
  const universe = info.symbols.filter(
    (s) =>
      s.status === 'TRADING' &&
      s.contractType === 'PERPETUAL' &&
      s.quoteAsset === 'USDT' &&
      s.underlyingType === 'COIN',
  );
  const fundingMap = new Map(
    (funding ?? []).map((f) => [f.symbol, f.fundingIntervalHours]),
  );
  async function quotes(ttl: number) {
    const [tickers, marks, books] = await Promise.all([
      json<Ticker[]>('/fapi/v1/ticker/24hr', ttl),
      json<Mark[]>('/fapi/v1/premiumIndex', ttl),
      json<Book[]>('/fapi/v1/ticker/bookTicker', ttl),
    ]);
    const tickMap = new Map(tickers.map((t) => [t.symbol, t])),
      markMap = new Map(marks.map((m) => [m.symbol, m])),
      bookMap = new Map(books.map((b) => [b.symbol, b]));
    const valid = new Map<string, FuturesQuote>(),
      unavailable = new Set<string>(),
      now = Date.now();
    for (const meta of universe) {
      const t = tickMap.get(meta.symbol),
        m = markMap.get(meta.symbol),
        b = bookMap.get(meta.symbol);
      if (!t || !m || !b) {
        unavailable.add(meta.symbol);
        continue;
      }
      const bid = +b.bidPrice,
        ask = +b.askPrice,
        price = +t.lastPrice,
        mark = +m.markPrice,
        volume = +t.quoteVolume,
        change = +t.priceChangePercent,
        rate = +m.lastFundingRate;
      const tick = Number(
        meta.filters.find((f) => f.filterType === 'PRICE_FILTER')?.tickSize,
      );
      if (
        ![bid, ask, price, mark, tick].every(
          (v) => Number.isFinite(v) && v > 0,
        ) ||
        !Number.isFinite(volume) ||
        volume < 0 ||
        !Number.isFinite(change) ||
        !Number.isFinite(rate) ||
        ask < bid ||
        !Number.isFinite(meta.onboardDate) ||
        meta.onboardDate > now ||
        !freshTime(t.closeTime, now) ||
        !freshTime(m.time, now) ||
        !freshTime(b.time ?? NaN, now)
      ) {
        unavailable.add(meta.symbol);
        continue;
      }
      const interval = fundingMap.get(meta.symbol) ?? (funding ? 8 : undefined);
      const known = Number.isFinite(interval) && (interval ?? 0) > 0;
      valid.set(meta.symbol, {
        symbol: meta.symbol,
        volume,
        price,
        mark,
        change,
        tick,
        bid,
        ask,
        spreadBps: ((ask - bid) / ((ask + bid) / 2)) * 10000,
        funding: rate,
        nextFundingTime: m.nextFundingTime,
        time: Math.min(t.closeTime, m.time, b.time!),
        fundingIntervalHours: known ? interval : undefined,
        fundingIntervalSource: !known
          ? 'unavailable'
          : fundingMap.has(meta.symbol)
            ? 'exchange'
            : 'default',
      });
    }
    if (!valid.size) throw new Error('合约市场行情缺失或过期，请稍后刷新');
    return { valid, unavailable };
  }
  const initial = await quotes(30000),
    meta = new Map(universe.map((s) => [s.symbol, s]));
  const eligible = (q: FuturesQuote) =>
    q.volume >= minVolume &&
    q.spreadBps <= spreadLimit &&
    Date.now() - meta.get(q.symbol)!.onboardDate >=
      (profile === 'steady' ? 30 : 7) * 86400000;
  // Volume controls processing order only; no top-N truncation.
  const targets = [...initial.valid.values()]
    .filter(eligible)
    .sort((a, b) => b.volume - a.volume);
  const candles = new Map<string, [Candle[], Candle[], Candle[]]>(),
    oi = new Map<string, OI[]>(),
    failed = new Set<string>(),
    failedReasons: Record<string, string> = {};
  let cursor = 0;
  async function candle(symbol: string, interval: string) {
    const data = await json<(string | number)[][]>(
      `/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=240`,
      60000,
    );
    return data.map((k) => ({
      time: +k[0],
      open: +k[1],
      high: +k[2],
      low: +k[3],
      close: +k[4],
      volume: +k[5],
      closeTime: +k[6],
    }));
  }
  async function worker() {
    while (cursor < targets.length) {
      const q = targets[cursor++];
      try {
        candles.set(
          q.symbol,
          await Promise.all([
            candle(q.symbol, '1h'),
            candle(q.symbol, '4h'),
            candle(q.symbol, '15m'),
          ]),
        );
      } catch {
        failed.add(q.symbol);
        failedReasons[q.symbol] = 'K 线请求失败';
        continue;
      }
      // OI is supplementary and cannot fail or confirm a technical signal.
      try {
        oi.set(
          q.symbol,
          await json<OI[]>(
            `/futures/data/openInterestHist?symbol=${q.symbol}&period=1h&limit=2`,
            60000,
          ),
        );
      } catch {
        /* explicitly reported if a candidate needs OI */
      }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  if (targets.length && failed.size === targets.length)
    throw new Error('本轮合约 K 线读取全部失败，请稍后重试');
  // Refresh executable prices after slow K-line/OI reads, not before them.
  const latest = await quotes(0),
    now = Date.now(),
    rejected: Record<string, number> = {},
    setups: Setup[] = [];
  let oiMissing = 0;
  const reject = (reason: string) => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
  };
  for (const target of targets) {
    if (failed.has(target.symbol)) continue;
    const quote = latest.valid.get(target.symbol),
      bars = candles.get(target.symbol)!;
    if (!quote) {
      failed.add(target.symbol);
      failedReasons[target.symbol] = '本轮结束时行情缺失或过期';
      continue;
    }
    if (!eligible(quote)) {
      reject('本轮结束时流动性条件不再满足');
      continue;
    }
    const result = buildSetup(quote, ...bars, profile, now);
    if (!result.setup) {
      if (
        [
          '数据过期',
          'K 线不足、不连续或字段异常',
          '历史 K 线不足',
          '波动数据异常',
          '价格或资金费率异常',
        ].includes(result.reason)
      ) {
        failed.add(target.symbol);
        failedReasons[target.symbol] = result.reason;
      } else reject(result.reason);
      continue;
    }
    const s = result.setup;
    if (!setupFresh(s, Date.now())) {
      failed.add(target.symbol);
      failedReasons[target.symbol] = '分析完成时数据已过期';
      continue;
    }
    const points = oi.get(s.symbol),
      before = points?.[0],
      after = points?.[1];
    if (
      before &&
      after &&
      Number.isFinite(+before.sumOpenInterest) &&
      +before.sumOpenInterest > 0 &&
      Number.isFinite(+after.sumOpenInterest) &&
      +after.sumOpenInterest >= 0 &&
      after.timestamp - before.timestamp === 3600000 &&
      freshTime(after.timestamp, now, 5400000)
    ) {
      s.oiChange = (+after.sumOpenInterest / +before.sumOpenInterest - 1) * 100;
      s.oiTime = after.timestamp;
    } else oiMissing++;
    setups.push(s);
  }
  const rank = { confirmed: 0, zone: 1, waiting: 2, extended: 3 };
  setups.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      a.distanceAtr - b.distanceAtr ||
      b.quote.volume - a.quote.volume ||
      a.symbol.localeCompare(b.symbol),
  );
  // Initial missing data cannot be interpreted as a signal disappearing.
  const unavailable = new Set([...initial.unavailable, ...latest.unavailable]);
  return {
    profile,
    asOf: now,
    marketTime: setups.length
      ? Math.min(...setups.map((s) => s.quote.time))
      : Math.max(...[...latest.valid.values()].map((q) => q.time)),
    universe: universe.length,
    eligible: targets.length,
    scanned: targets.length,
    failed: failed.size,
    failedSymbols: [...failed].sort(),
    failedReasons,
    marketUnavailable: [...unavailable].sort(),
    departed: [],
    durationMs: now - started,
    rejected,
    candidates: setups,
    minVolume,
    spreadLimit,
    oiMissing,
  };
}
