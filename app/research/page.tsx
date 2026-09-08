'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronRight,
  Clock3,
  Info,
  Pause,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';

import MarketChart from '@/components/market-chart';
import ProbabilityPanel from '@/components/probability-panel';

import type { Analysis, Candle, MarketRow } from '@/lib/analytics';

type Market = { rows: MarketRow[]; asOf: number; source: string };
type Detail = {
  candles: Candle[];
  analysis: Analysis | null;
  symbol: string;
  interval: string;
};
type ScanItem = { analysis: Analysis | null; error?: string };
const stable = new Set([
  'USDC',
  'FDUSD',
  'TUSD',
  'USDP',
  'DAI',
  'USD1',
  'USDE',
  'USDD',
  'AEUR',
  'EUR',
  'EURI',
  'XUSD',
  'BUSD',
  'PAX',
  'USTC',
]);
const compact = (n: number) =>
  n >= 1e8
    ? `${(n / 1e8).toFixed(2)} 亿`
    : n >= 1e4
      ? `${(n / 1e4).toFixed(1)} 万`
      : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const price = (n?: number) =>
  n == null || !Number.isFinite(n)
    ? '—'
    : n.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: n < 0.01 ? 8 : n < 1 ? 5 : 2,
      });
const pct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
const stamp = (n?: number) =>
  n
    ? new Date(n).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
    : '尚未更新';
