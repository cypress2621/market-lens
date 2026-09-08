'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  planDeadline,
  positionRisks,
  type Position,
  type PositionRule,
} from '@/lib/position-risk';
import { profitReference, type PositionOutlook } from '@/lib/position-outlook';
const price = (n: number) =>
  n.toLocaleString('en-US', { maximumFractionDigits: 8 });
const stamp = (n: number) =>
  new Date(n).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
function PriceLines({
  position: p,
  rule: r,
  data,
}: {
  position: Position;
  rule: PositionRule;
  data: PositionOutlook;
}) {
  const lines = [
    { name: '开仓线', value: p.entry, color: '#718096' },
    { name: '标记价', value: p.mark, color: '#2459c4' },
    ...(r.stop === null
      ? []
      : [{ name: '止损提醒线', value: r.stop, color: '#c53b54' }]),
    ...(r.takeProfit === null
      ? []
      : [{ name: '止盈提醒线', value: r.takeProfit, color: '#158367' }]),
  ];
  const values = [
      ...data.chart.map((c) => c.close),
      ...lines.map((l) => l.value),
    ],
    low = Math.min(...values),
    high = Math.max(...values),
    pad = Math.max((high - low) * 0.12, high * 0.001),
    min = low - pad,
    max = high + pad;
  const y = (v: number) => 160 - ((v - min) / (max - min)) * 140,
    x = (i: number) => 10 + (i / Math.max(1, data.chart.length - 1)) * 530;
  const path = data.chart
    .map(
      (c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(c.close).toFixed(2)}`,
    )
    .join(' ');
  return (
    <figure className="plan-chart">
      <svg
        viewBox="0 0 550 180"
        aria-label="最近 72 根已收盘小时 K 线收盘价，以及开仓、当前标记价、已设置的止损止盈水平线"
      >
        <path d={path} fill="none" stroke="#8297b9" strokeWidth="2" />
        {lines.map((l) => (
          <line
            key={l.name}
            x1="10"
            x2="540"
            y1={y(l.value)}
            y2={y(l.value)}
            stroke={l.color}
            strokeWidth="1.5"
            strokeDasharray="5 4"
          />
        ))}
      </svg>
      <figcaption>
        <div className="plan-chart-dates">
          <span>{data.chart.length ? stamp(data.chart[0].time) : ''}</span>
          <span>已收盘小时价格 · {stamp(data.historyEnd)}</span>
        </div>
        <div className="plan-line-legend">
          {lines.map((l) => (
            <span key={l.name}>
              <i style={{ background: l.color }} />
              {l.name} <b>{price(l.value)}</b>
            </span>
          ))}
        </div>
      </figcaption>
    </figure>
  );
}
function Outlook({
  position,
  rule,
  stale,
  now,
  onUseTarget,
}: {
  position: Position;
  rule: PositionRule;
  stale: boolean;
  now: number;
  onUseTarget: (price: number) => void;
}) {
  const [data, setData] = useState<PositionOutlook | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setBusy(true);
      setError('');
      try {
        const response = await fetch(
          `/api/futures/position-outlook?symbol=${encodeURIComponent(position.symbol)}`,
          {
            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(25000)])
              : AbortSignal.timeout(25000),
            cache: 'no-store',
          },
        );
        const result = (await response.json()) as PositionOutlook & {
          error?: string;
        };
        if (!response.ok) throw new Error(result.error || '合约参考暂不可用');
        if (!signal?.aborted) setData(result as PositionOutlook);
      } catch (e) {
        if (!signal?.aborted)
          setError(e instanceof Error ? e.message : '参考暂不可用');
      } finally {
        if (!signal?.aborted) setBusy(false);
      }
    },
    [position.symbol],
  );
  useEffect(() => {
    const controller = new AbortController(),
      initial = setTimeout(() => void load(controller.signal), 0),
      timer = setInterval(() => void load(controller.signal), 120000);
    return () => {
      controller.abort();
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [load]);
  const old =
    stale ||
    !!error ||
    !data ||
    now - data.asOf > 120000 ||
    now < data.asOf - 5000;
  return (
    <section className="plan-outlook">
      <div className="section-heading">
        <h3>按时间看止盈参考</h3>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => void load()}
        >
          {busy ? '更新中…' : '更新参考'}
        </button>
      </div>
      {error && (
        <p role="alert" className="negative">
          {error}
        </p>
      )}
      {!data && (
        <p className="subtext">
          {busy
            ? '正在读取这个合约的历史行情…'
            : '行情暂缺，仍可手动填写止盈价。'}
        </p>
      )}
      {data && (
        <>
          <p className="subtext">
            从 {stamp(data.asOf)} 的合约标记价 {price(data.referencePrice)}{' '}
            起算。
            {old
              ? '数据待更新，参考目标暂不可采用。'
              : '以下是历史到时波动的类比，不代表将在指定时间到达。'}
          </p>
          <div className="plan-table-scroll">
            <table className="plan-table">
              <thead>
                <tr>
                  <th>复核窗口</th>
                  <th>止盈参考价</th>
                  <th>目标毛盈亏</th>
                  <th>计划</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => {
                  const target = old
                    ? null
                    : profitReference(
                        position,
                        row,
                        data.referencePrice,
                        data.tickSize,
                      );
                  return (
                    <tr key={row.hours}>
                      <th>
                        {row.hours} 小时后
                        <small>{stamp(data.asOf + row.hours * 3600000)}</small>
                      </th>
                      <td>
                        {row.samples < 30
                          ? '历史样本不足'
                          : old
                            ? '待更新'
                            : target
                              ? price(target.price)
                              : '暂无盈利目标'}
                        <small>{row.samples} 个非重叠样本</small>
                      </td>
                      <td>{target ? `+${target.pnl.toFixed(2)} USDT` : '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="text-button"
                          disabled={!target}
                          onClick={() => {
                            if (target) onUseTarget(target.price);
                          }}
                        >
                          填入计划
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="subtext">
            使用近约 42 天该合约的历史价格：多仓取到时涨跌幅的 75% 分位，空仓取
            25%
            分位。这里的分位数不是胜率；没有按当前趋势筛选或经过预测校准。目标须越过开仓价才显示，毛盈亏未扣手续费、资金费和滑点。
          </p>
          <p className="subtext">
            时长表示从上方参考时点观察多久，不是“必须拿够多久”。“填入计划”只预填价格，复核时间由你在弹窗确认，保存后目标固定。
          </p>
          {!old && <PriceLines position={position} rule={rule} data={data} />}
        </>
      )}
    </section>
  );
}
export default function PositionPlan({
  position: p,
  rule: r,
  stale,
  now,
  onEdit,
  onUseTarget,
}: {
  position: Position;
  rule: PositionRule;
  stale: boolean;
  now: number;
  onEdit: () => void;
  onUseTarget: (price: number) => void;
}) {
  const [expanded, setExpanded] = useState(false),
    deadline = planDeadline(r),
    due = deadline !== null && now >= deadline,
    alerts = positionRisks(p, r, now, !stale);
  const danger = alerts.some((a) => a.severity === 'danger'),
    profit = alerts.some((a) => a.code === 'profit');
  const summary = stale
    ? '行情待更新，请先核对币安当前仓位'
    : danger
      ? '退出条件已触发，请立即核对减仓或平仓计划'
      : profit
        ? '已到止盈提醒线，请核对是否兑现利润'
        : due
          ? '计划时间已到，请复核止盈或退出'
          : p.trend === 'opposes'
            ? '行情方向与持仓相反，请复核入场理由'
            : r.stop === null && r.takeProfit === null
              ? '尚未设置价格退出条件'
              : '继续按计划观察，当前未触发退出条件';
  const remain =
    deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 60000));
  return (
    <section className="position-plan">
      <div className="section-heading">
        <h3>入场与退出计划</h3>
        <button type="button" className="text-button" onClick={onEdit}>
          编辑
        </button>
      </div>
      <p className="plan-reason">
        <b>我的入场理由</b>
        <span>
          {r.entryReason ||
            '尚未记录；网站无法从持仓数据得知你当时的入场理由。'}
        </span>
      </p>
      {r.invalidation && (
        <p className="plan-reason">
          <b>人工复核条件</b>
          <span>{r.invalidation}</span>
        </p>
      )}
      <div className="plan-key-lines">
        <div>
          <span>止盈提醒线</span>
          <strong>
            {r.takeProfit === null ? '未设置' : price(r.takeProfit)}
          </strong>
        </div>
        <div>
          <span>计划复核时间</span>
          <strong>{deadline === null ? '未设置' : stamp(deadline)}</strong>
          <small>
            {deadline === null
              ? '可选 1 / 4 / 24 小时'
              : due
                ? '已到期，等待你复核'
                : `剩余 ${Math.floor(remain! / 60)} 小时 ${remain! % 60} 分钟`}
          </small>
        </div>
      </div>
      <p
        className={`plan-exit-status ${danger ? 'negative' : due || profit ? 'amber-text' : ''}`}
      >
        {summary}
      </p>
      {stale && due && (
        <p className="amber-text">
          计划复核时间已到；当前行情过期，请到币安确认仓位与价格。
        </p>
      )}
      <details onToggle={(e) => setExpanded(e.currentTarget.open)}>
        <summary>展开：1 / 4 / 24 小时参考与价格线</summary>
        {expanded && (
          <Outlook
            position={p}
            rule={r}
            stale={stale}
            now={now}
            onUseTarget={onUseTarget}
          />
        )}
      </details>
    </section>
  );
}
