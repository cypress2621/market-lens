'use client';
import { useState, useEffect, useCallback } from 'react';
import { automaticRisks } from '@/lib/position-auto';
import { profitReference, type PositionOutlook } from '@/lib/position-outlook';
import type { Position } from '@/lib/position-risk';
const price = (n: number) =>
  n.toLocaleString('en-US', { maximumFractionDigits: 8 });
const stamp = (n: number) =>
  new Date(n).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
function AutoChart({ p }: { p: Position }) {
  const a = p.auto;
  if (!a) return null;
  const lines = [
    { label: '开仓', value: p.entry, color: '#718096' },
    { label: '标记价', value: p.mark, color: '#2459c4' },
    { label: '系统止损', value: a.stop, color: '#c53b54' },
    { label: '第一止盈', value: a.target1, color: '#158367' },
    { label: '第二止盈', value: a.target2, color: '#187568' },
  ];
  const values = [...a.chart.map((c) => c.close), ...lines.map((l) => l.value)],
    low = Math.min(...values),
    high = Math.max(...values),
    pad = Math.max((high - low) * 0.12, high * 0.001);
  const y = (n: number) =>
    160 - ((n - low + pad) / (high - low + 2 * pad)) * 140;
  return (
    <figure className="plan-chart">
      <svg
        viewBox="0 0 550 180"
        aria-label="最近小时收盘价格与系统止损、两档止盈参考线"
      >
        <path
          d={a.chart
            .map(
              (c, i) =>
                `${i ? 'L' : 'M'}${10 + (i / Math.max(1, a.chart.length - 1)) * 530},${y(c.close)}`,
            )
            .join(' ')}
          fill="none"
          stroke="#8297b9"
          strokeWidth="2"
        />
        {lines.map((l) => (
          <line
            key={l.label}
            x1="10"
            x2="540"
            y1={y(l.value)}
            y2={y(l.value)}
            stroke={l.color}
            strokeDasharray="5 4"
          />
        ))}
      </svg>
      <figcaption className="plan-line-legend">
        {lines.map((l) => (
          <span key={l.label}>
            <i style={{ background: l.color }} />
            {l.label} <b>{price(l.value)}</b>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
function TimeReference({
  position,
  stale,
  now,
}: {
  position: Position;
  stale: boolean;
  now: number;
}) {
  const [data, setData] = useState<PositionOutlook | null>(null),
    [error, setError] = useState('');
  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const response = await fetch(
          `/api/futures/position-outlook?symbol=${encodeURIComponent(position.symbol)}`,
          {
            cache: 'no-store',
            signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]),
          },
        );
        if (!response.ok) throw new Error();
        const result = (await response.json()) as PositionOutlook;
        if (!signal.aborted) {
          setData(result);
          setError('');
        }
      } catch {
        if (!signal.aborted)
          setError('历史时间参考暂不可用，系统已生成的风险线仍保留。');
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
  const old = stale || !!error || !data || now - data.asOf > 120000;
  return (
    <div className="plan-outlook">
      <h3>1 / 4 / 24 小时的辅助参考</h3>
      {error && <p className="subtext">{error}</p>}
      {!data && !error && <p className="subtext">正在读取合约历史…</p>}
      {data && (
        <>
          <div className="plan-table-scroll">
            <table className="plan-table">
              <thead>
                <tr>
                  <th>从参考时点起</th>
                  <th>历史波动止盈参考</th>
                  <th>毛盈亏</th>
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
                        {row.hours} 小时
                        <small>{stamp(data.asOf + row.hours * 3600000)}</small>
                      </th>
                      <td>
                        {old
                          ? '待更新'
                          : target
                            ? price(target.price)
                            : row.samples < 30
                              ? '样本不足'
                              : '暂不足以形成盈利目标'}
                      </td>
                      <td>{target ? `+${target.pnl.toFixed(2)} USDT` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="subtext">
            参考时点 {stamp(data.asOf)}
            。这些价格按近期历史到时波动的偏有利水平计算，与上方固定的系统执行参考线分别展示；不保证到时达到，不会覆盖止损或两档止盈。未扣手续费、资金费、滑点。
          </p>
        </>
      )}
    </div>
  );
}
export default function AutomaticPositionPlan({
  position: p,
  stale,
  now,
}: {
  position: Position;
  stale: boolean;
  now: number;
}) {
  const [expanded, setExpanded] = useState(false),
    a = p.auto;
  if (!a)
    return (
      <section className="position-plan">
        <h3>系统自动分析</h3>
        <p className="subtext">
          {p.analysisError ||
            '系统正在获取 1h、4h 和 15 分钟行情。数据齐全后会自动生成持仓依据、止损与两档止盈，无需填写。'}
        </p>
      </section>
    );
  const techOld = !!a.error || now - a.updatedAt > 180000,
    risks = automaticRisks(p, now, !stale),
    stop = risks.some((r) => r.code === 'auto-stop'),
    target2 = risks.some((r) => r.code === 'auto-target2'),
    target1 = risks.some((r) => r.code === 'auto-target1');
  const age = now - a.createdAt,
    summary = stale
      ? '账户数据过期，请到币安核对当前仓位'
      : stop
        ? '已触及系统止损参考，优先复核减仓或平仓'
        : !techOld && a.trend === 'opposes'
          ? '当前行情反对持仓方向，优先复核退出'
          : target2
            ? '已达第二止盈目标，复核剩余仓位止盈'
            : target1
              ? '已达第一止盈目标，复核分批止盈'
              : age >= 24 * 3600000
                ? '已超过 24 小时观察期，请重新评估仓位'
                : age >= 4 * 3600000
                  ? '已到 4 小时复核点，没有进展时复核退出'
                  : techOld
                    ? '技术分析待更新，保留上次固定价格线'
                    : a.trend === 'supports'
                      ? '当前方向有趋势支持，按系统风险线观察'
                      : '多周期支持不足，谨慎观察并优先控制风险';
  const pnl = (value: number) =>
    (p.side === 'long' ? value - p.entry : p.entry - value) * p.quantity;
  return (
    <section className="position-plan automatic-plan">
      <div className="section-heading">
        <h3>系统持仓分析</h3>
        <span className="tag green">自动生成</span>
      </div>
      <p
        className={`plan-exit-status ${stop ? 'negative' : a.trend === 'opposes' || age >= 4 * 3600000 ? 'amber-text' : ''}`}
      >
        {summary}
      </p>
      <div className="auto-reasons">
        <b>当前持仓依据</b>
        {techOld ? (
          <p className="subtext">
            技术数据待更新；下列为上次分析，不代表当前趋势。
          </p>
        ) : null}
        <ul>
          {a.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>
      <div className="auto-price-grid">
        {[
          { label: '系统止损参考', value: a.stop },
          { label: '第一止盈 · 1.5R', value: a.target1 },
          { label: '第二止盈 · 2.5R', value: a.target2 },
        ].map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{price(item.value)}</strong>
            <small>
              对应毛盈亏 {pnl(item.value) >= 0 ? '+' : ''}
              {pnl(item.value).toFixed(2)} USDT
            </small>
          </div>
        ))}
      </div>
      <p className="subtext">{a.exitCondition}</p>
      <div className="auto-checkpoints">
        {[
          { h: 1, text: '短线趋势复核' },
          { h: 4, text: '主观察期复核' },
          { h: 24, text: '最长观察期复核' },
        ].map((item) => (
          <div key={item.h}>
            <b>
              {item.h} 小时 · {item.text}
            </b>
            <span>
              {stamp(a.createdAt + item.h * 3600000)}
              {now >= a.createdAt + item.h * 3600000 ? ' · 已到期' : ''}
            </span>
          </div>
        ))}
      </div>
      <p className="subtext">
        从本次系统计划生成时刻 {stamp(a.createdAt)}{' '}
        计时，并非真实开仓时间；止盈目标是风险倍数参考，不承诺在这些时点达到。首次风险单位取结构风险与小时波动幅度的较大者。
      </p>
      <details onToggle={(e) => setExpanded(e.currentTarget.open)}>
        <summary>查看系统价格线与 1 / 4 / 24 小时辅助参考</summary>
        {expanded && (
          <>
            {!stale && <AutoChart p={p} />}
            <TimeReference position={p} stale={stale} now={now} />
          </>
        )}
      </details>
      <p className="auto-footnote">
        分析更新于 {stamp(a.updatedAt)}
        。系统自动刷新依据，止盈目标保持固定，止损只收紧。网页刷新不会重置；断开账户或重启服务后重新生成。仅分析和提醒，不发送平仓委托。
      </p>
    </section>
  );
}