async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal });
  const d = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(d.error || '数据请求失败');
  return d;
}
function Choice({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="filter-field">
      <span>{label}</span>
      <Select value={value} onValueChange={(v) => v !== null && onChange(v)}>
        <SelectTrigger className="filter-select" aria-label={label}>
          <SelectValue>{options.find((o) => o[0] === value)?.[1]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, t]) => (
            <SelectItem key={v} value={v}>
              {t}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
function Signal({ a }: { a: Analysis }) {
  return (
    <div className="signal-tags">
      {a.trend && <span className="tag blue">均线多头</span>}
      {a.breakout && a.volumeRatio >= 1.5 && (
        <span className="tag green">放量突破</span>
      )}
      {a.rsi < 30 && <span className="tag amber">RSI 超卖</span>}
      {a.rsi > 70 && <span className="tag rose">RSI 超买</span>}
      {!a.trend &&
        !(a.breakout && a.volumeRatio >= 1.5) &&
        a.rsi >= 30 &&
        a.rsi <= 70 && <span className="tag neutral">中性观察</span>}
    </div>
  );
}

export default function Home() {
  const [market, setMarket] = useState<Market | null>(null),
    [marketError, setMarketError] = useState(''),
    [loading, setLoading] = useState(true),
    [automatic, setAutomatic] = useState(true);
  const [query, setQuery] = useState(''),
    [minVolume, setMinVolume] = useState('1000000'),
    [direction, setDirection] = useState('all'),
    [minAmplitude, setMinAmplitude] = useState('0'),
    [sort, setSort] = useState('volume'),
    [excludeStable, setExcludeStable] = useState(true),
    [signal, setSignal] = useState('all');
  const [symbol, setSymbol] = useState('BTCUSDT'),
    [interval, setInterval] = useState('1h'),
    [detail, setDetail] = useState<Detail | null>(null),
    [detailError, setDetailError] = useState(''),
    [detailLoading, setDetailLoading] = useState(true),
    [detailTick, setDetailTick] = useState(0);
  const [scan, setScan] = useState<Record<string, ScanItem>>({}),
    [scanRunning, setScanRunning] = useState(false),
    [scanProgress, setScanProgress] = useState({
      done: 0,
      total: 0,
      failed: 0,
    }),
    [scanNote, setScanNote] = useState(''),
    [scanAt, setScanAt] = useState<number | null>(null);
  const scanControl = useRef<AbortController | null>(null),
    marketBusy = useRef(false);
  const refresh = useCallback(async () => {
    if (marketBusy.current) return;
    marketBusy.current = true;
    setLoading(true);
    try {
      const d = await json<Market>('/api/market');
      setMarket(d);
      setMarketError('');
      setDetailTick((t) => t + 1);
    } catch (e) {
      setMarketError(e instanceof Error ? e.message : '行情连接失败');
    } finally {
      marketBusy.current = false;
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => {
      void refresh();
    }, 0);
    if (!automatic) return () => window.clearTimeout(initial);
    const id = setIntervalSafe(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(id);
    };
  }, [refresh, automatic]);
  useEffect(() => () => scanControl.current?.abort(), []);
  useEffect(() => {
    const c = new AbortController();
    const initial = window.setTimeout(() => {
      setDetail(null);
      setDetailError('');
      setDetailLoading(true);
      json<Detail>(
        `/api/klines?symbol=${symbol}&interval=${interval}`,
        c.signal,
      )
        .then(setDetail)
        .catch((e) => {
          if (!c.signal.aborted) setDetailError(e.message);
        })
        .finally(() => {
          if (!c.signal.aborted) setDetailLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(initial);
      c.abort();
    };
  }, [symbol, interval, detailTick]);
  const rows = useMemo(() => market?.rows || [], [market]);
  const candidates = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!excludeStable || !stable.has(r.base)) &&
          r.symbol.includes(query.trim().toUpperCase()) &&
          r.volume >= +minVolume &&
          r.amplitude >= +minAmplitude &&
          (direction === 'all' ||
            (direction === 'up' ? r.change > 0 : r.change < 0)),
      ),
    [rows, excludeStable, query, minVolume, minAmplitude, direction],
  );
  const visible = useMemo(
    () =>
      candidates
        .filter((r) => {
          if (signal === 'all') return true;
          const a = scan[r.symbol]?.analysis;
          if (!a) return false;
          return signal === 'trend'
            ? a.trend
            : signal === 'breakout'
              ? a.breakout && a.volumeRatio >= 1.5
              : signal === 'oversold'
                ? a.rsi < 30
                : a.rsi > 70;
        })
        .sort((a, b) =>
          sort === 'gainers'
            ? b.change - a.change
            : sort === 'losers'
              ? a.change - b.change
              : sort === 'amplitude'
                ? b.amplitude - a.amplitude
                : b.volume - a.volume,
        ),
    [candidates, signal, sort, scan],
  );
  const up = rows.filter((r) => r.change > 0).length,
    down = rows.filter((r) => r.change < 0).length,
    totalVolume = rows.reduce((s, r) => s + r.volume, 0),
    selected = rows.find((r) => r.symbol === symbol),
    a = detail?.analysis;
  const scannedHere = candidates.filter((r) => scan[r.symbol]?.analysis).length;
  const recordScan = useCallback((key: string, item: ScanItem) => {
    setScan((previous) => ({ ...previous, [key]: item }));
  }, []);
  async function startScan() {
    if (scanRunning || !candidates.length) return;
    const controller = new AbortController();
    scanControl.current = controller;
    const targets = [...candidates];
    setScan({});
    setScanRunning(true);
    setScanAt(Date.now());
    setScanNote('使用 1 小时已收盘 K 线，逐批扫描当前基础筛选范围');
    setScanProgress({ done: 0, total: targets.length, failed: 0 });
    let cursor = 0;
    async function worker() {
      while (cursor < targets.length && !controller.signal.aborted) {
        const row = targets[cursor++];
        let failed = false;
        try {
          const d = await json<Detail>(
            `/api/klines?symbol=${row.symbol}&interval=1h`,
            controller.signal,
          );
          recordScan(row.symbol, { analysis: d.analysis });
          if (!d.analysis) failed = true;
        } catch (e) {
          if (controller.signal.aborted) return;
          failed = true;
          const message = e instanceof Error ? e.message : '请求失败';
          recordScan(row.symbol, { analysis: null, error: message });
          if (message.includes('限流')) {
            setScanNote('触发行情限流，扫描已停止。请稍后重新扫描。');
            controller.abort();
          }
        }
        setScanProgress((p) => ({
          ...p,
          done: p.done + 1,
          failed: p.failed + (failed ? 1 : 0),
        }));
        await new Promise((resolve) => window.setTimeout(resolve, 150));
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    setScanRunning(false);
    if (!controller.signal.aborted)
      setScanNote('扫描完成 · 结果不会自动刷新，可重新扫描获取最新指标');
  }
  function reset() {
    setQuery('');
    setMinVolume('1000000');
    setDirection('all');
    setMinAmplitude('0');
    setSort('volume');
    setExcludeStable(true);
    setSignal('all');
  }
  return (
    <main className="workspace">
      <section className="page-heading">
        <div>
          <p className="eyebrow">市场观察 / SPOT MARKET</p>
          <h1>
            市场研究<span>.</span>
          </h1>
          <p className="subtext">现货市场扫描 · 涨跌概率参考 · 技术指标</p>
        </div>
        <button
          className="secondary"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          {loading ? '更新中' : '刷新行情'}
        </button>
      </section>
      <div className="status-line" aria-live="polite">
        <i
          style={{
            background: marketError
              ? '#d79225'
              : market
                ? '#158367'
                : '#8a96a7',
          }}
        />
        {marketError
          ? market
            ? '更新失败 · 当前显示上次快照'
            : '行情暂时不可用'
          : market
            ? '公开实时行情'
            : '正在连接行情'}
        <span className="status-divider">/</span>
        <Clock3 size={13} />
        {stamp(market?.asOf)}
        <label className="auto-label" htmlFor="automatic-refresh">
          <Checkbox
            id="automatic-refresh"
            checked={automatic}
            onCheckedChange={(v) => setAutomatic(Boolean(v))}
          />
          每 30 秒刷新
        </label>
      </div>
      {marketError && (
        <div className="notice error" role="alert">
          <TriangleAlert size={17} />
          <div>
            {marketError}
            <p>
              请确认当前网络能够访问 Binance
              公开市场数据，再点击刷新。未使用模拟数据。
            </p>
          </div>
        </div>
      )}
      <section className="summary-grid" aria-label="全市场概览">
        <div className="summary-card">
          <span>
            USDT 现货市场 <BarChart3 size={17} />
          </span>
          <strong>
            {market ? rows.length : '—'}
            <small> 个交易对</small>
          </strong>
          <p>全部在交易的 USDT 现货</p>
        </div>
        <div className="summary-card">
          <span>
            24h 总成交额 <Activity size={17} />
          </span>
          <strong>
            {market ? compact(totalVolume) : '—'}
            <small> USDT</small>
          </strong>
          <p>滚动 24 小时 · 非市值</p>
        </div>
        <div className="summary-card">
          <span>
            市场涨跌分布 <TrendingUp size={17} />
          </span>
          <strong className="breadth">
            <b className="positive">
              {market ? up : '—'} <ArrowUpRight size={19} />
            </b>
            <em>/</em>
            <b className="negative">
              {market ? down : '—'} <ArrowDownRight size={19} />
            </b>
          </strong>
          <div className="breadth-track">
            <i
              style={{
                width: `${rows.length ? (up / rows.length) * 100 : 0}%`,
              }}
            />
            <b
              style={{
                width: `${rows.length ? (down / rows.length) * 100 : 0}%`,
              }}
            />
          </div>
          <p>其余 {market ? rows.length - up - down : '—'} 个持平</p>
        </div>
        <div className="summary-card accent-card">
          <span>
            筛选结果 <SlidersHorizontal size={17} />
          </span>
          <strong>
            {market ? visible.length : '—'}
            <small> 个匹配</small>
          </strong>
          <p>
            基础范围 {candidates.length} 个 · 指标已得 {scannedHere} 个
          </p>
        </div>
      </section>

      <ProbabilityPanel symbol={symbol} revision={market?.asOf || 0} />
      <section className="panel filter-panel">
        <div className="section-heading">
          <h2>
            <SlidersHorizontal size={18} />
            市场筛选器
          </h2>
          <button className="text-button" onClick={reset}>
            重置条件
          </button>
        </div>
        <div className="filter-grid">
          <label className="filter-field">
            <span>交易对搜索</span>
            <span className="search">
              <Search size={17} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="BTC、ETH、SOL…"
                aria-label="交易对搜索"
              />
            </span>
          </label>
          <Choice
            label="24h 最低成交额"
            value={minVolume}
            onChange={setMinVolume}
            options={[
              ['0', '不限'],
              ['1000000', '100 万 USDT'],
              ['10000000', '1,000 万 USDT'],
              ['100000000', '1 亿 USDT'],
            ]}
          />
          <Choice
            label="24h 最低振幅"
            value={minAmplitude}
            onChange={setMinAmplitude}
            options={[
              ['0', '不限'],
              ['3', '≥ 3%'],
              ['5', '≥ 5%'],
              ['10', '≥ 10%'],
            ]}
          />
          <Choice
            label="技术信号 · 1h"
            value={signal}
            onChange={setSignal}
            options={[
              ['all', '全部信号'],
              ['trend', '均线多头'],
              ['breakout', '放量突破'],
              ['oversold', 'RSI 超卖 < 30'],
              ['overbought', 'RSI 超买 > 70'],
            ]}
          />
        </div>
        <div className="filter-bottom">
          <label className="check-label" htmlFor="exclude-stablecoins">
            <Checkbox
              id="exclude-stablecoins"
              checked={excludeStable}
              onCheckedChange={(v) => setExcludeStable(Boolean(v))}
            />
            排除常见稳定币 / 法币
          </label>
          <span>可关闭排除项并将成交额设为“不限”以扫描完整范围</span>
        </div>
      </section>
      <div className="market-layout">
        <section className="panel market-panel">
          <div className="section-heading">
            <div className="heading-with-count">
              <h2>市场行情</h2>
              <span>{visible.length}</span>
            </div>
            <Choice
              label="排序方式"
              value={sort}
              onChange={setSort}
              options={[
                ['volume', '成交额优先'],
                ['gainers', '涨幅优先'],
                ['losers', '跌幅优先'],
                ['amplitude', '振幅优先'],
              ]}
            />
          </div>
          <div className="table-toolbar">
            <Tabs
              value={direction}
              onValueChange={(v) => setDirection(String(v))}
            >
              <TabsList>
                <TabsTrigger value="all">全部</TabsTrigger>
                <TabsTrigger value="up">上涨</TabsTrigger>
                <TabsTrigger value="down">下跌</TabsTrigger>
              </TabsList>
            </Tabs>
            <span>计价 USDT · 点击币种查看概率与图表</span>
          </div>
          <div className="market-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>交易对</TableHead>
                  <TableHead className="num">最新价</TableHead>
                  <TableHead className="num">24h 涨跌</TableHead>
                  <TableHead className="num">24h 成交额</TableHead>
                  <TableHead className="num">振幅</TableHead>
                  <TableHead>1h 技术信号</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r, i) => (
                  <TableRow
                    key={r.symbol}
                    data-state={symbol === r.symbol ? 'selected' : undefined}
                  >
                    <TableCell>
                      <button
                        className="coin-button"
                        onClick={() => {
                          setSymbol(r.symbol);
                          document
                            .getElementById('probability-panel')
                            ?.scrollIntoView({
                              behavior: 'smooth',
                              block: 'start',
                            });
                        }}
                      >
                        <span
                          className="coin-avatar"
                          style={{
                            background: [
                              '#fff3dd',
                              '#edf0ff',
                              '#e9f6f2',
                              '#f0edfb',
                            ][i % 4],
                            color: ['#ab7520', '#5966ba', '#287b65', '#8764b7'][
                              i % 4
                            ],
                          }}
                        >
                          {r.base.slice(0, 1)}
                        </span>
                        <span>
                          <b>{r.base}</b>
                          <small>/ USDT</small>
                        </span>
                      </button>
                    </TableCell>
                    <TableCell className="num">{price(r.price)}</TableCell>
                    <TableCell
                      className={`num ${r.change >= 0 ? 'positive' : 'negative'}`}
                    >
                      {pct(r.change)}
                    </TableCell>
                    <TableCell className="num muted">
                      {compact(r.volume)}
                    </TableCell>
                    <TableCell className="num muted">
                      {r.amplitude.toFixed(2)}%
                    </TableCell>
                    <TableCell>
                      {scan[r.symbol]?.analysis ? (
                        <Signal a={scan[r.symbol].analysis!} />
                      ) : (
                        <span className="muted small">
                          {scan[r.symbol] ? '数据不足 / 失败' : '待扫描'}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {!visible.length && (
            <div className="empty-state">
              <Search size={30} />
              <h3>
                {!market
                  ? '等待真实行情'
                  : signal !== 'all' && !scannedHere
                    ? '请先运行技术扫描'
                    : '没有匹配的交易对'}
              </h3>
              <p>
                {!market
                  ? '连接成功后将在这里显示市场数据。'
                  : '可调整筛选条件，或运行右侧技术扫描。'}
              </p>
            </div>
          )}
          <div className="table-footer">
            <span>
              显示 {visible.length} / {rows.length} 个交易对
            </span>
            <span>振幅 =（最高 − 最低）/ 开盘价</span>
          </div>
        </section>
        <aside className="panel scan-panel">
          <div className="section-heading">
            <h2>
              <span className="scan-icon">
                <Activity size={18} />
              </span>
              机会扫描
            </h2>
            <span className="tag blue">1h</span>
          </div>
          <p className="subtext">
            对当前基础筛选范围逐一计算技术指标，寻找值得进一步观察的结构。
          </p>
          <div className="scan-rules">
            <div>
              <span className="rule-dot blue-dot" />
              <div>
                <h3>均线多头</h3>
                <p>收盘价 &gt; EMA20 &gt; EMA50</p>
              </div>
            </div>
            <div>
              <span className="rule-dot green-dot" />
              <div>
                <h3>放量突破</h3>
                <p>
                  收盘突破此前 20 根最高价
                  <br />
                  成交量 ≥ 此前 20 根均量的 1.5 倍
                </p>
              </div>
            </div>
            <div>
              <span className="rule-dot amber-dot" />
              <div>
                <h3>RSI 极值</h3>
                <p>RSI(14) &lt; 30 或 &gt; 70</p>
              </div>
            </div>
          </div>
          <button
            className="primary scan-button"
            onClick={() => {
              if (scanRunning) {
                scanControl.current?.abort();
                setScanNote('扫描已停止，保留已完成结果');
              } else void startScan();
            }}
            disabled={!candidates.length}
          >
            {scanRunning ? <Pause size={16} /> : <Play size={16} />}{' '}
            {scanRunning ? '停止扫描' : `扫描 ${candidates.length} 个交易对`}
          </button>
          {scanProgress.total > 0 && (
            <div className="scan-status" aria-live="polite">
              <div>
                <span>
                  {scanRunning
                    ? '正在扫描'
                    : scanProgress.done === scanProgress.total
                      ? '本轮完成'
                      : '本轮已停止'}
                </span>
                <b>
                  {scanProgress.done} / {scanProgress.total}
                </b>
              </div>
              <Progress
                value={scanProgress.done}
                max={scanProgress.total}
                aria-label="技术扫描进度"
              />
              <p>{scanNote}</p>
              <p>
                失败 / 数据不足：{scanProgress.failed} · 开始{' '}
                {stamp(scanAt || undefined)}
              </p>
            </div>
          )}
          <div className="scan-footnote">
            <Info size={15} />
            <span>
              信号是筛选条件，不代表未来收益。部分新币可能没有足够的历史 K 线。
            </span>
          </div>
        </aside>
      </div>
      <section className="panel detail-panel" id="coin-detail">
        <div className="section-heading detail-heading">
          <div>
            <div className="detail-title">
              <h2>
                {symbol.replace(/USDT$/, '')}
                <span>/ USDT</span>
              </h2>
              <span className="tag neutral">现货</span>
            </div>
            <div className="detail-price">
              {price(selected?.price)}{' '}
              {selected && (
                <span
                  className={selected.change >= 0 ? 'positive' : 'negative'}
                >
                  {pct(selected.change)} <small>24h</small>
                </span>
              )}
            </div>
          </div>
          <div className="interval-control">
            <Choice
              label="K 线周期"
              value={interval}
              onChange={setInterval}
              options={[
                ['15m', '15 分钟'],
                ['1h', '1 小时'],
                ['4h', '4 小时'],
                ['1d', '1 天'],
              ]}
            />
            <button
              className="icon-button"
              aria-label="刷新 K 线"
              disabled={detailLoading}
              onClick={() => setDetailTick((t) => t + 1)}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </div>
        <div className="detail-grid">
          <div>
            {detailLoading ? (
              <div className="chart-empty">
                <RefreshCw className="spin" size={22} />
                正在读取 {symbol} 的真实 K 线…
              </div>
            ) : detailError ? (
              <div className="chart-empty" role="alert">
                <TriangleAlert size={24} />
                {detailError}
                <button
                  className="secondary"
                  onClick={() => setDetailTick((t) => t + 1)}
                >
                  重试
                </button>
              </div>
            ) : detail ? (
              <MarketChart candles={detail.candles} />
            ) : null}
          </div>
          <aside className="indicator-panel">
            <div className="section-heading">
              <h3>技术读数</h3>
              <span className="tag neutral">{interval}</span>
            </div>
            {a ? (
              <>
                <Signal a={a} />
                <dl>
                  <div>
                    <dt>RSI (14)</dt>
                    <dd
                      className={
                        a.rsi > 70 ? 'negative' : a.rsi < 30 ? 'amber-text' : ''
                      }
                    >
                      {a.rsi.toFixed(2)}
                    </dd>
                  </div>
                  <div>
                    <dt>EMA 20</dt>
                    <dd>{price(a.ema20)}</dd>
                  </div>
                  <div>
                    <dt>EMA 50</dt>
                    <dd>{price(a.ema50)}</dd>
                  </div>
                  <div>
                    <dt>相对成交量</dt>
                    <dd>{a.volumeRatio.toFixed(2)} ×</dd>
                  </div>
                  <div>
                    <dt>20 根高点突破</dt>
                    <dd>
                      {a.breakout ? (
                        <span className="positive">
                          已确认 <Check size={13} />
                        </span>
                      ) : (
                        '未突破'
                      )}
                    </dd>
                  </div>
                </dl>
                <p className="indicator-time">
                  <Clock3 size={13} />
                  收盘 {stamp(a.time)}
                </p>
              </>
            ) : (
              <p className="subtext">
                {detailLoading
                  ? '正在计算…'
                  : detailError
                    ? '行情连接失败'
                    : '至少需要 60 根已收盘 K 线'}
              </p>
            )}
            <p className="subtext small">
              指标基于已收盘 K 线。均线以首根收盘价初始化；相对成交量与此前 20
              根比较。
            </p>
          </aside>
        </div>
      </section>
      <footer>
        <span>
          币析 MARKET LENS <ChevronRight size={12} /> 数据来源：Binance
          公开现货与合约 API
        </span>
        <span>
          时间按浏览器本地时区显示 · 独立分析工具，非 Binance 官方网站
        </span>
      </footer>
    </main>
  );
}
function setIntervalSafe(callback: () => void, ms: number) {
  return window.setInterval(callback, ms);
}
