'use client';
import { useEffect, useState } from 'react';
import {
  Radar,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Clock3,
  Info,
  ExternalLink,
  Target,
  ShieldAlert,
} from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { FuturesReport } from '@/lib/futures-market';
import type { Setup } from '@/lib/futures-analysis';
import {
  executionEstimate,
  setupFresh,
  freshTime,
  setupGroup,
  type CostAssumptions,
} from '@/lib/futures-quality';
const groupLabels = {
  confirmed: '已确认',
  near: '接近触发',
  watch: '持续观察',
};
const changeLabels = {
  baseline: '首次观察',
  new: '本轮新增',
  'new-confirmation': '本轮转为确认',
  ongoing: '持续跟踪',
  resumed: '数据恢复',
};

const date = (n: number) =>
  new Date(n).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
const change = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
function SetupCard({
  item,
  costs,
  now,
}: {
  item: Setup;
  costs: CostAssumptions;
  now: number;
}) {
  const estimate = executionEstimate(item, costs, now);
  const q = item.quote,
    long = item.direction === 'long',
    digits = Math.min(
      10,
      (q.tick.toFixed(10).replace(/0+$/, '').split('.')[1] || '').length,
    ),
    price = (n: number) =>
      n.toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
  const color = long ? 'positive' : 'negative';
  return (
    <article
      className={`contract-card ${item.status === 'confirmed' ? 'contract-confirmed' : ''}`}
    >
      <div className="contract-card-heading">
        <div>
          <h3>
            {item.symbol.replace(/USDT$/, '')} <small>/ USDT 永续</small>
          </h3>
          <span className="contract-last">
            {price(q.price)}{' '}
            <b className={q.change >= 0 ? 'positive' : 'negative'}>
              {change(q.change)} <small>24h</small>
            </b>
          </span>
        </div>
        <span className={`contract-side ${long ? 'long' : 'short'}`}>
          {long ? <ArrowUpRight size={17} /> : <ArrowDownRight size={17} />}偏
          {long ? '多' : '空'}
        </span>
      </div>
      <div className="contract-status">
        <span
          className={`tag ${item.status === 'confirmed' ? 'green' : item.status === 'zone' ? 'blue' : 'neutral'}`}
        >
          {item.statusText}
        </span>
        <span className="tag neutral">
          {changeLabels[item.change ?? 'baseline']}
        </span>
        <span>{item.strategy === 'breakout' ? '突破观察' : '顺势回撤'}</span>
      </div>
      <div className="entry-zone">
        <span>
          入场观察区 <small>需满足下方确认条件</small>
        </span>
        <strong className={color}>
          {price(item.entryLow)} – {price(item.entryHigh)}
        </strong>
      </div>
      <div className="contract-levels">
        <div>
          <span>
            <ShieldAlert size={13} />
            结构止损参考
          </span>
          <b>{price(item.stop)}</b>
          <small>距区间中点 {item.riskPct.toFixed(2)}%</small>
        </div>
        <div>
          <span>
            <Target size={13} />
            目标 1 · 中点 1.5R
          </span>
          <b>{price(item.target1)}</b>
          <small>价格空间 {item.targetPct.toFixed(2)}%</small>
        </div>
        <div>
          <span>
            <Target size={13} />
            目标 2 · 中点 2.5R
          </span>
          <b>{price(item.target2)}</b>
          <small>按风险距离推算</small>
        </div>
      </div>
      <div className="execution-estimate">
        <div>
          <span>按当前{long ? '卖一' : '买一'}报价 · 第一目标盈亏比</span>
          <strong>
            {estimate?.grossRR != null
              ? estimate.grossRR.toFixed(2) + ' : 1'
              : '暂不可用'}
          </strong>
        </div>
        <div>
          <span>扣除估算成本后</span>
          <strong
            className={
              estimate?.rr != null && estimate.rr >= 1 ? 'positive' : 'negative'
            }
          >
            {estimate?.rr != null ? estimate.rr.toFixed(2) + ' : 1' : '待核实'}
          </strong>
        </div>
        <p>
          {estimate?.reason ||
            (estimate?.rr != null
              ? `按持仓 ${costs.hours} 小时、预计 ${estimate.settlements} 次资金结算估算；实际成交及后续费率会变化。`
              : '报价或参数无效，暂不估算。')}
        </p>
        {item.status !== 'confirmed' && (
          <p>尚未满足确认条件，上述比值不表示可以立即入场。</p>
        )}
      </div>
      <p className="entry-condition">
        <b>等什么再考虑入场</b>
        {item.condition}
      </p>
      <p className="entry-invalidation">
        <b>什么时候取消</b>
        {item.invalidReason}
      </p>
      <div className="contract-evidence">
        <span>1h / 4h 趋势一致</span>
        <span>RSI {item.rsi.toFixed(1)}</span>
        <span>1h 量比 {item.volumeRatio.toFixed(2)}×</span>
      </div>
      <dl className="contract-metrics">
        <div>
          <dt>24h 成交额</dt>
          <dd>{(q.volume / 1e8).toFixed(2)} 亿 USDT</dd>
        </div>
        <div>
          <dt>买卖价差</dt>
          <dd>{(q.spreadBps / 100).toFixed(3)}%</dd>
        </div>
        <div>
          <dt>
            资金费率 ·{' '}
            {q.fundingIntervalHours
              ? q.fundingIntervalHours + 'h / 次'
              : '周期暂缺'}
          </dt>
          <dd>
            {q.funding > 0 ? '+' : ''}
            {(q.funding * 100).toFixed(4)}%
          </dd>
        </div>
        <div>
          <dt>持仓量近 1h 变化</dt>
          <dd>{item.oiChange === null ? '暂缺' : change(item.oiChange)}</dd>
        </div>
      </dl>
      <div className="contract-card-footer">
        <span>
          <Clock3 size={12} />
          15m 确认数据 {date(item.confirmationTime)}
          <small>
            行情 {date(q.time)} · OI {item.oiTime ? date(item.oiTime) : '暂缺'}
          </small>
          <small>
            下次资金结算{' '}
            {q.nextFundingTime > now ? date(q.nextFundingTime) : '待更新'}
          </small>
          <small>
            周期来源：
            {q.fundingIntervalSource === 'exchange'
              ? '交易所调整信息'
              : q.fundingIntervalSource === 'default'
                ? '未列入调整名单，按默认 8h'
                : '暂不可用'}
          </small>
          <small>
            本次服务首次观察 {item.firstSeen ? date(item.firstSeen) : '—'}
          </small>
          {item.lastConfirmedAt && (
            <small>
              最近转为确认对应的 15m 收盘 {date(item.lastConfirmedAt)}
            </small>
          )}
        </span>
        <a
          href={`https://www.binance.com/en/futures/${encodeURIComponent(item.symbol)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          查看合约
          <ExternalLink size={13} />
        </a>
      </div>
    </article>
  );
}
export default function FuturesPanel() {
  const [profile, setProfile] = useState('steady'),
    [direction, setDirection] = useState('all'),
    [revision, setRevision] = useState(0),
    [limit, setLimit] = useState(6),
    [group, setGroup] = useState('confirmed'),
    [now, setNow] = useState(0),
    [costs, setCosts] = useState<CostAssumptions>({
      feePct: 0.05,
      slippagePct: 0.02,
      hours: 4,
    });
  const key = `${profile}:${revision}`;
  const [state, setState] = useState<{
    key: string;
    data: FuturesReport | null;
    error: string;
  }>({ key: '', data: null, error: '' });
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/futures/candidates?profile=${profile}`, {
        signal: controller.signal,
      })
        .then(async (r) => {
          const d = (await r.json()) as FuturesReport & { error?: string };
          if (!r.ok) throw new Error(d.error || '合约数据暂不可用');
          return d;
        })
        .then((data) => {
          if (!controller.signal.aborted) {
            setNow(Date.now());
            setState({ key, data, error: '' });
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setState({
              key,
              data: null,
              error:
                error instanceof Error ? error.message : '合约数据暂不可用',
            });
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [profile, key]);
  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(clock);
  }, []);
  useEffect(() => {
    // Start the next timer after this scan finishes; never abort a slow scan every two minutes.
    if (state.key !== key) return;
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') setRevision((v) => v + 1);
    };
    const timer = window.setTimeout(refreshVisible, 90000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [state.key, key]);
  const current = state.key === key ? state : null,
    data = current?.data,
    loading = !current,
    effectiveNow = now || data?.asOf || 0,
    freshItems =
      data?.candidates.filter((c) => setupFresh(c, effectiveNow)) || [],
    staleCount = (data?.candidates.length ?? 0) - freshItems.length,
    directionItems = freshItems.filter(
      (c) => direction === 'all' || c.direction === direction,
    ),
    items = directionItems.filter((c) => setupGroup(c) === group);
  return (
    <section className="panel futures-panel" id="futures-candidates">
      <div className="futures-heading">
        <div>
          <p className="eyebrow">合约机会 / FUTURES WATCH</p>
          <h2>
            <Radar size={23} />
            合约入场候选<span className="tag blue">USDT 永续</span>
          </h2>
          <p className="subtext">
            多空都看 · 参考持仓 1–24 小时 · 给出入场条件，不替你追价
          </p>
        </div>
        <div className="futures-actions">
          <Select
            value={profile}
            onValueChange={(value) => {
              if (value) {
                setProfile(value);
                setLimit(6);
              }
            }}
          >
            <SelectTrigger aria-label="合约筛选风格">
              <SelectValue>
                {profile === 'steady'
                  ? '稳健筛选 · 条件较严'
                  : '积极筛选 · 放宽条件'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="steady">稳健筛选 · 条件较严</SelectItem>
              <SelectItem value="active">积极筛选 · 放宽条件</SelectItem>
            </SelectContent>
          </Select>
          <button
            className="primary"
            disabled={loading}
            onClick={() => setRevision((v) => v + 1)}
          >
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            {loading ? '扫描中' : '刷新候选'}
          </button>
        </div>
      </div>
      <div className="futures-toolbar">
        <Tabs
          value={direction}
          onValueChange={(v) => {
            setDirection(String(v));
            setLimit(6);
          }}
        >
          <TabsList>
            <TabsTrigger value="all">全部方向</TabsTrigger>
            <TabsTrigger value="long">
              偏多{' '}
              {freshItems.filter((c) => c.direction === 'long').length ?? ''}
            </TabsTrigger>
            <TabsTrigger value="short">
              偏空{' '}
              {freshItems.filter((c) => c.direction === 'short').length ?? ''}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <span>
          每轮完成后 90 秒更新 ·{' '}
          {data ? date(data.asOf) : '正在读取真实合约数据'}
        </span>
      </div>
      {loading ? (
        <div className="futures-loading" aria-live="polite">
          <Radar size={32} />
          <div>
            <h3>正在筛选成交活跃的合约</h3>
            <p>
              读取 15 分钟、1 小时和 4 小时 K
              线，核对趋势、资金费率与价差。完成后会显示符合规则的候选。
            </p>
          </div>
        </div>
      ) : current?.error ? (
        <div className="notice" role="alert">
          <ShieldAlert size={19} />
          <div>
            {current.error}
            <p>
              点击“刷新候选”重试。本板块使用合约数据，未以现货数据或模拟结果替代。
            </p>
          </div>
        </div>
      ) : data ? (
        <>
          <div className="futures-overview">
            <div>
              <span>USDT 永续市场</span>
              <strong>
                {data.universe}
                <small> 个合约</small>
              </strong>
            </div>
            <div>
              <span>通过流动性筛选</span>
              <strong>
                {data.eligible}
                <small> 个</small>
              </strong>
            </div>
            <div>
              <span>本轮完成分析 / 应扫描</span>
              <strong>
                {data.scanned - data.failed}
                <small> / {data.eligible} 个</small>
              </strong>
            </div>
            <div>
              <span>有效候选 / 已确认</span>
              <strong>
                {freshItems.length}
                <small>
                  {' '}
                  / {freshItems.filter((c) => c.status === 'confirmed').length}
                </small>
              </strong>
            </div>
          </div>
          <p className="futures-scope">
            24h 成交额 ≥ {(data.minVolume / 1e8).toFixed(1)} 亿 USDT，买卖价差 ≤{' '}
            {(data.spreadLimit / 100).toFixed(2)}%，上市 ≥{' '}
            {profile === 'steady' ? 30 : 7}{' '}
            天；扫描本轮开始时全部合格合约，不设前 N 名上限。耗时{' '}
            {(data.durationMs / 1000).toFixed(1)} 秒。
            {data.failed > 0
              ? `本轮 ${data.failed} 个读取或数据校验未通过，结果不完整。`
              : ''}
          </p>
          {(staleCount > 0 || !freshTime(data.marketTime, effectiveNow)) && (
            <output className="notice">
              行情已过期，已隐藏 {staleCount} 个旧候选。请刷新后再判断入场。
            </output>
          )}
          <Tabs
            value={group}
            onValueChange={(v) => {
              setGroup(String(v));
              setLimit(6);
            }}
            className="opportunity-groups"
          >
            <TabsList>
              {Object.entries(groupLabels).map(([value, label]) => (
                <TabsTrigger value={value} key={value}>
                  {label}{' '}
                  {directionItems.filter((c) => setupGroup(c) === value).length}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <p className="futures-scope">
            {group === 'confirmed'
              ? '已确认：最近已收盘的 15 分钟 K 线满足条件，最新价格和入场侧报价均在观察区；仍需检查成本。'
              : group === 'near'
                ? '接近触发：已进入观察区，或距观察区不超过半个小时波动幅度（0.5 ATR），尚未确认。'
                : '持续观察：距离观察区较远，等待价格靠近。刷新不代表出现了新信号。'}
          </p>
          <details className="opportunity-details">
            <summary>交易成本假设 · 持仓 {costs.hours} 小时</summary>
            <div className="cost-inputs">
              <label>
                单边手续费（%）
                <input
                  type="number"
                  min="0"
                  max="5"
                  step="0.01"
                  value={Number.isFinite(costs.feePct) ? costs.feePct : ''}
                  onChange={(e) =>
                    setCosts({ ...costs, feePct: e.target.valueAsNumber })
                  }
                />
              </label>
              <label>
                单边滑点（%）
                <input
                  type="number"
                  min="0"
                  max="5"
                  step="0.01"
                  value={
                    Number.isFinite(costs.slippagePct) ? costs.slippagePct : ''
                  }
                  onChange={(e) =>
                    setCosts({ ...costs, slippagePct: e.target.valueAsNumber })
                  }
                />
              </label>
              <label>
                预估持仓时间
                <select
                  value={costs.hours}
                  onChange={(e) =>
                    setCosts({ ...costs, hours: Number(e.target.value) })
                  }
                >
                  {[1, 4, 24].map((h) => (
                    <option value={h} key={h}>
                      {h} 小时
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p>
              默认手续费和滑点是可修改的估算值，不是你的账户费率。资金费按当前费率及结算周期推算；只计可能支付的费用，不预先计入收取资金费的收益。价格目标不保证在所选时间内到达。
            </p>
          </details>
          {items.length ? (
            <div className="contract-grid">
              {items.slice(0, limit).map((item) => (
                <SetupCard
                  key={item.symbol}
                  item={item}
                  costs={costs}
                  now={effectiveNow}
                />
              ))}
            </div>
          ) : (
            <div className="futures-empty">
              <Info size={25} />
              <h3>
                {group === 'confirmed'
                  ? '当前没有已确认的入场信号'
                  : group === 'near'
                    ? '当前没有接近触发的候选'
                    : '当前没有持续观察的候选'}
              </h3>
              {group === 'confirmed' && (
                <button
                  className="secondary"
                  onClick={() => {
                    setGroup('near');
                    setLimit(6);
                  }}
                >
                  查看接近触发的候选
                </button>
              )}
              <p>
                {Object.entries(data.rejected)
                  .map(([reason, count]) => `${reason} ${count} 个`)
                  .join('；') || '可切换方向或调整筛选条件。'}
              </p>
            </div>
          )}
          {items.length > limit && (
            <button
              className="secondary futures-more"
              onClick={() => setLimit(items.length)}
            >
              展开其余 {items.length - limit} 个候选
            </button>
          )}
          <details className="opportunity-details">
            <summary>
              扫描明细 · 失败 {data.failed} 个 · 行情缺失{' '}
              {data.marketUnavailable.length} 个 · 本轮退出{' '}
              {data.departed.length} 个
            </summary>
            <p>
              本轮退出仅表示已不符合筛选；读取失败的合约不会当作信号消失。首次观察是本次本地服务建立的基线，服务重启后重新开始记录。
            </p>
            <p>
              未完成分析：
              {Object.entries(data.failedReasons)
                .map(([symbol, reason]) => `${symbol}（${reason}）`)
                .join('、') || '无'}
              。行情缺失或过期：{data.marketUnavailable.join('、') || '无'}。
            </p>
            <p>
              本轮退出候选：{data.departed.join('、') || '无'}。候选 OI 暂缺：
              {data.oiMissing} 个（不影响技术确认）。
            </p>
            <p>
              排序依据：确认状态、距观察区距离、成交额。排名不代表预计收益或胜率。
            </p>
          </details>
          <div className="futures-rejections">
            <span>本轮排除原因：</span>
            {Object.entries(data.rejected).map(([reason, count]) => (
              <span className="tag neutral" key={reason}>
                {reason} {count}
              </span>
            ))}
          </div>
        </>
      ) : null}
      <div className="futures-note">
        <Info size={16} />
        <p>
          “稳健”只表示筛选更严格，不代表合约风险低。候选与目标位来自规则，尚未验证盈利能力；1R
          是观察区中点到止损位的价格距离，目标按 1.5R / 2.5R
          推算，不是预测价格或胜率。当前报价盈亏比与扣费估算单独列示，均未使用杠杆放大。资金费筛选按每
          8 小时折算，稳健上限 0.05%、积极上限
          0.1%（仅付费方向）；周期缺失时不标为已确认。止损参考不是强平价，入场前需复核最新报价。
        </p>
      </div>
    </section>
  );
}
