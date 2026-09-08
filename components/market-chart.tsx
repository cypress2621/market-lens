'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- The interactive SVG provides a keyboard-controlled candle cursor with full ARIA range semantics; replacing it with an input would remove the chart. */
import { useState } from 'react';
import { ema, type Candle } from '@/lib/analytics';
export default function MarketChart({ candles }: { candles: Candle[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const offset = Math.max(0, candles.length - 80),
    data = candles.slice(offset);
  const e20 = ema(
      candles.map((c) => c.close),
      20,
    ).slice(offset),
    e50 = ema(
      candles.map((c) => c.close),
      50,
    ).slice(offset);
  if (!data.length) return <div className="chart-empty">暂无 K 线数据</div>;
  const W = 960,
    H = 330,
    left = 12,
    right = 85,
    top = 22,
    bottom = 232,
    step = (W - left - right) / data.length;
  const min = Math.min(...data.map((c) => c.low), ...e20, ...e50),
    max = Math.max(...data.map((c) => c.high), ...e20, ...e50),
    pad = (max - min) * 0.07 || 1;
  const y = (p: number) =>
      top + ((max + pad - p) / (max - min + 2 * pad)) * (bottom - top),
    x = (i: number) => left + (i + 0.5) * step;
  const vm = Math.max(...data.map((c) => c.volume)) || 1;
  const fmt = (n: number) =>
    n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 7 : 2 });
  const active = data[hover ?? data.length - 1];
  return (
    <div className="chart-wrap">
      <div className="ohlc">
        <span>
          {new Date(active.time).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })}
        </span>
        <span>
          开 <b>{fmt(active.open)}</b>
        </span>
        <span>
          高 <b>{fmt(active.high)}</b>
        </span>
        <span>
          低 <b>{fmt(active.low)}</b>
        </span>
        <span>
          收{' '}
          <b className={active.close >= active.open ? 'positive' : 'negative'}>
            {fmt(active.close)}
          </b>
        </span>
        <span>
          量 <b>{fmt(active.volume)}</b>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="slider"
        tabIndex={0}
        aria-label="K 线历史读数，使用左右方向键选择 K 线"
        aria-valuemin={0}
        aria-valuemax={data.length - 1}
        aria-valuenow={hover ?? data.length - 1}
        aria-valuetext={`${new Date(active.time).toLocaleString('zh-CN')}，收盘 ${fmt(active.close)}`}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
            return;
          event.preventDefault();
          setHover(
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? data.length - 1
                : Math.max(
                    0,
                    Math.min(
                      data.length - 1,
                      (hover ?? data.length - 1) +
                        (event.key === 'ArrowRight' ? 1 : -1),
                    ),
                  ),
          );
        }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setHover(
            Math.max(
              0,
              Math.min(
                data.length - 1,
                Math.floor(
                  (((event.clientX - rect.left) / rect.width) * W - left) /
                    step,
                ),
              ),
            ),
          );
        }}
      >
        {[0, 1, 2, 3, 4].map((i) => {
          const val = min - pad + ((max - min + 2 * pad) * i) / 4;
          return (
            <g key={i}>
              <line
                x1={left}
                x2={W - right}
                y1={y(val)}
                y2={y(val)}
                stroke="#edf0f5"
              />
              <text
                x={W - right + 12}
                y={y(val) + 4}
                fill="#748096"
                fontSize="12"
              >
                {fmt(val)}
              </text>
            </g>
          );
        })}
        {data.map((c, i) => {
          const color = c.close >= c.open ? '#129779' : '#dc5b70';
          return (
            <g key={c.time}>
              <line
                x1={x(i)}
                x2={x(i)}
                y1={y(c.high)}
                y2={y(c.low)}
                stroke={color}
              />
              <rect
                x={x(i) - step * 0.29}
                y={Math.min(y(c.open), y(c.close))}
                width={step * 0.58}
                height={Math.max(1.2, Math.abs(y(c.open) - y(c.close)))}
                fill={color}
              />
              <rect
                x={x(i) - step * 0.29}
                y={295 - (c.volume / vm) * 43}
                width={step * 0.58}
                height={Math.max(0.5, (c.volume / vm) * 43)}
                fill={color}
                opacity=".32"
              />
            </g>
          );
        })}
        <polyline
          points={e20.map((p, i) => `${x(i)},${y(p)}`).join(' ')}
          fill="none"
          stroke="#dfa42b"
          strokeWidth="1.6"
        />
        <polyline
          points={e50.map((p, i) => `${x(i)},${y(p)}`).join(' ')}
          fill="none"
          stroke="#6971d1"
          strokeWidth="1.6"
        />
        {[0, 20, 40, 60, data.length - 1]
          .filter((v, i, a) => v < data.length && a.indexOf(v) === i)
          .map((i) => (
            <text
              key={i}
              x={x(i)}
              y={318}
              textAnchor={
                i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'
              }
              fill="#748096"
              fontSize="12"
            >
              {new Date(data[i].time).toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}
            </text>
          ))}
        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={top}
            y2={298}
            stroke="#8898b0"
            strokeDasharray="3 4"
          />
        )}
      </svg>
      <div className="chart-legend">
        <span>
          <i style={{ background: '#dfa42b' }} />
          EMA 20
        </span>
        <span>
          <i style={{ background: '#6971d1' }} />
          EMA 50
        </span>
        <span>下方柱状图：成交量（基础币）</span>
        <span>最新 K 线可能尚未收盘</span>
      </div>
    </div>
  );
}
