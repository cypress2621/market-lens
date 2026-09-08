'use client';
import { useEffect, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  ArrowRight,
  ChartNoAxesCombined,
  Info,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Outcome, ProbabilityEstimate } from '@/lib/probability';

type Estimate = ProbabilityEstimate & {
  symbol: string;
  referencePrice: number;
  asOf: number;
  targetTime: number;
  upPrice: number;
  downPrice: number;
  calibrated: false;
};
const number = (value: number) =>
  value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 0.01 ? 8 : value < 1 ? 5 : 2,
  });
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const date = (value: number) =>
  new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
function Control({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <div className="probability-control">
      <span>{label}</span>
      <Select value={value} onValueChange={(v) => v !== null && onChange(v)}>
        <SelectTrigger aria-label={label}>
          <SelectValue>{options.find((o) => o[0] === value)?.[1]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map(([id, title]) => (
            <SelectItem key={id} value={id}>
              {title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
function OddsCard({
  direction,
  title,
  outcome,
  priceText,
  total,
}: {
  direction: 'up' | 'down' | 'flat';
  title: string;
  outcome: Outcome;
  priceText: string;
  total: number;
}) {
  const Icon =
    direction === 'up'
      ? ArrowUpRight
      : direction === 'down'
        ? ArrowDownRight
        : ArrowRight;
  return (
    <div className={`odds-card odds-${direction}`}>
      <div className="odds-title">
        <span>{title}</span>
        <Icon size={22} />
      </div>
      <strong>{percent(outcome.probability)}</strong>
      <p className="odds-price">{priceText}</p>
      <div className="odds-track" aria-hidden="true">
        <i style={{ width: percent(outcome.probability) }} />
      </div>
      <p className="odds-sample">
        历史出现 {outcome.count} / {total} 次
      </p>
      <p className="odds-range">
        频率参考范围 {percent(outcome.interval[0])} –{' '}
        {percent(outcome.interval[1])}
      </p>
    </div>
  );
}
export default function ProbabilityPanel({
  symbol,
  revision,
}: {
  symbol: string;
  revision: number;
}) {
  const [horizon, setHorizon] = useState('4'),
    [threshold, setThreshold] = useState('1'),
    [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<{
    key: string;
    data: Estimate | null;
    error: string;
    loading: boolean;
  }>({ key: '', data: null, error: '', loading: true });
  const key = `${symbol}:${horizon}:${threshold}:${refresh}:${revision}`;
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState({ key, data: null, error: '', loading: true });
      void fetch(
        `/api/probability?symbol=${symbol}&horizon=${horizon}&threshold=${threshold}`,
        { signal: controller.signal },
      )
        .then(async (r) => {
          const payload = (await r.json()) as Estimate & { error?: string };
          if (!r.ok) throw new Error(payload.error || '暂时无法计算');
          return payload;
        })
        .then((data) => {
          if (!controller.signal.aborted)
            setState({ key, data, error: '', loading: false });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setState({
              key,
              data: null,
              error: error instanceof Error ? error.message : '暂时无法计算',
              loading: false,
            });
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [symbol, horizon, threshold, key]);
  const current = state.key === key ? state : null,
    data = current?.data,
    loading = !current || current.loading;
  return (
    <section
      id="probability-panel"
      className="panel probability-panel"
      aria-label={`${symbol} 涨跌概率参考`}
    >
      <div className="probability-heading">
        <div>
          <h2>
            <ChartNoAxesCombined size={20} />
            {symbol.replace(/USDT$/, '')} · 现货涨跌概率参考
            <span className="tag blue">历史类比</span>
          </h2>
          <p className="subtext">
            {horizon} 小时后，涨跌幅达到 {threshold}% 的可能性有多大？
          </p>
        </div>
        <div className="probability-controls">
          <Control
            label="看多久之后"
            value={horizon}
            onChange={setHorizon}
            options={[
              ['1', '1 小时后'],
              ['4', '4 小时后'],
              ['24', '24 小时后'],
            ]}
          />
          <Control
            label="涨跌幅门槛"
            value={threshold}
            onChange={setThreshold}
            options={[
              ['0.5', '0.5%'],
              ['1', '1%'],
              ['2', '2%'],
              ['3', '3%'],
              ['5', '5%'],
            ]}
          />
          <button
            className="secondary"
            disabled={loading}
            onClick={() => setRefresh((v) => v + 1)}
          >
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            {loading ? '计算中' : '更新估计'}
          </button>
        </div>
      </div>
      {loading ? (
        <div className="probability-loading" aria-live="polite">
          <RefreshCw size={23} className="spin" />
          <div>
            <h3>正在查找历史相似行情</h3>
            <p>首次读取最多约 500 天的真实数据，之后切换条件会更快。</p>
          </div>
        </div>
      ) : current?.error ? (
        <div className="notice" role="alert">
          <TriangleAlert size={18} />
          <div>
            {current.error}
            <p>点击“更新估计”重试。连接失败时不显示旧概率。</p>
          </div>
        </div>
      ) : data ? (
        <>
          <div className="probability-reference">
            <span>
              参考价 <b>{number(data.referencePrice)} USDT</b>
            </span>
            <span>
              {date(data.asOf)} <ArrowRight size={13} /> {date(data.targetTime)}
            </span>
            <span>点击下方行情表中的币种可切换</span>
          </div>
          {data.status === 'ready' && data.outcomes ? (
            <div className="odds-grid">
              <OddsCard
                direction="up"
                title={`上涨至少 ${threshold}%`}
                outcome={data.outcomes.up}
                priceText={`到时价格 ≥ ${number(data.upPrice)}`}
                total={data.sampleCount}
              />
              <OddsCard
                direction="down"
                title={`下跌至少 ${threshold}%`}
                outcome={data.outcomes.down}
                priceText={`到时价格 ≤ ${number(data.downPrice)}`}
                total={data.sampleCount}
              />
              <OddsCard
                direction="flat"
                title={`涨跌未达到 ${threshold}%`}
                outcome={data.outcomes.flat}
                priceText={`到时价格介于 ${number(data.downPrice)} – ${number(data.upPrice)}`}
                total={data.sampleCount}
              />
            </div>
          ) : (
            <div className="probability-insufficient">
              <Info size={25} />
              <div>
                <h3>相似历史样本不足，暂不显示百分比</h3>
                <p>
                  找到 {data.sampleCount} 个不重叠样本，至少需要{' '}
                  {data.minimumSamples}{' '}
                  个。可缩短预测时长，或换一个历史更长的币种。
                </p>
              </div>
            </div>
          )}
          <div className="probability-evidence">
            <span>
              <b>{data.sampleCount}</b> 个相似样本
            </span>
            <span>
              历史覆盖{' '}
              {data.historyCount ? Math.round(data.historyCount / 24) : 0} 天
            </span>
            <span>
              {data.state
                ? `当前走势${data.state.trend} · 强弱${data.state.rsi}`
                : '历史不足'}
            </span>
            <span>
              指标截至 {data.featureTime ? date(data.featureTime) : '—'}
            </span>
          </div>
        </>
      ) : null}
      <div className="probability-note">
        <Info size={15} />
        <p>
          <b>这是相似历史的发生比例，尚未验证为可靠的预测概率。</b> 按小时走势和
          RSI 强弱分档匹配，剔除重叠收益区间；至少 30
          个样本才显示结果。历史整点收益用于估计当前快照之后的变化，价格门槛按参考价换算。统计的是到时涨跌，途中曾经触及不算。参考范围为历史频率的近似
          95% 区间，市场变化可能超出它。
        </p>
      </div>
    </section>
  );
}
